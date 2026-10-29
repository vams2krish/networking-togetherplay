create schema if not exists togetherplay;
revoke all on schema togetherplay from public,anon,authenticated;
create table if not exists togetherplay.rooms(id text primary key,data jsonb not null,expires_at timestamptz not null);
create index if not exists rooms_expiry_idx on togetherplay.rooms(expires_at);
create table if not exists togetherplay.creation_limits(identity text primary key,count integer not null,resets_at timestamptz not null);
alter table togetherplay.rooms enable row level security;
alter table togetherplay.creation_limits enable row level security;
-- Provision this dedicated LOGIN role separately; never commit its password.
grant usage on schema togetherplay to togetherplay_backend;
grant select,insert,update,delete on togetherplay.rooms,togetherplay.creation_limits to togetherplay_backend;
create policy backend_rooms on togetherplay.rooms to togetherplay_backend using(true) with check(true);
create policy backend_limits on togetherplay.creation_limits to togetherplay_backend using(true) with check(true);
