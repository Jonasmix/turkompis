-- Rydd bort turene Claude laget under testing.
-- Kjør i SQL Editor. Sletter bare disse fire navnene, ingenting annet.
-- Alt som henger under (program, chatter, meldinger) forsvinner med dem.

delete from public.trips
where name in ('Testtur', 'Slettbar', 'Privattest', 'Berlin UI-test');
