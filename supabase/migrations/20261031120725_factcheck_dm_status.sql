-- Whether the bot finished sending a fact-check result by DM. Set to 'sent' only after every result
-- message was confirmed by Meta; rows stay 'pending' if sending failed or the outcome is unknown.
alter table public.factchecks
  add column dm_status text not null default 'pending' check (dm_status in ('pending', 'sent')),
  add column dm_sent_at timestamptz;
