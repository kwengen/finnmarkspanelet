-- Rollemodell for Finnmarkspanelet.
-- Auth-brukere ligger i auth.users; denne tabellen lagrer kun autorisasjonen
-- som serveren trenger for å håndheve tilgang. Den eksponeres ikke til klienten.

create type public.app_role as enum ('superadministrator', 'administrator', 'bruker');

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'bruker',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_roles is
  'Serverstyrte roller for Finnmarkspanelet. Skal aldri leses direkte av nettleseren.';

alter table public.user_roles enable row level security;
revoke all on table public.user_roles from anon, authenticated;

create index if not exists user_roles_role_idx on public.user_roles(role);
