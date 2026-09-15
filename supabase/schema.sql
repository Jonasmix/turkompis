-- Turkompis — databaseoppsett for Supabase.
-- Kjør hele filen én gang i SQL Editor i Supabase-prosjektet ditt.
-- Den kan kjøres på nytt: alt er skrevet slik at det tåler gjentakelse.

create extension if not exists pgcrypto;

-- ───────────────────────── tabeller ─────────────────────────

create table if not exists public.trips (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null check (char_length(name) between 1 and 80),
  org         text not null default '',
  dates_label text not null default '',
  created_by  uuid not null default auth.uid(),
  created_at  timestamptz not null default now()
);

create table if not exists public.members (
  trip_id   uuid not null references public.trips(id) on delete cascade,
  user_id   uuid not null default auth.uid(),
  name      text not null check (char_length(name) between 1 and 80),
  role      text not null default 'member' check (role in ('member','leader')),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create table if not exists public.places (
  id      uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  name    text not null check (char_length(name) between 1 and 120),
  addr    text not null default '',
  kind    text not null default 'Sted',
  aliases text[] not null default '{}'
);

create table if not exists public.days (
  id             uuid primary key default gen_random_uuid(),
  trip_id        uuid not null references public.trips(id) on delete cascade,
  date           date not null,
  hotel_place_id uuid references public.places(id) on delete set null,
  unique (trip_id, date)
);

create table if not exists public.items (
  id       uuid primary key default gen_random_uuid(),
  trip_id  uuid not null references public.trips(id) on delete cascade,
  day_id   uuid not null references public.days(id) on delete cascade,
  t        text not null check (t ~ '^[0-2][0-9]:[0-5][0-9]$'),
  title    text not null check (char_length(title) between 1 and 120),
  place_id uuid references public.places(id) on delete set null,
  note     text not null default '',
  src      text not null default 'Lagt inn i appen'
);

create table if not exists public.channels (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  sub        text not null default '',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  channel_id  uuid not null references public.channels(id) on delete cascade,
  author_id   uuid not null default auth.uid(),
  author_name text not null,
  role        text not null default '',
  txt         text not null check (char_length(txt) between 1 and 2000),
  action      jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists messages_channel_idx on public.messages (channel_id, created_at);
create index if not exists items_day_idx on public.items (day_id, t);
create index if not exists members_user_idx on public.members (user_id);

-- ──────────────────── hjelpefunksjoner ────────────────────
-- security definer: de ser forbi radsikkerheten, ellers ville en regel
-- som spør i members om lov til å lese members gå i ring.

create or replace function public.is_trip_member(p_trip uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.members
    where trip_id = p_trip and user_id = auth.uid()
  );
$$;

create or replace function public.is_trip_leader(p_trip uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.members
    where trip_id = p_trip and user_id = auth.uid() and role = 'leader'
  );
$$;

-- ──────────────────────── radsikkerhet ────────────────────────

alter table public.trips    enable row level security;
alter table public.members  enable row level security;
alter table public.places   enable row level security;
alter table public.days     enable row level security;
alter table public.items    enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;

drop policy if exists trips_read   on public.trips;
drop policy if exists trips_write  on public.trips;
drop policy if exists trips_delete on public.trips;
drop policy if exists mem_read     on public.members;
drop policy if exists mem_leave    on public.members;
drop policy if exists mem_kick     on public.members;
drop policy if exists places_read  on public.places;
drop policy if exists places_write on public.places;
drop policy if exists days_read    on public.days;
drop policy if exists days_write   on public.days;
drop policy if exists items_read   on public.items;
drop policy if exists items_write  on public.items;
drop policy if exists ch_read      on public.channels;
drop policy if exists ch_create    on public.channels;
drop policy if exists ch_manage    on public.channels;
drop policy if exists msg_read     on public.messages;
drop policy if exists msg_write    on public.messages;
drop policy if exists msg_delete   on public.messages;

-- Turer: bare medlemmer ser dem. Oppretting går gjennom create_trip().
create policy trips_read  on public.trips for select using (public.is_trip_member(id));
create policy trips_write on public.trips for update using (public.is_trip_leader(id))
                                          with check (public.is_trip_leader(id));
create policy trips_delete on public.trips for delete using (public.is_trip_leader(id));

-- Deltakere: medlemmer ser hvem andre som er med. Innmelding går gjennom join_trip().
create policy mem_read  on public.members for select using (public.is_trip_member(trip_id));
create policy mem_leave on public.members for delete using (user_id = auth.uid());
create policy mem_kick  on public.members for delete using (public.is_trip_leader(trip_id));

-- Program, steder og dager: alle medlemmer leser, bare reiseledere skriver.
create policy places_read  on public.places  for select using (public.is_trip_member(trip_id));
create policy places_write on public.places  for all    using (public.is_trip_leader(trip_id))
                                                        with check (public.is_trip_leader(trip_id));
create policy days_read    on public.days    for select using (public.is_trip_member(trip_id));
create policy days_write   on public.days    for all    using (public.is_trip_leader(trip_id))
                                                        with check (public.is_trip_leader(trip_id));
create policy items_read   on public.items   for select using (public.is_trip_member(trip_id));
create policy items_write  on public.items   for all    using (public.is_trip_leader(trip_id))
                                                        with check (public.is_trip_leader(trip_id));

-- Chatter: alle medlemmer kan lage en gruppechat, reiseleder kan rydde.
create policy ch_read   on public.channels for select using (public.is_trip_member(trip_id));
create policy ch_create on public.channels for insert with check (
  public.is_trip_member(trip_id) and created_by = auth.uid()
);
create policy ch_manage on public.channels for delete using (public.is_trip_leader(trip_id));

-- Meldinger: leses av medlemmer, skrives i eget navn, slettes av deg selv
-- eller av reiseleder.
create policy msg_read   on public.messages for select using (public.is_trip_member(trip_id));
create policy msg_write  on public.messages for insert with check (
  public.is_trip_member(trip_id) and author_id = auth.uid()
);
create policy msg_delete on public.messages for delete using (
  author_id = auth.uid() or public.is_trip_leader(trip_id)
);

-- ───────────────────── bli med / lag tur ─────────────────────

create or replace function public.join_trip(p_code text, p_name text)
returns public.trips language plpgsql security definer set search_path = public as $$
declare t public.trips;
begin
  if auth.uid() is null then raise exception 'ikke_innlogget'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'mangler_navn'; end if;

  select * into t from public.trips
   where code = upper(regexp_replace(coalesce(p_code,''), '\s', '', 'g'));
  if not found then raise exception 'ukjent_kode'; end if;

  insert into public.members (trip_id, user_id, name)
  values (t.id, auth.uid(), trim(p_name))
  on conflict (trip_id, user_id) do update set name = excluded.name;

  return t;
end; $$;

create or replace function public.create_trip(
  p_name text, p_org text, p_dates text, p_leader_name text
) returns public.trips language plpgsql security definer set search_path = public as $$
declare
  t         public.trips;
  v_code    text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- uten I, O, 0, 1
  i         int;
  tries     int := 0;
begin
  if auth.uid() is null then raise exception 'ikke_innlogget'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'mangler_navn'; end if;
  if coalesce(trim(p_leader_name), '') = '' then raise exception 'mangler_navn'; end if;

  -- Én bruker kan ikke lage uendelig mange turer.
  if (select count(*) from public.trips where created_by = auth.uid()) >= 20 then
    raise exception 'for_mange_turer';
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.trips where code = v_code);
    tries := tries + 1;
    if tries > 40 then raise exception 'kodegenerering_feilet'; end if;
  end loop;

  insert into public.trips (code, name, org, dates_label, created_by)
  values (v_code, trim(p_name), coalesce(trim(p_org), ''), coalesce(trim(p_dates), ''), auth.uid())
  returning * into t;

  insert into public.members (trip_id, user_id, name, role)
  values (t.id, auth.uid(), trim(p_leader_name), 'leader');

  insert into public.channels (trip_id, name, sub)
  values (t.id, 'Hele turen', 'Alle deltakere');

  return t;
end; $$;

revoke all on function public.join_trip(text, text) from public;
revoke all on function public.create_trip(text, text, text, text) from public;
grant execute on function public.join_trip(text, text) to authenticated;
grant execute on function public.create_trip(text, text, text, text) to authenticated;

-- ────────────────────────── realtime ──────────────────────────
-- Gjør at nye meldinger dukker opp hos alle uten at appen spør på nytt.

do $$
begin
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
  end;
end $$;
