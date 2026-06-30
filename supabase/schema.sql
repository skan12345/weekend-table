-- Weekend Table — Supabase schema
-- Run this in your Supabase project: SQL Editor → New query → paste → Run.

create table if not exists public.restaurants (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  address      text,
  phone        text,
  cuisine      text not null default 'other',
  tier         text not null default 'close',   -- 'close' | 'far'
  source       text,
  url          text,
  notes        text,
  status       text not null default 'want',     -- 'want' | 'been'
  lat          double precision,
  lng          double precision,
  google_id    text,
  last_visited timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists public.settings (
  id              int primary key default 1,
  home_lat        double precision,
  home_lng        double precision,
  home_label      text,
  threshold_miles int not null default 5
);

insert into public.settings (id) values (1)
  on conflict (id) do nothing;

-- Live sync between both partners' phones.
alter publication supabase_realtime add table public.restaurants;

-- Row Level Security ----------------------------------------------------------
-- NOTE: the policies below are OPEN (anyone with the anon key can read/write).
-- That is fine for a private tool whose URL you don't share, and keeps setup
-- to zero. To lock it down later, replace these with auth-gated policies
-- (e.g. `using (auth.role() = 'authenticated')`) and turn on Supabase Auth.

alter table public.restaurants enable row level security;
alter table public.settings    enable row level security;

drop policy if exists "open restaurants" on public.restaurants;
create policy "open restaurants" on public.restaurants
  for all using (true) with check (true);

drop policy if exists "open settings" on public.settings;
create policy "open settings" on public.settings
  for all using (true) with check (true);
