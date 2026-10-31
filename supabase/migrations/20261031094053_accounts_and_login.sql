-- Instagram senders, Google-login account links and per-sender fact-check history.
-- Bot (server, secret key) writes; signed-in web users read only rows linked to themselves via RLS.

-- Every Instagram account that has DMed the bot, keyed by its Instagram-scoped ID (IGSID).
create table public.ig_accounts (
  igsid text primary key check (igsid ~ '^[0-9]{1,32}$'),
  username text check (username is null or username ~ '^[A-Za-z0-9._]{1,30}$'),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- One-time link tokens the bot DMs to a sender. Only the SHA-256 hash is stored.
create table public.link_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  igsid text not null references public.ig_accounts (igsid) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null
);

-- A Google-login user is linked to at most one Instagram account and vice versa.
create table public.account_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  igsid text not null unique references public.ig_accounts (igsid) on delete cascade,
  linked_at timestamptz not null default now()
);

-- Fact-check results per sender. No DM text or attachments, only the extracted claim and the verdict.
create table public.factchecks (
  id bigint generated always as identity primary key,
  igsid text not null references public.ig_accounts (igsid) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null check (status in ('done', 'not_checkable', 'no_input', 'failed')),
  verdict text check (verdict in ('supported', 'refuted', 'context', 'unverified', 'not_checkable')),
  claim text,
  topic text,
  reason text,
  sources jsonb not null default '[]'::jsonb
);
create index factchecks_igsid_created_at on public.factchecks (igsid, created_at desc);
create index link_tokens_igsid on public.link_tokens (igsid);

alter table public.ig_accounts enable row level security;
alter table public.link_tokens enable row level security;
alter table public.account_links enable row level security;
alter table public.factchecks enable row level security;

revoke all on public.ig_accounts, public.link_tokens, public.account_links, public.factchecks from anon, authenticated;
grant select on public.ig_accounts, public.account_links, public.factchecks to authenticated;
grant delete on public.account_links to authenticated;

create policy "own link: read" on public.account_links
  for select to authenticated using (user_id = (select auth.uid()));
create policy "own link: unlink" on public.account_links
  for delete to authenticated using (user_id = (select auth.uid()));
create policy "linked account: read" on public.ig_accounts
  for select to authenticated using (exists (
    select 1 from public.account_links l where l.igsid = ig_accounts.igsid and l.user_id = (select auth.uid())));
create policy "linked fact-checks: read" on public.factchecks
  for select to authenticated using (exists (
    select 1 from public.account_links l where l.igsid = factchecks.igsid and l.user_id = (select auth.uid())));

-- Called by the signed-in web user with the token from the DM link. Atomically consumes the token
-- and links the Instagram account to the caller. Whoever can receive the account's DMs controls it,
-- so a fresh link moves the account away from any previous Google user.
create function public.link_instagram(p_token text)
returns table (igsid text, username text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_igsid text;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid_token' using errcode = '22023';
  end if;

  update public.link_tokens t
     set used_at = now(), used_by = v_uid
   where t.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
     and t.used_at is null
     and t.expires_at > now()
  returning t.igsid into v_igsid;
  if v_igsid is null then
    raise exception 'invalid_or_expired_token' using errcode = '22023';
  end if;

  delete from public.account_links l where l.igsid = v_igsid and l.user_id <> v_uid;
  insert into public.account_links (user_id, igsid) values (v_uid, v_igsid)
  on conflict (user_id) do update set igsid = excluded.igsid, linked_at = now();

  return query select a.igsid, a.username from public.ig_accounts a where a.igsid = v_igsid;
end;
$$;

revoke all on function public.link_instagram(text) from public, anon;
grant execute on function public.link_instagram(text) to authenticated;
