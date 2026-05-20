-- ============================================================================
-- SafeEPI - Terceiros / Tomadores
-- Cria dimensao operacional para empresas clientes atendidas por um tenant.
-- Ex.: company_id = Antares, third_parties = clientes/tomadores da Antares.
-- ============================================================================

create extension if not exists "pgcrypto";

alter table public.companies
  add column if not exists third_parties_enabled boolean not null default false;

create table if not exists public.third_parties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  trade_name text,
  cnpj text,
  contact_name text,
  phone text,
  email text,
  address text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workplaces
  add column if not exists third_party_id uuid references public.third_parties(id) on delete set null;

alter table public.employees
  add column if not exists third_party_id uuid references public.third_parties(id) on delete set null;

alter table public.deliveries
  add column if not exists third_party_id uuid references public.third_parties(id) on delete set null;

alter table public.trainings
  add column if not exists third_party_id uuid references public.third_parties(id) on delete set null;

alter table public.signed_documents
  add column if not exists third_party_id uuid references public.third_parties(id) on delete set null;

create index if not exists idx_third_parties_company on public.third_parties(company_id, active);
create index if not exists idx_third_parties_cnpj on public.third_parties(company_id, cnpj);
create index if not exists idx_workplaces_third_party on public.workplaces(third_party_id);
create index if not exists idx_employees_third_party on public.employees(third_party_id);
create index if not exists idx_deliveries_third_party on public.deliveries(third_party_id);
create index if not exists idx_trainings_third_party on public.trainings(third_party_id);
create index if not exists idx_signed_documents_third_party on public.signed_documents(third_party_id);

alter table public.third_parties enable row level security;

create or replace function public.get_user_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(company_id), '{}')
  from public.company_users
  where user_id = auth.uid()
    and active = true;
$$;

revoke all on function public.get_user_company_ids() from public;
grant execute on function public.get_user_company_ids() to authenticated;

create or replace function public.is_master()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'MASTER',
      false
    )
    or exists (
      select 1
      from public.company_users
      where user_id = auth.uid()
        and role = 'MASTER'
        and active = true
    )
    or exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and role = 'MASTER'
    );
$$;

revoke all on function public.is_master() from public;
grant execute on function public.is_master() to authenticated;

create or replace function public.has_company_role(target_company uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_users
    where user_id = auth.uid()
      and company_id = target_company
      and active = true
      and role = any(allowed_roles)
  );
$$;

revoke all on function public.has_company_role(uuid, text[]) from public;
grant execute on function public.has_company_role(uuid, text[]) to authenticated;

create or replace function public.third_parties_feature_enabled(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select c.third_parties_enabled
      from public.companies c
      where c.id = target_company_id
    ),
    false
  );
$$;

revoke all on function public.third_parties_feature_enabled(uuid) from public;
grant execute on function public.third_parties_feature_enabled(uuid) to authenticated;

drop policy if exists "third_parties_tenant_select" on public.third_parties;
create policy "third_parties_tenant_select" on public.third_parties
  for select to authenticated
  using (
    public.is_master()
    or company_id = any(public.get_user_company_ids())
  );

drop policy if exists "third_parties_tenant_insert" on public.third_parties;
create policy "third_parties_tenant_insert" on public.third_parties
  for insert to authenticated
  with check (
    public.is_master()
    or company_id = any(public.get_user_company_ids())
  );

drop policy if exists "third_parties_tenant_update" on public.third_parties;
create policy "third_parties_tenant_update" on public.third_parties
  for update to authenticated
  using (
    public.is_master()
    or company_id = any(public.get_user_company_ids())
  )
  with check (
    public.is_master()
    or company_id = any(public.get_user_company_ids())
  );

drop policy if exists "third_parties_tenant_delete" on public.third_parties;
create policy "third_parties_tenant_delete" on public.third_parties
  for delete to authenticated
  using (
    public.is_master()
    or company_id = any(public.get_user_company_ids())
  );

drop policy if exists "third_parties_service_role_all" on public.third_parties;
create policy "third_parties_service_role_all" on public.third_parties
  for all to service_role
  using (true)
  with check (true);
