-- Rettelse 01 — la reiseledere slette turen sin.
-- Uten denne svarer sletting «vellykket» uten at noe skjer.
-- Kjør i SQL Editor. Trygg å kjøre flere ganger.

drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips
  for delete using (public.is_trip_leader(id));
