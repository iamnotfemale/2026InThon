-- Why a sender's Instagram handle is missing: the last Meta lookup result, as error codes only
-- (e.g. "HTTP 400, code 100, subcode 33, GraphMethodException"), never Meta's error text.
alter table public.ig_accounts
  add column username_lookup_error text check (username_lookup_error is null or length(username_lookup_error) <= 200),
  add column username_checked_at timestamptz;
