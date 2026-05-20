-- ============================================================================
-- SafeEPI - RLS auditado e consolidado
-- ============================================================================
-- Objetivo:
--   1. Habilitar RLS em todas as tabelas publicas do projeto.
--   2. Remover policies antigas abertas, especialmente USING (true).
--   3. Restringir acesso por tenant usando company_id + company_users.
--   4. Bloquear acesso anonimo direto ao banco via PostgREST.
--   5. Servir como documentacao e backup das policies esperadas.
--
-- Como aplicar:
--   Rode este arquivo no SQL Editor do Supabase com uma conta administrativa.
--
-- Observacao:
--   Operacoes anonimas de captura/assinatura remota devem continuar passando
--   por API routes server-side com service_role. Nao crie policy anon para isso.
-- ============================================================================

begin;

-- ============================================================================
-- Helpers usados nas policies
-- ============================================================================

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
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'MASTER', false)
    or exists (
      select 1
      from public.company_users
      where user_id = auth.uid()
        and role = 'MASTER'
        and active = true
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

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id
  from public.company_users
  where user_id = auth.uid()
    and active = true
  order by created_at asc
  limit 1;
$$;

revoke all on function public.current_company_id() from public;
grant execute on function public.current_company_id() to authenticated;

-- ============================================================================
-- RLS habilitado em todas as tabelas publicas conhecidas
-- ============================================================================

alter table if exists public.companies enable row level security;
alter table if exists public.company_users enable row level security;
alter table if exists public.profiles enable row level security;
alter table if exists public.employees enable row level security;
alter table if exists public.ppes enable row level security;
alter table if exists public.deliveries enable row level security;
alter table if exists public.workplaces enable row level security;
alter table if exists public.stock_movements enable row level security;
alter table if exists public.trainings enable row level security;
alter table if exists public.job_titles enable row level security;
alter table if exists public.departments enable row level security;
alter table if exists public.signed_documents enable row level security;
alter table if exists public.remote_links enable row level security;
alter table if exists public.third_parties enable row level security;
alter table if exists public.stock_movements_backup_20260513_141525 enable row level security;

alter table if exists public.companies force row level security;
alter table if exists public.company_users force row level security;
alter table if exists public.profiles force row level security;
alter table if exists public.employees force row level security;
alter table if exists public.ppes force row level security;
alter table if exists public.deliveries force row level security;
alter table if exists public.workplaces force row level security;
alter table if exists public.stock_movements force row level security;
alter table if exists public.trainings force row level security;
alter table if exists public.job_titles force row level security;
alter table if exists public.departments force row level security;
alter table if exists public.signed_documents force row level security;
alter table if exists public.remote_links force row level security;
alter table if exists public.third_parties force row level security;
alter table if exists public.stock_movements_backup_20260513_141525 force row level security;

-- Bloqueio anonimo direto. O app autenticado continua com grants + RLS.
revoke all on public.companies from anon;
revoke all on public.company_users from anon;
revoke all on public.profiles from anon;
revoke all on public.employees from anon;
revoke all on public.ppes from anon;
revoke all on public.deliveries from anon;
revoke all on public.workplaces from anon;
revoke all on public.stock_movements from anon;
revoke all on public.trainings from anon;
revoke all on public.job_titles from anon;
revoke all on public.departments from anon;
revoke all on public.signed_documents from anon;
revoke all on public.remote_links from anon;
revoke all on public.third_parties from anon;
revoke all on public.stock_movements_backup_20260513_141525 from anon, authenticated;

-- ============================================================================
-- DROP de policies antigas conhecidas, abertas ou substituidas
-- ============================================================================

drop policy if exists "Permitir leitura anon de colaboradores" on public.employees;
drop policy if exists "Permitir insercao anon de colaboradores" on public.employees;
drop policy if exists "Permitir inserção anon de colaboradores" on public.employees;
drop policy if exists "Permitir leitura anon de epis" on public.ppes;
drop policy if exists "Permitir insercao anon de epis" on public.ppes;
drop policy if exists "Permitir inserção anon de epis" on public.ppes;
drop policy if exists "Permitir leitura anon de entregas" on public.deliveries;
drop policy if exists "Permitir insercao anon de entregas" on public.deliveries;
drop policy if exists "Permitir inserção anon de entregas" on public.deliveries;
drop policy if exists "Permitir update anon de entregas" on public.deliveries;
drop policy if exists "Permitir leitura anon de canteiros" on public.workplaces;
drop policy if exists "Permitir insercao anon de canteiros" on public.workplaces;
drop policy if exists "Permitir inserção anon de canteiros" on public.workplaces;
drop policy if exists "Permitir leitura anon de estoque" on public.stock_movements;
drop policy if exists "Permitir insercao anon de estoque" on public.stock_movements;
drop policy if exists "Permitir inserção anon de estoque" on public.stock_movements;
drop policy if exists "Permitir leitura anon de treinamentos" on public.trainings;
drop policy if exists "Permitir insercao anon de treinamentos" on public.trainings;
drop policy if exists "Permitir inserção anon de treinamentos" on public.trainings;
drop policy if exists "Leitura publica de links remotos" on public.remote_links;
drop policy if exists "Leitura pública de links remotos" on public.remote_links;
drop policy if exists "Service role pode tudo em remote_links" on public.remote_links;
drop policy if exists "remote_links_company_service_role_all" on public.remote_links;

drop policy if exists "companies_tenant_select" on public.companies;
drop policy if exists "companies_master_write" on public.companies;
drop policy if exists "company_users_self_select" on public.company_users;
drop policy if exists "company_users_master_write" on public.company_users;
drop policy if exists "profiles_self_select" on public.profiles;
drop policy if exists "profiles_master_select" on public.profiles;
drop policy if exists "profiles_self_update" on public.profiles;
drop policy if exists "profiles_master_update" on public.profiles;
drop policy if exists "employees_tenant_select" on public.employees;
drop policy if exists "employees_tenant_insert" on public.employees;
drop policy if exists "employees_tenant_update" on public.employees;
drop policy if exists "employees_tenant_delete" on public.employees;
drop policy if exists "ppes_tenant_select" on public.ppes;
drop policy if exists "ppes_tenant_insert" on public.ppes;
drop policy if exists "ppes_tenant_update" on public.ppes;
drop policy if exists "ppes_tenant_delete" on public.ppes;
drop policy if exists "deliveries_tenant_select" on public.deliveries;
drop policy if exists "deliveries_tenant_insert" on public.deliveries;
drop policy if exists "deliveries_tenant_update" on public.deliveries;
drop policy if exists "deliveries_tenant_delete" on public.deliveries;
drop policy if exists "workplaces_tenant_select" on public.workplaces;
drop policy if exists "workplaces_tenant_insert" on public.workplaces;
drop policy if exists "workplaces_tenant_update" on public.workplaces;
drop policy if exists "workplaces_tenant_delete" on public.workplaces;
drop policy if exists "stock_movements_tenant_select" on public.stock_movements;
drop policy if exists "stock_movements_tenant_insert" on public.stock_movements;
drop policy if exists "trainings_tenant_select" on public.trainings;
drop policy if exists "trainings_tenant_insert" on public.trainings;
drop policy if exists "trainings_tenant_update" on public.trainings;
drop policy if exists "trainings_tenant_delete" on public.trainings;
drop policy if exists "job_titles_tenant_select" on public.job_titles;
drop policy if exists "job_titles_tenant_insert" on public.job_titles;
drop policy if exists "job_titles_tenant_update" on public.job_titles;
drop policy if exists "departments_tenant_select" on public.departments;
drop policy if exists "departments_tenant_insert" on public.departments;
drop policy if exists "departments_tenant_update" on public.departments;
drop policy if exists "signed_documents_tenant_select" on public.signed_documents;
drop policy if exists "remote_links_tenant_select" on public.remote_links;
drop policy if exists "third_parties_tenant_select" on public.third_parties;
drop policy if exists "third_parties_tenant_insert" on public.third_parties;
drop policy if exists "third_parties_tenant_update" on public.third_parties;
drop policy if exists "third_parties_tenant_delete" on public.third_parties;
drop policy if exists "third_parties_service_role_all" on public.third_parties;

-- Defesa extra: remote_links ja teve policies publicas em scripts antigos.
-- Removemos qualquer policy remanescente antes de recriar a policy segura.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'remote_links'
  loop
    execute format('drop policy if exists %I on public.remote_links', policy_record.policyname);
  end loop;
end $$;

-- ============================================================================
-- Policies consolidadas
-- ============================================================================

create policy "companies_tenant_select" on public.companies
  for select to authenticated
  using (id = any(public.get_user_company_ids()) or public.is_master());

create policy "companies_master_write" on public.companies
  for all to authenticated
  using (public.is_master())
  with check (public.is_master());

create policy "company_users_self_select" on public.company_users
  for select to authenticated
  using (user_id = auth.uid() or public.is_master());

create policy "company_users_master_write" on public.company_users
  for all to authenticated
  using (public.is_master())
  with check (public.is_master());

create policy "profiles_self_select" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_master());

-- Sem self-update: evita elevacao de role via cliente.
create policy "profiles_master_update" on public.profiles
  for update to authenticated
  using (public.is_master())
  with check (public.is_master());

create policy "employees_tenant_select" on public.employees
  for select to authenticated
  using (company_id = any(public.get_user_company_ids()) or public.is_master());

create policy "employees_tenant_insert" on public.employees
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "employees_tenant_update" on public.employees
  for update to authenticated
  using (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "employees_tenant_delete" on public.employees
  for delete to authenticated
  using (public.is_master() or public.has_company_role(company_id, array['ADMIN']));

create policy "ppes_tenant_select" on public.ppes
  for select to authenticated
  using (company_id = any(public.get_user_company_ids()) or public.is_master());

create policy "ppes_tenant_insert" on public.ppes
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "ppes_tenant_update" on public.ppes
  for update to authenticated
  using (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "ppes_tenant_delete" on public.ppes
  for delete to authenticated
  using (public.is_master() or public.has_company_role(company_id, array['ADMIN']));

create policy "deliveries_tenant_select" on public.deliveries
  for select to authenticated
  using (company_id = any(public.get_user_company_ids()) or public.is_master());

create policy "deliveries_tenant_insert" on public.deliveries
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "deliveries_tenant_update" on public.deliveries
  for update to authenticated
  using (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "deliveries_tenant_delete" on public.deliveries
  for delete to authenticated
  using (public.is_master());

create policy "workplaces_tenant_select" on public.workplaces
  for select to authenticated
  using (company_id = any(public.get_user_company_ids()) or public.is_master());

create policy "workplaces_tenant_insert" on public.workplaces
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "workplaces_tenant_update" on public.workplaces
  for update to authenticated
  using (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "workplaces_tenant_delete" on public.workplaces
  for delete to authenticated
  using (public.is_master() or public.has_company_role(company_id, array['ADMIN']));

create policy "stock_movements_tenant_select" on public.stock_movements
  for select to authenticated
  using (company_id = any(public.get_user_company_ids()) or public.is_master());

create policy "stock_movements_tenant_insert" on public.stock_movements
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "trainings_tenant_select" on public.trainings
  for select to authenticated
  using (company_id = any(public.get_user_company_ids()) or public.is_master());

create policy "trainings_tenant_insert" on public.trainings
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "trainings_tenant_update" on public.trainings
  for update to authenticated
  using (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "trainings_tenant_delete" on public.trainings
  for delete to authenticated
  using (public.is_master() or public.has_company_role(company_id, array['ADMIN']));

create policy "job_titles_tenant_select" on public.job_titles
  for select to authenticated
  using (
    company_id is null
    or company_id = any(public.get_user_company_ids())
    or public.is_master()
  );

create policy "job_titles_tenant_insert" on public.job_titles
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "job_titles_tenant_update" on public.job_titles
  for update to authenticated
  using (
    company_id is not null
    and (public.is_master() or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA']))
  )
  with check (
    company_id is not null
    and (public.is_master() or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA']))
  );

create policy "departments_tenant_select" on public.departments
  for select to authenticated
  using (
    company_id is null
    or company_id = any(public.get_user_company_ids())
    or public.is_master()
  );

create policy "departments_tenant_insert" on public.departments
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "departments_tenant_update" on public.departments
  for update to authenticated
  using (
    company_id is not null
    and (public.is_master() or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA']))
  )
  with check (
    company_id is not null
    and (public.is_master() or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA']))
  );

create policy "signed_documents_tenant_select" on public.signed_documents
  for select to authenticated
  using (company_id = any(public.get_user_company_ids()) or public.is_master());

-- signed_documents write: somente API server-side/service_role.

create policy "remote_links_tenant_select" on public.remote_links
  for select to authenticated
  using (company_id = any(public.get_user_company_ids()) or public.is_master());

-- remote_links write e leitura anonima por token: somente API server-side/service_role.

create policy "third_parties_tenant_select" on public.third_parties
  for select to authenticated
  using (company_id = any(public.get_user_company_ids()) or public.is_master());

create policy "third_parties_tenant_insert" on public.third_parties
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "third_parties_tenant_update" on public.third_parties
  for update to authenticated
  using (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  )
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "third_parties_tenant_delete" on public.third_parties
  for delete to authenticated
  using (public.is_master() or public.has_company_role(company_id, array['ADMIN']));

-- Sem policies para stock_movements_backup_20260513_141525:
-- RLS ligado + grants revogados = tabela de backup inacessivel via cliente.

-- ============================================================================
-- Indices de apoio ao RLS e filtros de tenant
-- ============================================================================

create index if not exists idx_company_users_user_active
  on public.company_users(user_id, active);

create index if not exists idx_company_users_company_user
  on public.company_users(company_id, user_id);

create index if not exists idx_employees_company_active
  on public.employees(company_id, active);

create index if not exists idx_ppes_company_active
  on public.ppes(company_id, active);

create index if not exists idx_deliveries_company_date
  on public.deliveries(company_id, delivery_date desc);

create index if not exists idx_workplaces_company_active
  on public.workplaces(company_id, active);

create index if not exists idx_stock_movements_company_created
  on public.stock_movements(company_id, created_at desc);

create index if not exists idx_trainings_company_created
  on public.trainings(company_id, created_at desc);

create index if not exists idx_job_titles_company_active
  on public.job_titles(company_id, active);

create index if not exists idx_departments_company_active
  on public.departments(company_id, active);

create index if not exists idx_signed_documents_company_created
  on public.signed_documents(company_id, created_at desc);

create index if not exists idx_remote_links_company_status
  on public.remote_links(company_id, status, expires_at);

create index if not exists idx_third_parties_company_active
  on public.third_parties(company_id, active);

commit;

-- ============================================================================
-- Consultas de auditoria para rodar depois de aplicar
-- ============================================================================

-- Tabelas publicas sem RLS devem retornar zero linhas:
-- select schemaname, tablename
-- from pg_tables t
-- join pg_class c on c.relname = t.tablename
-- join pg_namespace n on n.oid = c.relnamespace and n.nspname = t.schemaname
-- where schemaname = 'public'
--   and tablename in (
--     'companies','company_users','profiles','employees','ppes','deliveries',
--     'workplaces','stock_movements','trainings','job_titles','departments',
--     'signed_documents','remote_links','third_parties',
--     'stock_movements_backup_20260513_141525'
--   )
--   and c.relrowsecurity = false;

-- Policies atuais:
-- select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
-- from pg_policies
-- where schemaname = 'public'
-- order by tablename, policyname;
