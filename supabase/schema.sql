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

-- ═══════════════════════════════════════════════════════════════
--  Utvidelse 08 — én reaksjon per person, og godkjenning for å bli med
-- ═══════════════════════════════════════════════════════════════

-- Én reaksjon per person per melding. Velger man en ny, erstatter den
-- den forrige. Behold den nyeste av dem som alt finnes.
delete from public.reactions r
using public.reactions r2
where r.message_id = r2.message_id
  and r.user_id    = r2.user_id
  and r.created_at < r2.created_at;

alter table public.reactions drop constraint if exists reactions_pkey;
alter table public.reactions add primary key (message_id, user_id);

-- Reiselederen kan kreve at nye deltakere godkjennes.
alter table public.trips
  add column if not exists require_approval boolean not null default false;

alter table public.members
  add column if not exists status text not null default 'approved';

do $$
begin
  alter table public.members add constraint members_status_sjekk
    check (status in ('pending', 'approved'));
exception when duplicate_object then null;
end $$;

-- Bare godkjente regnes som medlemmer. Uten dette ville en som venter
-- kunne lese alt mens hen venter.
create or replace function public.is_trip_member(p_trip uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.members
    where trip_id = p_trip and user_id = auth.uid() and status = 'approved'
  );
$$;

create or replace function public.is_trip_leader(p_trip uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.members
    where trip_id = p_trip and user_id = auth.uid()
      and role = 'leader' and status = 'approved'
  );
$$;

-- Har jeg i det hele tatt en rad på turen — godkjent eller ikke?
create or replace function public.har_rad_paa_tur(p_trip uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.members where trip_id = p_trip and user_id = auth.uid()
  );
$$;

-- Den som venter må få se navnet på turen hen venter på, og sin egen rad.
drop policy if exists trips_read on public.trips;
create policy trips_read on public.trips for select using (
  public.is_trip_member(id) or public.har_rad_paa_tur(id)
);

drop policy if exists mem_read on public.members;
create policy mem_read on public.members for select using (
  public.is_trip_member(trip_id) or user_id = auth.uid()
);

-- Innmelding tar hensyn til om turen krever godkjenning.
create or replace function public.join_trip(p_code text, p_name text)
returns public.trips language plpgsql security definer set search_path = public as $$
declare t public.trips; v_status text;
begin
  if auth.uid() is null then raise exception 'ikke_innlogget'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'mangler_navn'; end if;

  select * into t from public.trips
   where code = upper(regexp_replace(coalesce(p_code,''), '\s', '', 'g'));
  if not found then raise exception 'ukjent_kode'; end if;

  v_status := case when t.require_approval then 'pending' else 'approved' end;

  insert into public.members (trip_id, user_id, name, status)
  values (t.id, auth.uid(), trim(p_name), v_status)
  on conflict (trip_id, user_id) do update set name = excluded.name;

  return t;
end; $$;

-- Godkjenn eller avvis en som venter.
create or replace function public.set_member_status(
  p_trip uuid, p_user uuid, p_status text
) returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trip_leader(p_trip) then raise exception 'ikke_leder'; end if;
  if p_status not in ('pending', 'approved') then raise exception 'ukjent_status'; end if;

  update public.members set status = p_status
   where trip_id = p_trip and user_id = p_user;
  return true;
end; $$;

-- Avvis: fjern raden helt, så personen kan prøve igjen senere.
create or replace function public.avvis_deltaker(p_trip uuid, p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trip_leader(p_trip) then raise exception 'ikke_leder'; end if;
  delete from public.members where trip_id = p_trip and user_id = p_user and status = 'pending';
  return true;
end; $$;

revoke all on function public.set_member_status(uuid, uuid, text) from public;
revoke all on function public.avvis_deltaker(uuid, uuid) from public;
grant execute on function public.set_member_status(uuid, uuid, text) to authenticated;
grant execute on function public.avvis_deltaker(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════
--  Utvidelse 09 — fjerne deltakere, og en skjult admin-rolle
-- ═══════════════════════════════════════════════════════════════

-- «admin» har samme rettigheter som reiseleder, men vises ikke i appen.
-- Den settes bare herfra, aldri fra grensesnittet.
alter table public.members drop constraint if exists members_role_check;
do $$
begin
  alter table public.members add constraint members_role_sjekk
    check (role in ('member', 'leader', 'admin'));
exception when duplicate_object then null;
end $$;

create or replace function public.is_trip_leader(p_trip uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.members
    where trip_id = p_trip and user_id = auth.uid()
      and role in ('leader', 'admin') and status = 'approved'
  );
$$;

-- En admin skal ikke kunne fratas rollen av en reiseleder, og rollen
-- kan ikke deles ut fra appen.
create or replace function public.set_member_role(
  p_trip uuid, p_user uuid, p_role text
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_eier uuid; v_ledere int; v_naa text;
begin
  if auth.uid() is null then raise exception 'ikke_innlogget'; end if;
  if p_role not in ('member', 'leader') then raise exception 'ukjent_rolle'; end if;
  if not public.is_trip_leader(p_trip) then raise exception 'ikke_leder'; end if;

  select role into v_naa from public.members
   where trip_id = p_trip and user_id = p_user;
  if v_naa is null then raise exception 'ikke_medlem'; end if;
  if v_naa = 'admin' then raise exception 'kan_ikke_endres'; end if;

  select created_by into v_eier from public.trips where id = p_trip;
  if p_user = v_eier and p_role <> 'leader' then raise exception 'eier_beholder_rollen'; end if;

  if p_role = 'member' then
    select count(*) into v_ledere from public.members
     where trip_id = p_trip and role in ('leader', 'admin') and status = 'approved';
    if v_ledere <= 1 then raise exception 'siste_leder'; end if;
  end if;

  update public.members set role = p_role
   where trip_id = p_trip and user_id = p_user;
  return true;
end; $$;

-- Fjern noen fra turen. Rydder også plassen deres i private chatter,
-- ellers ville de blitt stående som medlem av noe de ikke lenger har
-- tilgang til.
create or replace function public.fjern_deltaker(p_trip uuid, p_user uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_eier uuid; v_naa text;
begin
  if not public.is_trip_leader(p_trip) then raise exception 'ikke_leder'; end if;
  if p_user = auth.uid() then raise exception 'ikke_deg_selv'; end if;

  select role into v_naa from public.members where trip_id = p_trip and user_id = p_user;
  if v_naa is null then raise exception 'ikke_medlem'; end if;
  if v_naa = 'admin' then raise exception 'kan_ikke_endres'; end if;

  select created_by into v_eier from public.trips where id = p_trip;
  if p_user = v_eier then raise exception 'eier_kan_ikke_fjernes'; end if;

  delete from public.channel_members cm
   using public.channels c
   where c.id = cm.channel_id and c.trip_id = p_trip and cm.user_id = p_user;

  delete from public.members where trip_id = p_trip and user_id = p_user;
  return true;
end; $$;

revoke all on function public.fjern_deltaker(uuid, uuid) from public;
grant execute on function public.fjern_deltaker(uuid, uuid) to authenticated;

-- Bytter du fra tommel til hjerte, skriver appen over raden du alt har.
-- Det er en UPDATE, og uten en egen regel for det stopper basen den —
-- da ble den gamle reaksjonen stående. Du kan bare endre din egen.
drop policy if exists rea_update on public.reactions;
create policy rea_update on public.reactions for update
  using (user_id = auth.uid())
  with check (public.can_read_channel(channel_id) and user_id = auth.uid());

notify pgrst, 'reload schema';

-- ── Slik gir du deg selv admin på en tur ───────────────────────
-- Admin finnes bare her i basen. Appen viser den aldri: i deltakerlista
-- står en admin som vanlig deltaker, og ingen reiseleder kan endre eller
-- fjerne hen. Selv får du de samme knappene som en reiseleder.
--
-- Du må først være med på turen på vanlig vis (bruk turkoden). Så kjører
-- du de to linjene under i SQL Editor, med din egen e-post og turkoden:
--
--   update public.members m
--      set role = 'admin', status = 'approved'
--     from public.trips t, auth.users u
--    where m.trip_id = t.id and m.user_id = u.id
--      and t.code = 'ABC123'
--      and u.email = 'din@epost.no';
--
-- Tilbake til vanlig deltaker: bytt 'admin' med 'member' i samme spørring.

-- ═══════════════════════════════════════════════════════════════
--  Utvidelse 10 — tåle at hele klassen er inne samtidig
-- ═══════════════════════════════════════════════════════════════

-- Uten disse leser basen gjennom hele tabellen hver gang noen åpner
-- turen. Med én tur og ti meldinger merkes det ikke; med hundre elever
-- som åpner appen samtidig på bussen gjør det det.
create index if not exists places_trip_idx   on public.places   (trip_id);
create index if not exists days_trip_idx     on public.days     (trip_id, date);
create index if not exists items_trip_idx    on public.items    (trip_id);
create index if not exists channels_trip_idx on public.channels (trip_id);
create index if not exists messages_trip_idx on public.messages (trip_id, created_at desc);
create index if not exists reactions_ch_idx  on public.reactions (channel_id);

-- Reiseledere kunne slette medlemsrader rett i tabellen, utenom
-- fjern_deltaker(). Da gjaldt ingen av vernene der: en leder kunne
-- fjerne både den som laget turen og en admin. Sletting skal gå gjennom
-- funksjonen, som sjekker hvem det er før den rører noe.
drop policy if exists mem_kick on public.members;

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════
--  Utvidelse 11 — levende program, ryddigere chatliste, brems på spam
-- ═══════════════════════════════════════════════════════════════

-- (A) Endrer reiselederen et klokkeslett under turen, skal det slå
-- gjennom med én gang. Uten dette så en telefon som stod åpen hele dagen
-- gammelt program helt til appen ble lukket og åpnet igjen.
do $$
begin
  begin alter publication supabase_realtime add table public.items;  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.days;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.places; exception when duplicate_object then null; end;
end $$;

-- (B) Siste melding i hver chat, én rad per chat. Appen hentet før de
-- 300 siste meldingene i hele turen og plukket ut den nyeste per chat —
-- er hovedchatten travel, kom ingen av de andre chattene med i det hele
-- tatt. Funksjonen kjører som den som spør, så radsikkerheten gjelder:
-- private chatter du ikke er med i, er ikke med i svaret.
create or replace function public.siste_meldinger(p_trip uuid)
returns table (
  channel_id uuid, txt text, author_name text, author_id uuid, created_at timestamptz
) language sql stable set search_path = public as $$
  select distinct on (m.channel_id)
         m.channel_id, m.txt, m.author_name, m.author_id, m.created_at
    from public.messages m
   where m.trip_id = p_trip
   order by m.channel_id, m.created_at desc;
$$;

revoke all on function public.siste_meldinger(uuid) from public;
grant execute on function public.siste_meldinger(uuid) to authenticated;

-- (D) Å slette turen sletter program, chatter og alle meldinger for alle.
-- Det skal ikke enhver du har gjort til reiseleder kunne gjøre — bare den
-- som laget turen, eller en admin.
create or replace function public.er_admin(p_trip uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.members
    where trip_id = p_trip and user_id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips for delete using (
  created_by = auth.uid() or public.er_admin(id)
);

-- (E) Én person skal ikke kunne fylle chatten for nittini andre.
-- Tjue meldinger i minuttet er langt mer enn noen skriver i vanlig prat,
-- og stopper både utilsiktede løkker og noen som holder inne send.
create index if not exists messages_author_idx on public.messages (author_id, created_at desc);

create or replace function public.brems_meldinger()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.messages
   where author_id = new.author_id and created_at > now() - interval '1 minute';
  if n >= 20 then raise exception 'for_mange_meldinger'; end if;
  return new;
end; $$;

drop trigger if exists brems_meldinger on public.messages;
create trigger brems_meldinger before insert on public.messages
  for each row execute function public.brems_meldinger();

-- Og ikke fylle chatlista med tomme grupper heller.
create or replace function public.brems_chatter()
returns trigger language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.channels
   where trip_id = new.trip_id and created_by = new.created_by;
  if n >= 10 then raise exception 'for_mange_chatter'; end if;
  return new;
end; $$;

drop trigger if exists brems_chatter on public.channels;
create trigger brems_chatter before insert on public.channels
  for each row execute function public.brems_chatter();

notify pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════
--  Utvidelse 12 — varsler, og hva hver enkelt vil bli varslet om
-- ═══════════════════════════════════════════════════════════════

-- Én rad per enhet som har sagt ja til varsler. Nøklene her er det
-- nettleseren gir oss; de sier ingenting om hvem du er, og kan bare
-- brukes til å sende varsler til akkurat den nettleseren.
create table if not exists public.push_subs (
  endpoint   text primary key,
  user_id    uuid not null default auth.uid(),
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subs (user_id);

alter table public.push_subs enable row level security;
drop policy if exists ps_own on public.push_subs;
create policy ps_own on public.push_subs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Hva du vil varsles om. Én rad per tur, og eventuelt én per chat som
-- skal være annerledes enn resten av turen. Ingen rad = «viktig».
--   alt    — hver melding
--   viktig — reiseledere, svar på dine meldinger, og møtesteder
--   ingen  — ingenting
create table if not exists public.varselvalg (
  user_id    uuid not null default auth.uid(),
  trip_id    uuid not null references public.trips(id) on delete cascade,
  channel_id uuid references public.channels(id) on delete cascade,
  niva       text not null check (niva in ('alt', 'viktig', 'ingen'))
);

-- channel_id er tom for hele turen, og tomme verdier teller ikke som like
-- i en vanlig unik indeks. Derfor sammenliknes de gjennom coalesce.
create unique index if not exists varselvalg_unik on public.varselvalg
  (user_id, trip_id, coalesce(channel_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table public.varselvalg enable row level security;
drop policy if exists vv_own on public.varselvalg;
create policy vv_own on public.varselvalg for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Samme enhet kan ha vært brukt av en annen konto før. Da må den gamle
-- raden vike, ellers ville varsler fortsatt gått til forrige innlogging.
create or replace function public.lagre_push(p_endpoint text, p_p256dh text, p_auth text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'ikke_innlogget'; end if;
  delete from public.push_subs where endpoint = p_endpoint;
  insert into public.push_subs (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth);
  return true;
end; $$;

-- Sett nivå for en tur (p_channel tom) eller for én chat. «folg» sletter
-- raden, slik at chatten følger turen igjen.
create or replace function public.sett_varselniva(p_trip uuid, p_channel uuid, p_niva text)
returns boolean language plpgsql set search_path = public as $$
declare v_tom uuid := '00000000-0000-0000-0000-000000000000';
begin
  if auth.uid() is null then raise exception 'ikke_innlogget'; end if;
  delete from public.varselvalg
   where user_id = auth.uid() and trip_id = p_trip
     and coalesce(channel_id, v_tom) = coalesce(p_channel, v_tom);
  if p_niva in ('alt', 'viktig', 'ingen') then
    insert into public.varselvalg (trip_id, channel_id, niva)
    values (p_trip, p_channel, p_niva);
  end if;
  return true;
end; $$;

revoke all on function public.lagre_push(text, text, text) from public;
revoke all on function public.sett_varselniva(uuid, uuid, text) from public;
grant execute on function public.lagre_push(text, text, text) to authenticated;
grant execute on function public.sett_varselniva(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
