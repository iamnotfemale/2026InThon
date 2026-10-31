-- 맛집: the first content type with its own typed tables (recipes/contests/exhibitions still keep v1 JSON in factchecks.reason).
-- A result is still one factchecks row (topic 'restaurant'), so /items/fc<ID> links, DM delivery state, account linking,
-- retention and account deletion all apply unchanged; places and menus hang off it and are deleted with it.

create table public.restaurants (
  id bigint generated always as identity primary key,
  factcheck_id bigint not null references public.factchecks (id) on delete cascade,
  position smallint not null check (position between 1 and 10),
  name text not null check (char_length(name) between 1 and 120),
  category text check (category in ('한식', '중식', '일식', '양식', '아시아', '분식', '카페·디저트', '베이커리', '주점', '기타')),
  intro text check (char_length(intro) <= 400),
  area text check (char_length(area) <= 60),            -- "성수동", "연남동" as written
  address text check (char_length(address) <= 160),    -- only when the post wrote a street/lot address
  phone text check (char_length(phone) <= 40),
  hours text check (char_length(hours) <= 160),
  closed text check (char_length(closed) <= 120),
  price_range text check (char_length(price_range) <= 80),
  reservation text check (char_length(reservation) <= 160),
  waiting text check (char_length(waiting) <= 160),
  parking text check (char_length(parking) <= 120),
  links jsonb not null default '[]'::jsonb,            -- [{label, url}] only URLs present in the received text
  evidence jsonb not null default '{}'::jsonb,         -- {field: "본문" | "이미지N" | "영상N mm:ss 화면/음성"}
  checks text[] not null default '{}',
  unique (factcheck_id, position)
);

create table public.restaurant_menus (
  id bigint generated always as identity primary key,
  restaurant_id bigint not null references public.restaurants (id) on delete cascade,
  position smallint not null check (position between 1 and 40),
  name text not null check (char_length(name) between 1 and 100),
  price_text text check (char_length(price_text) <= 60),           -- as written: "12,000원", "1만2천원", "시가"
  price_won integer check (price_won between 0 and 10000000),        -- parsed number when unambiguous
  note text check (char_length(note) <= 200),
  signature boolean not null default false,                          -- 대표·추천 메뉴 as the post says
  unique (restaurant_id, position)
);

create index restaurants_factcheck_id on public.restaurants (factcheck_id);
create index restaurant_menus_restaurant_id on public.restaurant_menus (restaurant_id);

alter table public.restaurants enable row level security;
alter table public.restaurant_menus enable row level security;
revoke all on public.restaurants, public.restaurant_menus from anon, authenticated;
grant select on public.restaurants, public.restaurant_menus to authenticated;

-- Signed-in members read only places/menus of results sent by their own linked Instagram account.
create policy "linked restaurants: read" on public.restaurants
  for select to authenticated using (exists (
    select 1 from public.factchecks f join public.account_links l on l.igsid = f.igsid
     where f.id = restaurants.factcheck_id and l.user_id = (select auth.uid())));
create policy "linked restaurant menus: read" on public.restaurant_menus
  for select to authenticated using (exists (
    select 1 from public.restaurants r join public.factchecks f on f.id = r.factcheck_id
      join public.account_links l on l.igsid = f.igsid
     where r.id = restaurant_menus.restaurant_id and l.user_id = (select auth.uid())));

-- Saves one result with its places and menus atomically (server only). Returns the factchecks id for /items/fc<ID>.
create function public.save_restaurant_result(p_igsid text, p_claim text, p_reason text, p_places jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint; v_place jsonb; v_pos integer; v_rid bigint;
begin
  if jsonb_typeof(p_places) <> 'array' or jsonb_array_length(p_places) not between 1 and 10 then
    raise exception 'invalid_places' using errcode = '22023';
  end if;
  insert into public.factchecks (igsid, status, verdict, claim, topic, reason, sources)
  values (p_igsid, 'done', null, p_claim, 'restaurant', p_reason, '[]'::jsonb)
  returning id into v_id;
  for v_place, v_pos in select value, ordinality from jsonb_array_elements(p_places) with ordinality loop
    insert into public.restaurants (factcheck_id, position, name, category, intro, area, address, phone, hours, closed,
      price_range, reservation, waiting, parking, links, evidence, checks)
    values (v_id, v_pos, v_place->>'name', v_place->>'category', v_place->>'intro', v_place->>'area', v_place->>'address',
      v_place->>'phone', v_place->>'hours', v_place->>'closed', v_place->>'priceRange', v_place->>'reservation',
      v_place->>'waiting', v_place->>'parking', coalesce(v_place->'links', '[]'::jsonb), coalesce(v_place->'evidence', '{}'::jsonb),
      coalesce(array(select jsonb_array_elements_text(v_place->'checks')), '{}'))
    returning id into v_rid;
    insert into public.restaurant_menus (restaurant_id, position, name, price_text, price_won, note, signature)
    select v_rid, m.ordinality, m.value->>'name', m.value->>'priceText', (m.value->>'priceWon')::integer, m.value->>'note',
      coalesce((m.value->>'signature')::boolean, false)
      from jsonb_array_elements(coalesce(v_place->'menus', '[]'::jsonb)) with ordinality m;
  end loop;
  return v_id;
end;
$$;

revoke all on function public.save_restaurant_result(text, text, text, jsonb) from public, anon, authenticated;
