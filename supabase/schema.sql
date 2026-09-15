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

-- ═══════════════════════════════════════════════════════════════
--  Utvidelse 02 — private gruppechatter
--  En chat er enten åpen for hele turen, eller privat for dem som
--  er lagt til. Private chatter er private også for reiseledere.
-- ═══════════════════════════════════════════════════════════════

alter table public.channels
  add column if not exists private boolean not null default false;

create table if not exists public.channel_members (
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id    uuid not null,
  added_at   timestamptz not null default now(),
  primary key (channel_id, user_id)
);

create index if not exists channel_members_user_idx on public.channel_members (user_id);

alter table public.channel_members enable row level security;

-- Er jeg med i denne chatten? Security definer for å unngå at en regel
-- på channel_members må spørre i channel_members.
create or replace function public.in_channel(p_channel uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.channel_members
    where channel_id = p_channel and user_id = auth.uid()
  );
$$;

-- Får jeg lese denne chatten? Åpen chat: alle på turen. Privat: bare medlemmer.
create or replace function public.can_read_channel(p_channel uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.channels c
    where c.id = p_channel
      and public.is_trip_member(c.trip_id)
      and (
        c.private = false
        or exists (select 1 from public.channel_members m
                   where m.channel_id = c.id and m.user_id = auth.uid())
      )
  );
$$;

drop policy if exists ch_read      on public.channels;
drop policy if exists ch_create    on public.channels;
drop policy if exists ch_manage    on public.channels;
drop policy if exists cm_read      on public.channel_members;
drop policy if exists cm_remove    on public.channel_members;
drop policy if exists msg_read     on public.messages;
drop policy if exists msg_write    on public.messages;
drop policy if exists msg_delete   on public.messages;

-- Private chatter dukker ikke engang opp i lista for andre.
create policy ch_read on public.channels for select using (
  public.is_trip_member(trip_id) and (private = false or public.in_channel(id))
);
-- Oppretting går gjennom create_channel(); sletting er for den som laget
-- chatten, eller for reiseleder når chatten er åpen.
create policy ch_manage on public.channels for delete using (
  created_by = auth.uid() or (private = false and public.is_trip_leader(trip_id))
);

-- Deltakerlista i en chat ser du bare hvis du får lese chatten.
create policy cm_read on public.channel_members for select using (
  public.can_read_channel(channel_id)
);
-- Du kan gå ut selv, eller fjerne noen fra en chat du selv er med i.
create policy cm_remove on public.channel_members for delete using (
  user_id = auth.uid() or public.in_channel(channel_id)
);

-- Meldinger følger chatten, ikke turen.
create policy msg_read on public.messages for select using (
  public.can_read_channel(channel_id)
);
create policy msg_write on public.messages for insert with check (
  public.can_read_channel(channel_id) and author_id = auth.uid()
);
-- Reiseleder kan rydde i chatter hen faktisk har tilgang til — ikke i private.
create policy msg_delete on public.messages for delete using (
  author_id = auth.uid()
  or (public.is_trip_leader(trip_id) and public.can_read_channel(channel_id))
);

-- Lag chat, og legg inn deltakerne i samme operasjon.
create or replace function public.create_channel(
  p_trip uuid, p_name text, p_sub text, p_private boolean, p_members uuid[]
) returns public.channels language plpgsql security definer set search_path = public as $$
declare c public.channels; u uuid;
begin
  if auth.uid() is null then raise exception 'ikke_innlogget'; end if;
  if not public.is_trip_member(p_trip) then raise exception 'ikke_medlem'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'mangler_navn'; end if;

  insert into public.channels (trip_id, name, sub, private, created_by)
  values (p_trip, trim(p_name), coalesce(trim(p_sub), ''), coalesce(p_private, false), auth.uid())
  returning * into c;

  -- Den som lager chatten er alltid med.
  insert into public.channel_members (channel_id, user_id) values (c.id, auth.uid());

  -- Bare folk som faktisk er med på turen kan legges til.
  foreach u in array coalesce(p_members, '{}'::uuid[]) loop
    if exists (select 1 from public.members where trip_id = p_trip and user_id = u) then
      insert into public.channel_members (channel_id, user_id)
      values (c.id, u) on conflict do nothing;
    end if;
  end loop;

  return c;
end; $$;

-- Legg til én deltaker i en chat du selv er med i.
create or replace function public.add_channel_member(p_channel uuid, p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_trip uuid;
begin
  if auth.uid() is null then raise exception 'ikke_innlogget'; end if;
  select trip_id into v_trip from public.channels where id = p_channel;
  if v_trip is null then raise exception 'ukjent_chat'; end if;
  if not public.can_read_channel(p_channel) then raise exception 'ingen_tilgang'; end if;
  if not exists (select 1 from public.members where trip_id = v_trip and user_id = p_user) then
    raise exception 'ikke_paa_turen';
  end if;

  insert into public.channel_members (channel_id, user_id)
  values (p_channel, p_user) on conflict do nothing;
  return true;
end; $$;

revoke all on function public.create_channel(uuid, text, text, boolean, uuid[]) from public;
revoke all on function public.add_channel_member(uuid, uuid) from public;
grant execute on function public.create_channel(uuid, text, text, boolean, uuid[]) to authenticated;
grant execute on function public.add_channel_member(uuid, uuid) to authenticated;

-- Chatter som fantes før denne utvidelsen er åpne for hele turen.
update public.channels set private = false where private is null;

-- ═══════════════════════════════════════════════════════════════
--  Utvidelse 03 — programpunkter uten klokkeslett
--  Ekte turhefter har punkter som «frokost på hotellet» uten tid.
--  Kravet om klokkeslett tvang modellen til å finne på tider.
-- ═══════════════════════════════════════════════════════════════

alter table public.items alter column t drop not null;

-- Steder kan ha en nettside når heftet oppgir lenke i stedet for adresse.
alter table public.places add column if not exists url text not null default '';

-- ═══════════════════════════════════════════════════════════════
--  Utvidelse 04 — rekkefølge på programpunkter
--  Punkter uten klokkeslett har likevel en rekkefølge i heftet.
--  Uten dette havnet de nederst på dagen, løsrevet fra sammenhengen.
-- ═══════════════════════════════════════════════════════════════

alter table public.items add column if not exists sort int not null default 0;

-- Gi eksisterende punkter en rekkefølge etter klokkeslett, så de ikke
-- stokker om seg når appen begynner å sortere på sort.
with nummerert as (
  select id, row_number() over (partition by day_id order by t nulls last, title) * 10 as n
  from public.items
)
update public.items i set sort = nummerert.n
from nummerert where nummerert.id = i.id and i.sort = 0;

drop index if exists items_day_idx;
create index if not exists items_day_idx on public.items (day_id, sort);

-- ═══════════════════════════════════════════════════════════════
--  Utvidelse 05 — flere reiseledere
--  Den som laget turen kan gi lederrollen videre, slik at flere kan
--  endre programmet. Rollen settes gjennom en funksjon, ikke ved at
--  appen skriver rett i tabellen — da kan ingen gi seg selv rollen.
-- ═══════════════════════════════════════════════════════════════

create or replace function public.set_member_role(
  p_trip uuid, p_user uuid, p_role text
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_eier uuid; v_ledere int;
begin
  if auth.uid() is null then raise exception 'ikke_innlogget'; end if;
  if p_role not in ('member', 'leader') then raise exception 'ukjent_rolle'; end if;
  if not public.is_trip_leader(p_trip) then raise exception 'ikke_leder'; end if;

  if not exists (select 1 from public.members where trip_id = p_trip and user_id = p_user) then
    raise exception 'ikke_medlem';
  end if;

  -- Den som opprettet turen beholder lederrollen. Ellers kunne noen du
  -- nettopp forfremmet ta fra deg turen din.
  select created_by into v_eier from public.trips where id = p_trip;
  if p_user = v_eier and p_role <> 'leader' then raise exception 'eier_beholder_rollen'; end if;

  -- En tur uten reiseledere kan ingen redigere igjen.
  if p_role = 'member' then
    select count(*) into v_ledere from public.members
     where trip_id = p_trip and role = 'leader';
    if v_ledere <= 1 then raise exception 'siste_leder'; end if;
  end if;

  update public.members set role = p_role
   where trip_id = p_trip and user_id = p_user;
  return true;
end; $$;

revoke all on function public.set_member_role(uuid, uuid, text) from public;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════
--  Utvidelse 06 — reaksjoner, svar og vær
-- ═══════════════════════════════════════════════════════════════

-- Hvilken melding et svar hører til. Slettes originalen, blir svaret
-- stående som en vanlig melding i stedet for å forsvinne.
alter table public.messages
  add column if not exists reply_to uuid references public.messages(id) on delete set null;

-- Koordinater til værmeldingen. Fylles inn av serverfunksjonen når den
-- slår opp adressen; står de tomme, vises ingen vær for stedet.
alter table public.places add column if not exists lat double precision;
alter table public.places add column if not exists lon double precision;

-- channel_id ligger her også, så tilgangsregelen slipper å slå opp
-- meldingen for å finne ut hvem som får lese reaksjonen.
create table if not exists public.reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  user_id    uuid not null default auth.uid(),
  name       text not null,
  emoji      text not null check (char_length(emoji) between 1 and 12),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
create index if not exists reactions_msg_idx on public.reactions (message_id);

alter table public.reactions enable row level security;

drop policy if exists rea_read   on public.reactions;
drop policy if exists rea_write  on public.reactions;
drop policy if exists rea_delete on public.reactions;

create policy rea_read on public.reactions for select using (
  public.can_read_channel(channel_id)
);
create policy rea_write on public.reactions for insert with check (
  public.can_read_channel(channel_id) and user_id = auth.uid()
);
create policy rea_delete on public.reactions for delete using (user_id = auth.uid());

-- Mellomlager for værmeldinger, så vi ikke spør Yr på nytt for hver elev
-- som åpner appen. Bare serverfunksjonen skriver hit.
create table if not exists public.forecasts (
  lat        numeric(6,3) not null,
  lon        numeric(6,3) not null,
  data       jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (lat, lon)
);
alter table public.forecasts enable row level security;
drop policy if exists fc_read on public.forecasts;
create policy fc_read on public.forecasts for select using (auth.uid() is not null);

do $$
begin
  begin
    alter publication supabase_realtime add table public.reactions;
  exception when duplicate_object then null;
  end;
end $$;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════
--  Utvidelse 07 — kryss av for at noe ikke trengs
--  Ikke alle steder skal navigeres til. Skal gruppen kjøres med buss,
--  er adressen uvesentlig, og da skal ikke appen mase om den.
-- ═══════════════════════════════════════════════════════════════

alter table public.places add column if not exists ignore_position boolean not null default false;
alter table public.days   add column if not exists ignore_hotel    boolean not null default false;

notify pgrst, 'reload schema';
