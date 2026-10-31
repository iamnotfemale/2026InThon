-- 캘린더 일정과 직접 모은 취향 (docs/calendar-taste-backend-handoff.md 1·2순위).
-- Both point at one card of a result: factchecks row + 1-based item order (fc42 = item 1, fc42-2 = item 2).
-- Owner = the verified login (auth.uid(), never a request field). Rows disappear with the member (auth.users cascade)
-- and with the result (retention purge / Instagram account deletion cascade through factchecks).
-- Reading also requires the result to still be visible to the member (factchecks RLS via account_links), so after an
-- unlink or a re-link to another member, stored IDs never expose someone else's content.

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  factcheck_id bigint not null references public.factchecks (id) on delete cascade,
  item_index smallint not null check (item_index between 1 and 99),
  kind text not null check (kind in ('cook', 'visit', 'deadline', 'prep', 'result')),
  date date not null,
  time text check (time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),   -- null = 종일 (never turned into midnight)
  timezone text not null default 'Asia/Seoul' check (timezone = 'Asia/Seoul'),
  revision integer not null default 1 check (revision >= 1),
  idempotency_key text check (char_length(idempotency_key) between 8 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index calendar_events_user_date on public.calendar_events (user_id, date);
create index calendar_events_factcheck on public.calendar_events (factcheck_id);

create table public.taste_collections (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  factcheck_id bigint not null references public.factchecks (id) on delete cascade,
  item_index smallint not null check (item_index between 1 and 99),
  created_at timestamptz not null default now(),
  primary key (user_id, factcheck_id, item_index)
);
create index taste_collections_factcheck on public.taste_collections (factcheck_id);

alter table public.calendar_events enable row level security;
alter table public.taste_collections enable row level security;
revoke all on public.calendar_events, public.taste_collections from anon, authenticated;
grant select, insert, delete on public.calendar_events, public.taste_collections to authenticated;
grant update (factcheck_id, item_index, kind, date, time, revision, updated_at) on public.calendar_events to authenticated;

-- A finished result the signed-in member can currently see through their linked Instagram account.
create function public.member_can_see_result(p_factcheck_id bigint)
returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from public.factchecks f join public.account_links l on l.igsid = f.igsid
     where f.id = p_factcheck_id and f.status = 'done' and l.user_id = (select auth.uid()));
$$;
revoke all on function public.member_can_see_result(bigint) from public, anon;
grant execute on function public.member_can_see_result(bigint) to authenticated;

create policy "own events: read" on public.calendar_events for select to authenticated
  using (user_id = (select auth.uid()) and public.member_can_see_result(factcheck_id));
create policy "own events: add" on public.calendar_events for insert to authenticated
  with check (user_id = (select auth.uid()) and public.member_can_see_result(factcheck_id));
create policy "own events: change" on public.calendar_events for update to authenticated
  using (user_id = (select auth.uid()) and public.member_can_see_result(factcheck_id))
  with check (user_id = (select auth.uid()) and public.member_can_see_result(factcheck_id));
-- Deleting stays possible even after the content became unreachable, so members can always clean up.
create policy "own events: delete" on public.calendar_events for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "own taste: read" on public.taste_collections for select to authenticated
  using (user_id = (select auth.uid()) and public.member_can_see_result(factcheck_id));
create policy "own taste: add" on public.taste_collections for insert to authenticated
  with check (user_id = (select auth.uid()) and public.member_can_see_result(factcheck_id));
create policy "own taste: delete" on public.taste_collections for delete to authenticated
  using (user_id = (select auth.uid()));
