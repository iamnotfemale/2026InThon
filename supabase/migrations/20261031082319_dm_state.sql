-- DM webhook metadata. No message text, sender IDs, raw message IDs or tokens are stored.

create table public.dm_receipts (
  id bigint generated always as identity primary key,
  received_at timestamptz not null,
  messages integer not null check (messages >= 0),
  entries integer not null check (entries >= 0),
  created_at timestamptz not null default now()
);

-- One row per reply. The primary key makes reservation atomic across function instances:
-- only the first insert for a key succeeds, every later one fails with a unique violation.
create table public.dm_replies (
  key text primary key check (key ~ '^[a-f0-9]{64}$'),
  status text not null default 'sending' check (status in ('sending', 'sent')),
  reserved_at timestamptz not null default now(),
  sent_at timestamptz
);

-- Only the server (secret / service_role key, which bypasses RLS) may read or write.
alter table public.dm_receipts enable row level security;
alter table public.dm_replies enable row level security;
revoke all on public.dm_receipts, public.dm_replies from anon, authenticated;
