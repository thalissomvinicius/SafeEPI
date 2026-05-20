-- ==========================================================
-- SafeEPI - Base multiempresa
-- Execute depois dos scripts de schema atuais no Supabase SafeEPI.
-- ==========================================================

create extension if not exists "pgcrypto";

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  trade_name text,
  cnpj text,
  logo_url text,
  primary_color text not null default '#2563EB',
  address text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'ADMIN' check (role in ('ADMIN', 'ALMOXARIFE', 'DIRETORIA')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'ALMOXARIFE' check (role in ('ADMIN', 'ALMOXARIFE', 'DIRETORIA')),
  created_at timestamptz not null default now()
);

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cu.company_id
  from public.company_users cu
  where cu.user_id = auth.uid()
    and cu.active = true
  order by cu.created_at asc
  limit 1
$$;

create or replace function public.user_has_company(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_users cu
    where cu.user_id = auth.uid()
      and cu.company_id = target_company_id
      and cu.active = true
  )
$$;

alter table public.employees add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.ppes add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.deliveries add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.workplaces add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.stock_movements add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.trainings add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.job_titles add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.departments add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.signed_documents add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.profiles add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.remote_links add column if not exists company_id uuid references public.companies(id) on delete restrict;

alter table public.job_titles drop constraint if exists job_titles_name_unique;
alter table public.departments drop constraint if exists departments_name_unique;
create unique index if not exists job_titles_company_name_unique on public.job_titles(company_id, name);
create unique index if not exists departments_company_name_unique on public.departments(company_id, name);

create index if not exists idx_company_users_user on public.company_users(user_id, active);
create index if not exists idx_employees_company on public.employees(company_id);
create index if not exists idx_ppes_company on public.ppes(company_id);
create index if not exists idx_deliveries_company on public.deliveries(company_id);
create index if not exists idx_workplaces_company on public.workplaces(company_id);
create index if not exists idx_stock_movements_company on public.stock_movements(company_id);
create index if not exists idx_trainings_company on public.trainings(company_id);
create index if not exists idx_job_titles_company on public.job_titles(company_id);
create index if not exists idx_departments_company on public.departments(company_id);
create index if not exists idx_signed_documents_company on public.signed_documents(company_id);
create index if not exists idx_profiles_company on public.profiles(company_id);
create index if not exists idx_remote_links_company on public.remote_links(company_id);

alter table public.companies enable row level security;
alter table public.company_users enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "companies_select_own" on public.companies;
create policy "companies_select_own"
  on public.companies
  for select
  to authenticated
  using (public.user_has_company(id));

drop policy if exists "company_users_select_own" on public.company_users;
create policy "company_users_select_own"
  on public.company_users
  for select
  to authenticated
  using (user_id = auth.uid() or public.user_has_company(company_id));

drop policy if exists "companies_service_role_all" on public.companies;
create policy "companies_service_role_all"
  on public.companies
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "company_users_service_role_all" on public.company_users;
create policy "company_users_service_role_all"
  on public.company_users
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "profiles_select_own_company" on public.profiles;
create policy "profiles_select_own_company"
  on public.profiles
  for select
  to authenticated
  using (id = auth.uid() or public.user_has_company(company_id));

drop policy if exists "profiles_service_role_all" on public.profiles;
create policy "profiles_service_role_all"
  on public.profiles
  for all
  to service_role
  using (true)
  with check (true);

-- Políticas multiempresa para tabelas operacionais.
-- Elas convivem com políticas antigas; remova as políticas "anon" antigas antes de produção.

drop policy if exists "employees_company_all" on public.employees;
create policy "employees_company_all"
  on public.employees
  for all
  to authenticated
  using (public.user_has_company(company_id))
  with check (public.user_has_company(company_id));

drop policy if exists "ppes_company_all" on public.ppes;
create policy "ppes_company_all"
  on public.ppes
  for all
  to authenticated
  using (public.user_has_company(company_id))
  with check (public.user_has_company(company_id));

drop policy if exists "deliveries_company_all" on public.deliveries;
create policy "deliveries_company_all"
  on public.deliveries
  for all
  to authenticated
  using (public.user_has_company(company_id))
  with check (public.user_has_company(company_id));

drop policy if exists "workplaces_company_all" on public.workplaces;
create policy "workplaces_company_all"
  on public.workplaces
  for all
  to authenticated
  using (public.user_has_company(company_id))
  with check (public.user_has_company(company_id));

drop policy if exists "stock_movements_company_all" on public.stock_movements;
create policy "stock_movements_company_all"
  on public.stock_movements
  for all
  to authenticated
  using (public.user_has_company(company_id))
  with check (public.user_has_company(company_id));

drop policy if exists "trainings_company_all" on public.trainings;
create policy "trainings_company_all"
  on public.trainings
  for all
  to authenticated
  using (public.user_has_company(company_id))
  with check (public.user_has_company(company_id));

drop policy if exists "job_titles_company_all" on public.job_titles;
create policy "job_titles_company_all"
  on public.job_titles
  for all
  to authenticated
  using (public.user_has_company(company_id))
  with check (public.user_has_company(company_id));

drop policy if exists "departments_company_all" on public.departments;
create policy "departments_company_all"
  on public.departments
  for all
  to authenticated
  using (public.user_has_company(company_id))
  with check (public.user_has_company(company_id));

drop policy if exists "signed_documents_company_select" on public.signed_documents;
create policy "signed_documents_company_select"
  on public.signed_documents
  for select
  to authenticated
  using (public.user_has_company(company_id));

drop policy if exists "signed_documents_company_service_role_all" on public.signed_documents;
create policy "signed_documents_company_service_role_all"
  on public.signed_documents
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "remote_links_company_service_role_all" on public.remote_links;
create policy "remote_links_company_service_role_all"
  on public.remote_links
  for all
  to service_role
  using (true)
  with check (true);
