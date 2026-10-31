-- Retention periods promised in the privacy policy (/privacy), enforced daily at 03:30 KST.
--   * DM receipt metadata and reply reservations: 90 days
--   * Instagram senders with no linked member account, and their fact-check results: 1 year after their last DM
--   * One-time link tokens: removed one day after they expire
-- Linked members' data is kept until the account is deleted (see account-deletion.mjs).
create extension if not exists pg_cron;

create or replace function public.purge_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  receipts integer; replies integer; tokens integer; senders integer;
begin
  delete from public.dm_receipts where received_at < now() - interval '90 days';
  get diagnostics receipts = row_count;
  delete from public.dm_replies where reserved_at < now() - interval '90 days';
  get diagnostics replies = row_count;
  delete from public.link_tokens where expires_at < now() - interval '1 day';
  get diagnostics tokens = row_count;
  -- Cascades to factchecks and link_tokens of those senders.
  delete from public.ig_accounts a
   where a.last_seen_at < now() - interval '1 year'
     and not exists (select 1 from public.account_links l where l.igsid = a.igsid);
  get diagnostics senders = row_count;
  return jsonb_build_object('dm_receipts', receipts, 'dm_replies', replies, 'link_tokens', tokens, 'ig_accounts', senders);
end;
$$;

revoke all on function public.purge_expired_data() from public, anon, authenticated;

select cron.schedule('purge-expired-data', '30 18 * * *', 'select public.purge_expired_data()');
