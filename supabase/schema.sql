-- ============================================================
-- F1 Fantasy Draft League 2026 — Supabase Schema
-- ============================================================

create extension if not exists "uuid-ossp";

-- ── Owners ───────────────────────────────────────────────────
create table owners (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null,
  constructor  text not null,
  created_at   timestamptz default now()
);

insert into owners (name, constructor) values
  ('Steve',  'Red Bull'),
  ('Trevor', 'Ferrari');

-- ── Drivers ──────────────────────────────────────────────────
create table drivers (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null unique,
  constructor text not null
);

insert into drivers (name, constructor) values
  ('Lando Norris',          'McLaren'),
  ('Oscar Piastri',         'McLaren'),
  ('George Russell',        'Mercedes'),
  ('Andrea Kimi Antonelli', 'Mercedes'),
  ('Max Verstappen',        'Red Bull'),
  ('Isack Hadjar',          'Red Bull'),
  ('Charles Leclerc',       'Ferrari'),
  ('Lewis Hamilton',        'Ferrari'),
  ('Fernando Alonso',       'Aston Martin'),
  ('Lance Stroll',          'Aston Martin'),
  ('Pierre Gasly',          'Alpine'),
  ('Franco Colapinto',      'Alpine'),
  ('Alex Albon',            'Williams'),
  ('Carlos Sainz',          'Williams'),
  ('Liam Lawson',           'Racing Bulls'),
  ('Arvid Lindblad',        'Racing Bulls'),
  ('Esteban Ocon',          'Haas'),
  ('Oliver Bearman',        'Haas'),
  ('Nico Hulkenberg',       'Audi'),
  ('Gabriel Bortoleto',     'Audi'),
  ('Sergio Perez',          'Cadillac'),
  ('Valtteri Bottas',       'Cadillac');

-- ── Races ────────────────────────────────────────────────────
create table races (
  id              uuid primary key default uuid_generate_v4(),
  round           int not null unique,
  name            text not null,
  has_sprint      boolean default false,
  race_date       date,
  results_updated boolean default false,
  updated_at      timestamptz
);

-- Saudi Arabia (originally round 5, Apr 19) was postponed due to regional
-- conflict and has not been rescheduled as of this writing. Bahrain
-- (originally round 4, Apr 12) was postponed and relocated to Sepang
-- International Circuit, Malaysia, keeping its "Bahrain GP" branding —
-- see "Formula 1 Gulf Air Bahrain Grand Prix in Malaysia 2026".
insert into races (round, name, has_sprint, race_date) values
  (1,  'Australia',          false, '2026-03-08'),
  (2,  'China',              true,  '2026-03-15'),
  (3,  'Japan',              false, '2026-03-29'),
  (4,  'Miami',              true,  '2026-05-03'),
  (5,  'Canada',             true,  '2026-05-24'),
  (6,  'Monaco',             false, '2026-06-07'),
  (7,  'Barcelona',          false, '2026-06-14'),
  (8,  'Austria',            false, '2026-06-28'),
  (9,  'Great Britain',      true,  '2026-07-05'),
  (10, 'Belgium',            false, '2026-07-19'),
  (11, 'Hungary',            false, '2026-07-26'),
  (12, 'Netherlands',        true,  '2026-08-23'),
  (13, 'Italy',              false, '2026-09-06'),
  (14, 'Madrid',             false, '2026-09-13'),
  (15, 'Azerbaijan',         false, '2026-09-26'),
  (16, 'Bahrain (Malaysia)', false, '2026-10-04 07:00:00+00'), -- start time TBC, placeholder
  (17, 'Singapore',          true,  '2026-10-11'),
  (18, 'United States',      false, '2026-10-25'),
  (19, 'Mexico',             false, '2026-11-01'),
  (20, 'São Paulo',          false, '2026-11-08'),
  (21, 'Las Vegas',          false, '2026-11-22'),
  (22, 'Qatar',              false, '2026-11-29'),
  (23, 'Abu Dhabi',          false, '2026-12-06');

-- ── Weekly Drafts ─────────────────────────────────────────────
create table drafts (
  id          uuid primary key default uuid_generate_v4(),
  race_id     uuid references races(id) on delete cascade,
  owner_id    uuid references owners(id) on delete cascade,
  driver_id   uuid references drivers(id) on delete cascade,
  pick_number int not null,
  created_at  timestamptz default now(),
  unique(race_id, driver_id),
  unique(race_id, owner_id, pick_number)
);

-- ── Race Results ─────────────────────────────────────────────
create table race_results (
  id              uuid primary key default uuid_generate_v4(),
  race_id         uuid references races(id) on delete cascade,
  driver_id       uuid references drivers(id) on delete cascade,
  finish_position int,
  pole_position   boolean default false,
  fastest_lap     boolean default false,
  most_pos_gained boolean default false,
  sprint_win      boolean default false,
  sprint_pole     boolean default false,
  unique(race_id, driver_id)
);

-- ── Helper: calculate points for a result row ─────────────────
create or replace function calc_base_points(pos int)
returns numeric language sql immutable as $$
  select case
    when pos = 1              then 30
    when pos between 2 and 3  then 24
    when pos between 4 and 6  then 18
    when pos between 7 and 10 then 12
    when pos between 11 and 15 then 6
    when pos between 16 and 20 then 2
    else 0
  end;
$$;

create or replace function calc_bonus_points(
  pole bool, fl bool, mpg bool, sw bool, sp bool
) returns numeric language sql immutable as $$
  select
    (case when pole then 5 else 0 end) +
    (case when fl   then 3 else 0 end) +
    (case when mpg  then 2 else 0 end) +
    (case when sw   then 5 else 0 end) +
    (case when sp   then 3 else 0 end);
$$;

-- ── View: scored points per drafted driver per race ───────────
create or replace view driver_race_points as
select
  rr.race_id,
  rr.driver_id,
  d.name                        as driver_name,
  d.constructor                 as driver_constructor,
  rr.finish_position,
  rr.pole_position,
  rr.fastest_lap,
  rr.most_pos_gained,
  rr.sprint_win,
  rr.sprint_pole,
  calc_base_points(rr.finish_position) as base_points,
  calc_bonus_points(rr.pole_position, rr.fastest_lap, rr.most_pos_gained,
                    rr.sprint_win, rr.sprint_pole)  as bonus_points
from race_results rr
join drivers d on d.id = rr.driver_id;

-- ── View: total points per owner per race ────────────────────
create or replace view race_scores as
select
  r.id                          as race_id,
  r.round,
  r.name                        as race_name,
  r.race_date,
  r.has_sprint,
  o.id                          as owner_id,
  o.name                        as owner_name,
  o.constructor                 as owner_constructor,
  round(sum(
    (drp.base_points * case when drp.driver_constructor = o.constructor then 1.15 else 1.0 end)
    + drp.bonus_points
  )::numeric, 2)                as total_points
from races r
join drafts       dr  on dr.race_id  = r.id
join owners       o   on o.id        = dr.owner_id
join driver_race_points drp on drp.race_id  = r.id
                           and drp.driver_id = dr.driver_id
group by r.id, r.round, r.name, r.race_date, r.has_sprint,
         o.id, o.name, o.constructor;

-- ── View: season standings ────────────────────────────────────
create or replace view season_standings as
select
  o.id                              as owner_id,
  o.name                            as owner_name,
  o.constructor,
  coalesce(sum(rs.total_points), 0) as season_points
from owners o
left join race_scores rs on rs.owner_id = o.id
group by o.id, o.name, o.constructor
order by season_points desc;

-- ── View: weekly win payouts with rollover ────────────────────
create or replace view weekly_payouts as
with scores as (
  select race_id, round, race_name, owner_id, owner_name, total_points
  from race_scores
),
race_winners as (
  select
    s.race_id, s.round, s.race_name,
    s.owner_id, s.owner_name, s.total_points,
    max(s.total_points) over (partition by s.race_id) as max_pts,
    count(*) filter (where s2.total_points = max(s.total_points) over (partition by s.race_id))
      over (partition by s.race_id) as winners_count
  from scores s
  join scores s2 on s2.race_id = s.race_id
  group by s.race_id, s.round, s.race_name, s.owner_id, s.owner_name, s.total_points
)
select
  round,
  race_name,
  owner_id,
  owner_name,
  total_points,
  (winners_count > 1)             as is_tie,
  case when total_points = max_pts and winners_count = 1
    then 20 else 0 end            as winnings
from race_winners
order by round;

-- ── RLS ───────────────────────────────────────────────────────
alter table owners       enable row level security;
alter table drivers      enable row level security;
alter table races        enable row level security;
alter table drafts       enable row level security;
alter table race_results enable row level security;

create policy "public_read" on owners       for select using (true);
create policy "public_read" on drivers      for select using (true);
create policy "public_read" on races        for select using (true);
create policy "public_read" on drafts       for select using (true);
create policy "public_read" on race_results for select using (true);

create policy "auth_write" on drafts        for all using (auth.role() = 'authenticated');
create policy "auth_write" on race_results  for all using (auth.role() = 'authenticated');
create policy "auth_write" on races         for update using (auth.role() = 'authenticated');
