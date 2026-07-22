-- SafeEPI - terminais fixos de identificacao por impressao digital (Windows WBF)
-- Este modelo nunca armazena imagem, amostra ou template biometrico no Supabase.

create extension if not exists pgcrypto;

create table if not exists public.fingerprint_pairings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  terminal_name text not null check (char_length(terminal_name) between 2 and 80),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint fingerprint_pairings_expiry_check check (expires_at > created_at)
);

create table if not exists public.fingerprint_terminals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  device_id uuid not null,
  token_hash text unique check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  device_instance_hash text check (device_instance_hash is null or device_instance_hash ~ '^[0-9a-f]{64}$'),
  device_description text,
  app_version text,
  os_version text,
  active boolean not null default true,
  last_seen_at timestamptz,
  paired_by uuid references auth.users(id) on delete set null,
  paired_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (company_id, device_id)
);

create table if not exists public.fingerprint_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  terminal_id uuid not null references public.fingerprint_terminals(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  operation text not null check (operation in ('enroll', 'verify', 'delete')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled', 'expired')),
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  processing_started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  matched_employee_id uuid references public.employees(id) on delete restrict,
  success boolean,
  error_code text,
  reject_detail integer,
  unit_id integer,
  result_hash text check (result_hash is null or result_hash ~ '^[0-9a-f]{64}$'),
  delivery_batch_id uuid,
  agent_metadata jsonb not null default '{}'::jsonb,
  constraint fingerprint_commands_expiry_check check (expires_at > requested_at)
);

create table if not exists public.fingerprint_enrollments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  terminal_id uuid not null references public.fingerprint_terminals(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  sub_factor smallint not null default 2,
  active boolean not null default true,
  enrolled_at timestamptz not null default now(),
  removed_at timestamptz,
  last_verified_at timestamptz,
  last_command_id uuid references public.fingerprint_commands(id) on delete set null,
  unique (terminal_id, employee_id)
);

create table if not exists public.fingerprint_delivery_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  command_id uuid not null references public.fingerprint_commands(id) on delete restrict,
  delivery_id uuid not null references public.deliveries(id) on delete restrict,
  batch_id uuid not null,
  linked_at timestamptz not null default now(),
  unique (delivery_id),
  unique (command_id, delivery_id)
);

alter table public.fingerprint_terminals alter column token_hash drop not null;
alter table public.fingerprint_commands add column if not exists delivery_batch_id uuid;

create index if not exists fingerprint_pairings_active_idx
  on public.fingerprint_pairings (code_hash, expires_at)
  where used_at is null;
create index if not exists fingerprint_terminals_company_active_idx
  on public.fingerprint_terminals (company_id, active, last_seen_at desc);
create unique index if not exists fingerprint_terminals_active_device_instance_idx
  on public.fingerprint_terminals (device_instance_hash)
  where active = true and device_instance_hash is not null;
create index if not exists fingerprint_commands_terminal_queue_idx
  on public.fingerprint_commands (terminal_id, status, requested_at)
  where status in ('queued', 'processing');
create index if not exists fingerprint_commands_company_employee_idx
  on public.fingerprint_commands (company_id, employee_id, requested_at desc);
create index if not exists fingerprint_enrollments_employee_idx
  on public.fingerprint_enrollments (company_id, employee_id, active);
create index if not exists fingerprint_delivery_links_command_idx
  on public.fingerprint_delivery_links (command_id, batch_id);

alter table public.fingerprint_pairings enable row level security;
alter table public.fingerprint_terminals enable row level security;
alter table public.fingerprint_commands enable row level security;
alter table public.fingerprint_enrollments enable row level security;
alter table public.fingerprint_delivery_links enable row level security;

revoke all on public.fingerprint_pairings from public, anon, authenticated;
revoke all on public.fingerprint_terminals from public, anon, authenticated;
revoke all on public.fingerprint_commands from public, anon, authenticated;
revoke all on public.fingerprint_enrollments from public, anon, authenticated;
revoke all on public.fingerprint_delivery_links from public, anon, authenticated;

grant all on public.fingerprint_pairings to service_role;
grant all on public.fingerprint_terminals to service_role;
grant all on public.fingerprint_commands to service_role;
grant all on public.fingerprint_enrollments to service_role;
grant all on public.fingerprint_delivery_links to service_role;

comment on table public.fingerprint_terminals is 'Terminais Windows pareados. Guarda somente hash da credencial do agente.';
comment on table public.fingerprint_commands is 'Eventos de cadastro/verificacao WBF sem amostras ou templates biometricos.';
comment on table public.fingerprint_enrollments is 'Indice de existencia do template no banco privado local do terminal.';

notify pgrst, 'reload schema';
