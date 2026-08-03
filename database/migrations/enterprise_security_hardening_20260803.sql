-- SafeEPI - enterprise multi-tenant security reconciliation.
--
-- Removes legacy permissive policies that unintentionally granted every
-- company member write access, moves RLS helpers out of the exposed public
-- schema, and keeps service-only tables inaccessible through the Data API.

set lock_timeout = '10s';

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.safeepi_get_user_company_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(cu.company_id), '{}'::uuid[])
  from public.company_users cu
  where cu.user_id = (select auth.uid())
    and cu.active = true
$$;

create or replace function private.safeepi_is_master()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role' = 'MASTER', false)
    or exists (
      select 1
      from public.company_users cu
      where cu.user_id = (select auth.uid())
        and cu.role = 'MASTER'
        and cu.active = true
    )
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'MASTER'
    )
$$;

create or replace function private.safeepi_has_company_role(
  target_company uuid,
  allowed_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users cu
    where cu.user_id = (select auth.uid())
      and cu.company_id = target_company
      and cu.active = true
      and cu.role = any(allowed_roles)
  )
$$;

create or replace function private.safeepi_user_has_company(target_company uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users cu
    where cu.user_id = (select auth.uid())
      and cu.company_id = target_company
      and cu.active = true
  )
$$;

revoke all on function private.safeepi_get_user_company_ids() from public, anon;
revoke all on function private.safeepi_is_master() from public, anon;
revoke all on function private.safeepi_has_company_role(uuid, text[]) from public, anon;
revoke all on function private.safeepi_user_has_company(uuid) from public, anon;
grant execute on function private.safeepi_get_user_company_ids() to authenticated, service_role;
grant execute on function private.safeepi_is_master() to authenticated, service_role;
grant execute on function private.safeepi_has_company_role(uuid, text[]) to authenticated, service_role;
grant execute on function private.safeepi_user_has_company(uuid) to authenticated, service_role;

-- Legacy helpers stay in place for migration compatibility, but are no longer
-- exposed as callable RPCs to browser roles.
revoke execute on function public.current_company_id() from public, anon, authenticated;
revoke execute on function public.get_user_company_ids() from public, anon, authenticated;
revoke execute on function public.has_company_role(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.is_master() from public, anon, authenticated;
revoke execute on function public.is_master_user() from public, anon, authenticated;
revoke execute on function public.third_parties_feature_enabled(uuid) from public, anon, authenticated;
revoke execute on function public.user_has_company(uuid) from public, anon, authenticated;
grant execute on function public.current_company_id() to service_role;
grant execute on function public.get_user_company_ids() to service_role;
grant execute on function public.has_company_role(uuid, text[]) to service_role;
grant execute on function public.is_master() to service_role;
grant execute on function public.is_master_user() to service_role;
grant execute on function public.third_parties_feature_enabled(uuid) to service_role;
grant execute on function public.user_has_company(uuid) to service_role;

-- Prevent new functions from being executable by every role by default.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- Employees -----------------------------------------------------------------
drop policy if exists "employees_company_all" on public.employees;
drop policy if exists "employees_tenant_select" on public.employees;
drop policy if exists "employees_tenant_insert" on public.employees;
drop policy if exists "employees_tenant_update" on public.employees;
drop policy if exists "employees_tenant_delete" on public.employees;

create policy "employees_tenant_select" on public.employees
  for select to authenticated
  using (
    company_id = any(((select private.safeepi_get_user_company_ids()))::uuid[])
    or (select private.safeepi_is_master())
  );
create policy "employees_tenant_insert" on public.employees
  for insert to authenticated
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "employees_tenant_update" on public.employees
  for update to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "employees_tenant_delete" on public.employees
  for delete to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN'])
  );

-- PPEs ----------------------------------------------------------------------
drop policy if exists "ppes_company_all" on public.ppes;
drop policy if exists "ppes_tenant_select" on public.ppes;
drop policy if exists "ppes_tenant_insert" on public.ppes;
drop policy if exists "ppes_tenant_update" on public.ppes;
drop policy if exists "ppes_tenant_delete" on public.ppes;

create policy "ppes_tenant_select" on public.ppes
  for select to authenticated
  using (
    company_id = any(((select private.safeepi_get_user_company_ids()))::uuid[])
    or (select private.safeepi_is_master())
  );
create policy "ppes_tenant_insert" on public.ppes
  for insert to authenticated
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "ppes_tenant_update" on public.ppes
  for update to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "ppes_tenant_delete" on public.ppes
  for delete to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN'])
  );

-- Deliveries ----------------------------------------------------------------
drop policy if exists "deliveries_company_all" on public.deliveries;
drop policy if exists "deliveries_tenant_select" on public.deliveries;
drop policy if exists "deliveries_tenant_insert" on public.deliveries;
drop policy if exists "deliveries_tenant_update" on public.deliveries;
drop policy if exists "deliveries_tenant_delete" on public.deliveries;

create policy "deliveries_tenant_select" on public.deliveries
  for select to authenticated
  using (
    company_id = any(((select private.safeepi_get_user_company_ids()))::uuid[])
    or (select private.safeepi_is_master())
  );
create policy "deliveries_tenant_insert" on public.deliveries
  for insert to authenticated
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "deliveries_tenant_update" on public.deliveries
  for update to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "deliveries_tenant_delete" on public.deliveries
  for delete to authenticated
  using ((select private.safeepi_is_master()));

-- Workplaces ----------------------------------------------------------------
drop policy if exists "workplaces_company_all" on public.workplaces;
drop policy if exists "workplaces_tenant_select" on public.workplaces;
drop policy if exists "workplaces_tenant_insert" on public.workplaces;
drop policy if exists "workplaces_tenant_update" on public.workplaces;
drop policy if exists "workplaces_tenant_delete" on public.workplaces;

create policy "workplaces_tenant_select" on public.workplaces
  for select to authenticated
  using (
    company_id = any(((select private.safeepi_get_user_company_ids()))::uuid[])
    or (select private.safeepi_is_master())
  );
create policy "workplaces_tenant_insert" on public.workplaces
  for insert to authenticated
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "workplaces_tenant_update" on public.workplaces
  for update to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "workplaces_tenant_delete" on public.workplaces
  for delete to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN'])
  );

-- Trainings -----------------------------------------------------------------
drop policy if exists "trainings_company_all" on public.trainings;
drop policy if exists "trainings_tenant_select" on public.trainings;
drop policy if exists "trainings_tenant_insert" on public.trainings;
drop policy if exists "trainings_tenant_update" on public.trainings;
drop policy if exists "trainings_tenant_delete" on public.trainings;

create policy "trainings_tenant_select" on public.trainings
  for select to authenticated
  using (
    company_id = any(((select private.safeepi_get_user_company_ids()))::uuid[])
    or (select private.safeepi_is_master())
  );
create policy "trainings_tenant_insert" on public.trainings
  for insert to authenticated
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "trainings_tenant_update" on public.trainings
  for update to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "trainings_tenant_delete" on public.trainings
  for delete to authenticated
  using ((select private.safeepi_is_master()));

-- Stock movements -----------------------------------------------------------
drop policy if exists "stock_movements_company_all" on public.stock_movements;
drop policy if exists "stock_movements_tenant_select" on public.stock_movements;
drop policy if exists "stock_movements_tenant_insert" on public.stock_movements;

create policy "stock_movements_tenant_select" on public.stock_movements
  for select to authenticated
  using (
    company_id = any(((select private.safeepi_get_user_company_ids()))::uuid[])
    or (select private.safeepi_is_master())
  );
create policy "stock_movements_tenant_insert" on public.stock_movements
  for insert to authenticated
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

-- Company catalogs ----------------------------------------------------------
drop policy if exists "job_titles_company_all" on public.job_titles;
drop policy if exists "job_titles_master_all" on public.job_titles;
drop policy if exists "job_titles_tenant_select" on public.job_titles;
drop policy if exists "job_titles_tenant_insert" on public.job_titles;
drop policy if exists "job_titles_tenant_update" on public.job_titles;
drop policy if exists "job_titles_tenant_delete" on public.job_titles;

create policy "job_titles_tenant_select" on public.job_titles
  for select to authenticated
  using (
    company_id = any(((select private.safeepi_get_user_company_ids()))::uuid[])
    or (select private.safeepi_is_master())
  );
create policy "job_titles_tenant_insert" on public.job_titles
  for insert to authenticated
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "job_titles_tenant_update" on public.job_titles
  for update to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "job_titles_tenant_delete" on public.job_titles
  for delete to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN'])
  );

drop policy if exists "departments_company_all" on public.departments;
drop policy if exists "departments_master_all" on public.departments;
drop policy if exists "departments_tenant_select" on public.departments;
drop policy if exists "departments_tenant_insert" on public.departments;
drop policy if exists "departments_tenant_update" on public.departments;
drop policy if exists "departments_tenant_delete" on public.departments;

create policy "departments_tenant_select" on public.departments
  for select to authenticated
  using (
    company_id = any(((select private.safeepi_get_user_company_ids()))::uuid[])
    or (select private.safeepi_is_master())
  );
create policy "departments_tenant_insert" on public.departments
  for insert to authenticated
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "departments_tenant_update" on public.departments
  for update to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );
create policy "departments_tenant_delete" on public.departments
  for delete to authenticated
  using (
    (select private.safeepi_is_master())
    or private.safeepi_has_company_role(company_id, array['ADMIN'])
  );

-- Tenant metadata -----------------------------------------------------------
drop policy if exists "companies_master_write" on public.companies;
drop policy if exists "companies_select_own" on public.companies;
drop policy if exists "companies_tenant_select" on public.companies;
create policy "companies_tenant_select" on public.companies
  for select to authenticated
  using (
    id = any(((select private.safeepi_get_user_company_ids()))::uuid[])
    or (select private.safeepi_is_master())
  );
create policy "companies_master_insert" on public.companies
  for insert to authenticated
  with check ((select private.safeepi_is_master()));
create policy "companies_master_update" on public.companies
  for update to authenticated
  using ((select private.safeepi_is_master()))
  with check ((select private.safeepi_is_master()));
create policy "companies_master_delete" on public.companies
  for delete to authenticated
  using ((select private.safeepi_is_master()));

drop policy if exists "company_users_master_write" on public.company_users;
drop policy if exists "company_users_select_own" on public.company_users;
drop policy if exists "company_users_self_select" on public.company_users;
create policy "company_users_tenant_select" on public.company_users
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.safeepi_user_has_company(company_id)
    or (select private.safeepi_is_master())
  );
create policy "company_users_master_insert" on public.company_users
  for insert to authenticated
  with check ((select private.safeepi_is_master()));
create policy "company_users_master_update" on public.company_users
  for update to authenticated
  using ((select private.safeepi_is_master()))
  with check ((select private.safeepi_is_master()));
create policy "company_users_master_delete" on public.company_users
  for delete to authenticated
  using ((select private.safeepi_is_master()));

drop policy if exists "profiles_select_own_company" on public.profiles;
drop policy if exists "profiles_self_select" on public.profiles;
create policy "profiles_tenant_select" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.safeepi_user_has_company(company_id)
    or (select private.safeepi_is_master())
  );

-- Documents and remote links ------------------------------------------------
drop policy if exists "signed_documents_company_select" on public.signed_documents;
drop policy if exists "signed_documents_tenant_select" on public.signed_documents;
drop policy if exists "signed_documents_company_service_role_all" on public.signed_documents;
drop policy if exists "signed_documents_service_role_all" on public.signed_documents;
create policy "signed_documents_tenant_select" on public.signed_documents
  for select to authenticated
  using (
    company_id = any(((select private.safeepi_get_user_company_ids()))::uuid[])
    or (select private.safeepi_is_master())
  );
create policy "signed_documents_service_role_all" on public.signed_documents
  for all to service_role using (true) with check (true);

drop policy if exists "remote_links_tenant_select" on public.remote_links;
create policy "remote_links_tenant_select" on public.remote_links
  for select to authenticated
  using (
    company_id = any(((select private.safeepi_get_user_company_ids()))::uuid[])
    or (select private.safeepi_is_master())
  );

notify pgrst, 'reload schema';
