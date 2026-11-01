-- 캘린더 DM 리마인드 (docs/dm-reminders-backend-handoff.md).
--   * calendar_events.reminders: the member's chosen options (day9 / h1 / eve / d3).
--   * calendar_reminder_jobs: one job per option and schedule revision. Only the database (trigger) creates jobs and
--     only the server worker (secret key) changes their status; members can read their own jobs' public columns.
--   * dm_inbound: the last real message each Instagram sender sent the bot (the 24-hour reply window).
--   * Every minute pg_cron asks the protected worker (/api/reminders/run) to run, but only when a job is due.
-- Members never choose the recipient, the send time or a status: those come from the schedule and the account link.

create extension if not exists pg_net;

-- 1. Options per schedule ----------------------------------------------------------------------------------------
alter table public.calendar_events
  add column reminders text[] not null default '{}'
    check (reminders <@ array['day9', 'h1', 'eve', 'd3']::text[] and cardinality(reminders) <= 4),
  add constraint calendar_events_h1_needs_time check (time is not null or not ('h1' = any (reminders)));
grant update (reminders) on public.calendar_events to authenticated;

-- Any change to a schedule moves it to a new revision, so jobs made for the old one can never be sent.
create function public.bump_calendar_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.revision <= old.revision then new.revision := old.revision + 1; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger calendar_events_revision before update on public.calendar_events
  for each row execute function public.bump_calendar_revision();

-- 2. Last real inbound DM per sender ------------------------------------------------------------------------------
create table public.dm_inbound (
  igsid text primary key references public.ig_accounts (igsid) on delete cascade,
  last_message_at timestamptz not null,   -- the message's own time, never later than its receipt
  received_at timestamptz not null        -- when the server received that message
);
alter table public.dm_inbound enable row level security;
revoke all on public.dm_inbound from anon, authenticated;

-- Called by the webhook (secret key) only for signed messages from a person to the bot. Old redeliveries never move
-- the time back, and a message can never claim a time later than its receipt.
create function public.note_inbound_dm(p_igsid text, p_message_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := least(p_message_at, now());
begin
  if p_igsid is null or p_igsid !~ '^[0-9]{1,32}$' or v_at is null or v_at < now() - interval '24 hours' then
    return;
  end if;
  insert into public.ig_accounts (igsid) values (p_igsid) on conflict (igsid) do nothing;
  insert into public.dm_inbound (igsid, last_message_at, received_at) values (p_igsid, v_at, now())
  on conflict (igsid) do update set last_message_at = excluded.last_message_at, received_at = excluded.received_at
    where public.dm_inbound.last_message_at < excluded.last_message_at;
end;
$$;
revoke all on function public.note_inbound_dm(text, timestamptz) from public, anon, authenticated;

-- Only the latest time matters, and only for 24 hours: older rows are removed daily (03:35 KST).
select cron.schedule('purge-dm-inbound', '35 18 * * *',
  $$delete from public.dm_inbound where last_message_at < now() - interval '2 days'$$);

-- 3. Reminder jobs -------------------------------------------------------------------------------------------------
create table public.calendar_reminder_jobs (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.calendar_events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  igsid text references public.ig_accounts (igsid) on delete set null,   -- recipient linked when scheduled (never shown)
  event_revision integer not null,
  reminder_key text not null check (reminder_key in ('day9', 'h1', 'eve', 'd3')),
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'sending', 'sent', 'cancelled', 'skipped', 'failed', 'unknown')),
  reason text check (reason ~ '^[a-z0-9_]{1,40}$'),
  attempts smallint not null default 0,
  claimed_at timestamptz,
  request_started_at timestamptz,
  sent_at timestamptz,
  meta_message_id text check (char_length(meta_message_id) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, event_revision, reminder_key)
);
create index calendar_reminder_jobs_due on public.calendar_reminder_jobs (scheduled_at) where status = 'scheduled';
create index calendar_reminder_jobs_leased on public.calendar_reminder_jobs (claimed_at) where status = 'sending';
create index calendar_reminder_jobs_user on public.calendar_reminder_jobs (user_id);
create index calendar_reminder_jobs_igsid on public.calendar_reminder_jobs (igsid);

alter table public.calendar_reminder_jobs enable row level security;
revoke all on public.calendar_reminder_jobs from anon, authenticated;
grant select (id, event_id, event_revision, reminder_key, scheduled_at, status, reason, sent_at)
  on public.calendar_reminder_jobs to authenticated;
create policy "own reminder jobs: read" on public.calendar_reminder_jobs for select to authenticated
  using (user_id = (select auth.uid()));

-- KST send time of an option; null when it does not apply. Mirrors reminderAt() in public/js/reminder-rules.js.
create function public.reminder_at(p_key text, p_date date, p_time text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case p_key
    when 'day9' then (p_date + time '09:00') at time zone 'Asia/Seoul'
    when 'h1' then case when p_time is null then null
                        else ((p_date + p_time::time) - interval '1 hour') at time zone 'Asia/Seoul' end
    when 'eve' then ((p_date - 1) + time '20:00') at time zone 'Asia/Seoul'
    when 'd3' then ((p_date - 3) + time '09:00') at time zone 'Asia/Seoul'
  end;
$$;

-- In the same transaction as the schedule write: cancel jobs of older revisions and create this revision's jobs.
create function public.schedule_event_reminders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_igsid text;
  v_key text;
  v_at timestamptz;
begin
  update public.calendar_reminder_jobs j set status = 'cancelled', reason = 'changed', updated_at = now()
   where j.event_id = new.id and j.status = 'scheduled' and j.event_revision <> new.revision;
  select l.igsid into v_igsid from public.account_links l where l.user_id = new.user_id;
  foreach v_key in array new.reminders loop
    v_at := public.reminder_at(v_key, new.date, new.time);
    continue when v_at is null;
    insert into public.calendar_reminder_jobs (event_id, user_id, igsid, event_revision, reminder_key, scheduled_at, status, reason)
    values (new.id, new.user_id, v_igsid, new.revision, v_key, v_at,
      case when v_at <= now() or v_igsid is null then 'skipped' else 'scheduled' end,
      case when v_at <= now() then 'past' when v_igsid is null then 'not_linked' end)
    on conflict (event_id, event_revision, reminder_key) do nothing;
  end loop;
  return null;
end;
$$;
revoke all on function public.schedule_event_reminders() from public, anon, authenticated;
create trigger calendar_events_reminders after insert or update on public.calendar_events
  for each row execute function public.schedule_event_reminders();

-- Unlinking, or the Instagram account moving to another member, cancels every waiting job of either side.
create function public.cancel_reminders_on_unlink()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.calendar_reminder_jobs j set status = 'cancelled', reason = 'unlinked', updated_at = now()
   where j.status = 'scheduled' and (j.user_id = old.user_id or j.igsid = old.igsid);
  return null;
end;
$$;
revoke all on function public.cancel_reminders_on_unlink() from public, anon, authenticated;
create trigger account_links_unlink_reminders after delete on public.account_links
  for each row execute function public.cancel_reminders_on_unlink();
create trigger account_links_change_reminders after update on public.account_links
  for each row when (old.igsid is distinct from new.igsid or old.user_id is distinct from new.user_id)
  execute function public.cancel_reminders_on_unlink();

-- The member's own reply window: linked?, and until when the bot may still message them.
create function public.my_dm_window()
returns table (linked boolean, window_ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.igsid is not null, i.last_message_at + interval '24 hours'
    from (select (select auth.uid()) as uid) me
    left join public.account_links l on l.user_id = me.uid
    left join public.dm_inbound i on i.igsid = l.igsid;
$$;
revoke all on function public.my_dm_window() from public, anon;
grant execute on function public.my_dm_window() to authenticated;

-- 4. Worker queue ----------------------------------------------------------------------------------------------------
-- Takes up to p_limit due jobs atomically (FOR UPDATE SKIP LOCKED), so concurrent runs never take the same job.
-- Housekeeping first:
--   * a lease older than 2 minutes whose Meta request had started → unknown (never re-sent automatically)
--   * a lease older than 2 minutes whose request never started → back to scheduled (at most 3 attempts)
--   * a job more than 5 minutes late → skipped / stale (no burst of old reminders)
create function public.claim_reminder_jobs(p_limit integer default 10)
returns table (id bigint, event_id uuid, event_revision integer, reminder_key text, scheduled_at timestamptz,
               user_id uuid, igsid text, claimed_at timestamptz, attempts smallint)
language sql
security definer
set search_path = ''
as $$
  update public.calendar_reminder_jobs j set status = 'unknown', reason = 'lease_expired', updated_at = now()
   where j.status = 'sending' and j.claimed_at < now() - interval '2 minutes' and j.request_started_at is not null;
  update public.calendar_reminder_jobs j
     set status = case when j.attempts >= 3 then 'failed' else 'scheduled' end,
         reason = case when j.attempts >= 3 then 'retry_limit' end, claimed_at = null, updated_at = now()
   where j.status = 'sending' and j.claimed_at < now() - interval '2 minutes' and j.request_started_at is null;
  update public.calendar_reminder_jobs j set status = 'skipped', reason = 'stale', updated_at = now()
   where j.status = 'scheduled' and j.scheduled_at < now() - interval '5 minutes';
  update public.calendar_reminder_jobs j
     set status = 'sending', claimed_at = clock_timestamp(), attempts = j.attempts + 1, updated_at = now()
   where j.id in (select x.id from public.calendar_reminder_jobs x
                   where x.status = 'scheduled' and x.scheduled_at <= now()
                   order by x.scheduled_at, x.id
                   limit greatest(1, least(coalesce(p_limit, 10), 50))
                   for update skip locked)
  returning j.id, j.event_id, j.event_revision, j.reminder_key, j.scheduled_at, j.user_id, j.igsid, j.claimed_at, j.attempts;
$$;
revoke all on function public.claim_reminder_jobs(integer) from public, anon, authenticated;

-- 5. Minute trigger --------------------------------------------------------------------------------------------------
-- Calls the worker only when something is due. The URL and the bearer secret (= CRON_SECRET on Vercel) live in
-- Supabase Vault as 'reminder_worker_url' and 'reminder_worker_secret'; until both exist this does nothing.
create function public.run_reminder_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (select 1 from public.calendar_reminder_jobs j
                  where (j.status = 'scheduled' and j.scheduled_at <= now())
                     or (j.status = 'sending' and j.claimed_at < now() - interval '2 minutes')) then
    return null;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'reminder_worker_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'reminder_worker_secret';
  if v_url is null or v_secret is null or v_url !~ '^https://' then return null; end if;
  return net.http_get(url := v_url, headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
                      timeout_milliseconds := 60000);
end;
$$;
revoke all on function public.run_reminder_worker() from public, anon, authenticated;

select cron.schedule('dm-reminders', '* * * * *', 'select public.run_reminder_worker()');
