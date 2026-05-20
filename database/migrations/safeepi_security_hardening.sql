-- ============================================================================
-- SafeEPI — Hardening de Segurança (RLS multi-tenant + índices + helpers)
-- ----------------------------------------------------------------------------
-- Substitui as policies "USING (true)" por filtragem real por company_id.
--
-- IMPORTANTE — Antes de rodar:
--   1. Faça backup do banco de produção.
--   2. Garanta que existem as tabelas: companies, profiles, company_users.
--      Se ainda não existirem, rode primeiro o safeepi_multi_company.sql
--      (referenciado no código). Este script depende delas.
--   3. Após rodar, faça um teste end-to-end do app: login, listagem,
--      criação de entrega, e fluxo remoto. As policies passam a exigir
--      um JWT válido com auth.uid() correspondente em company_users.
--   4. Ative signup público SOMENTE se necessário; veja "Notas finais"
--      no fim deste arquivo.
--
-- Ordem deste script:
--   A. Helper functions SECURITY DEFINER (não recursivas com RLS)
--   B. Adicionar company_id onde faltava (job_titles, departments)
--   C. DROP das policies abertas + CREATE das policies seguras
--   D. Índices em company_id e colunas de filtro frequente
--   E. Hardening do bucket de storage (signed URLs)
-- ============================================================================

-- ============================================================================
-- A. HELPER FUNCTIONS
-- ============================================================================
-- get_user_company_ids(): retorna os company_ids ativos do usuário corrente.
-- Usa SECURITY DEFINER para evitar recursão de RLS na própria company_users.
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

-- is_master(): true se o usuário tem role MASTER em qualquer registro
-- de company_users OU se app_metadata.role = 'MASTER'.
-- IMPORTANTE: usamos app_metadata (não-modificável pelo cliente), nunca
-- user_metadata.
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
    );
$$;

revoke all on function public.is_master() from public;
grant execute on function public.is_master() to authenticated;

-- has_company_role(target_company uuid, allowed_roles text[])
-- usa-se para policies de UPDATE/DELETE que dependem do nível de role
-- dentro da empresa.
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

-- ============================================================================
-- B. ADICIONAR company_id ONDE FALTAVA
-- ============================================================================
alter table public.job_titles
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.departments
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

-- ============================================================================
-- C. POLICIES — DROP das abertas + CREATE das seguras
-- ============================================================================

-- ---------- employees ----------
alter table public.employees enable row level security;
drop policy if exists "Permitir leitura anon de colaboradores"   on public.employees;
drop policy if exists "Permitir inserção anon de colaboradores"  on public.employees;
drop policy if exists "Permitir insercao anon de colaboradores"  on public.employees;
drop policy if exists "employees_tenant_select"                  on public.employees;
drop policy if exists "employees_tenant_insert"                  on public.employees;
drop policy if exists "employees_tenant_update"                  on public.employees;
drop policy if exists "employees_tenant_delete"                  on public.employees;

create policy "employees_tenant_select" on public.employees
  for select to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master());

create policy "employees_tenant_insert" on public.employees
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "employees_tenant_update" on public.employees
  for update to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master())
  with check (company_id = any (public.get_user_company_ids()) or public.is_master());

create policy "employees_tenant_delete" on public.employees
  for delete to authenticated
  using (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN'])
  );

-- ---------- ppes ----------
alter table public.ppes enable row level security;
drop policy if exists "Permitir leitura anon de epis"   on public.ppes;
drop policy if exists "Permitir inserção anon de epis"  on public.ppes;
drop policy if exists "Permitir insercao anon de epis"  on public.ppes;
drop policy if exists "ppes_tenant_select" on public.ppes;
drop policy if exists "ppes_tenant_insert" on public.ppes;
drop policy if exists "ppes_tenant_update" on public.ppes;
drop policy if exists "ppes_tenant_delete" on public.ppes;

create policy "ppes_tenant_select" on public.ppes
  for select to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master());

create policy "ppes_tenant_insert" on public.ppes
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "ppes_tenant_update" on public.ppes
  for update to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master())
  with check (company_id = any (public.get_user_company_ids()) or public.is_master());

create policy "ppes_tenant_delete" on public.ppes
  for delete to authenticated
  using (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN'])
  );

-- ---------- deliveries ----------
alter table public.deliveries enable row level security;
drop policy if exists "Permitir leitura anon de entregas"   on public.deliveries;
drop policy if exists "Permitir inserção anon de entregas"  on public.deliveries;
drop policy if exists "Permitir insercao anon de entregas"  on public.deliveries;
drop policy if exists "Permitir update anon de entregas"    on public.deliveries;
drop policy if exists "deliveries_tenant_select" on public.deliveries;
drop policy if exists "deliveries_tenant_insert" on public.deliveries;
drop policy if exists "deliveries_tenant_update" on public.deliveries;
drop policy if exists "deliveries_tenant_delete" on public.deliveries;

create policy "deliveries_tenant_select" on public.deliveries
  for select to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master());

create policy "deliveries_tenant_insert" on public.deliveries
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "deliveries_tenant_update" on public.deliveries
  for update to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master())
  with check (company_id = any (public.get_user_company_ids()) or public.is_master());

create policy "deliveries_tenant_delete" on public.deliveries
  for delete to authenticated
  using (public.is_master());

-- ---------- trainings ----------
alter table public.trainings enable row level security;
drop policy if exists "Permitir leitura anon de treinamentos"   on public.trainings;
drop policy if exists "Permitir inserção anon de treinamentos"  on public.trainings;
drop policy if exists "Permitir insercao anon de treinamentos"  on public.trainings;
drop policy if exists "trainings_tenant_select" on public.trainings;
drop policy if exists "trainings_tenant_insert" on public.trainings;
drop policy if exists "trainings_tenant_update" on public.trainings;
drop policy if exists "trainings_tenant_delete" on public.trainings;

create policy "trainings_tenant_select" on public.trainings
  for select to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master());

create policy "trainings_tenant_insert" on public.trainings
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "trainings_tenant_update" on public.trainings
  for update to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master())
  with check (company_id = any (public.get_user_company_ids()) or public.is_master());

create policy "trainings_tenant_delete" on public.trainings
  for delete to authenticated
  using (public.is_master());

-- ---------- workplaces ----------
alter table public.workplaces enable row level security;
drop policy if exists "Permitir leitura anon de canteiros"   on public.workplaces;
drop policy if exists "Permitir inserção anon de canteiros"  on public.workplaces;
drop policy if exists "Permitir insercao anon de canteiros"  on public.workplaces;
drop policy if exists "workplaces_tenant_select" on public.workplaces;
drop policy if exists "workplaces_tenant_insert" on public.workplaces;
drop policy if exists "workplaces_tenant_update" on public.workplaces;
drop policy if exists "workplaces_tenant_delete" on public.workplaces;

create policy "workplaces_tenant_select" on public.workplaces
  for select to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master());

create policy "workplaces_tenant_insert" on public.workplaces
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

create policy "workplaces_tenant_update" on public.workplaces
  for update to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master())
  with check (company_id = any (public.get_user_company_ids()) or public.is_master());

create policy "workplaces_tenant_delete" on public.workplaces
  for delete to authenticated
  using (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN'])
  );

-- ---------- stock_movements ----------
alter table public.stock_movements enable row level security;
drop policy if exists "Permitir leitura anon de estoque"   on public.stock_movements;
drop policy if exists "Permitir inserção anon de estoque"  on public.stock_movements;
drop policy if exists "Permitir insercao anon de estoque"  on public.stock_movements;
drop policy if exists "stock_movements_tenant_select" on public.stock_movements;
drop policy if exists "stock_movements_tenant_insert" on public.stock_movements;

create policy "stock_movements_tenant_select" on public.stock_movements
  for select to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master());

create policy "stock_movements_tenant_insert" on public.stock_movements
  for insert to authenticated
  with check (
    public.is_master()
    or public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA'])
  );

-- ---------- signed_documents ----------
alter table public.signed_documents enable row level security;
drop policy if exists "signed_documents_select_authenticated" on public.signed_documents;
drop policy if exists "signed_documents_service_role_all"     on public.signed_documents;
drop policy if exists "signed_documents_tenant_select"        on public.signed_documents;

create policy "signed_documents_tenant_select" on public.signed_documents
  for select to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master());

-- INSERT/UPDATE/DELETE: apenas service role (rotas server-side).
-- (Nenhuma policy criada → bloqueado para roles não-service.)

-- ---------- job_titles ----------
alter table public.job_titles enable row level security;
drop policy if exists "job_titles_select_authenticated" on public.job_titles;
drop policy if exists "job_titles_insert_authenticated" on public.job_titles;
drop policy if exists "job_titles_update_authenticated" on public.job_titles;
drop policy if exists "job_titles_tenant_select" on public.job_titles;
drop policy if exists "job_titles_tenant_insert" on public.job_titles;
drop policy if exists "job_titles_tenant_update" on public.job_titles;

create policy "job_titles_tenant_select" on public.job_titles
  for select to authenticated
  using (
    company_id is null  -- linhas legadas globais
    or company_id = any (public.get_user_company_ids())
    or public.is_master()
  );

create policy "job_titles_tenant_insert" on public.job_titles
  for insert to authenticated
  with check (
    public.is_master()
    or (company_id is not null and public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA']))
  );

create policy "job_titles_tenant_update" on public.job_titles
  for update to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master())
  with check (company_id = any (public.get_user_company_ids()) or public.is_master());

-- ---------- departments ----------
alter table public.departments enable row level security;
drop policy if exists "departments_select_authenticated" on public.departments;
drop policy if exists "departments_insert_authenticated" on public.departments;
drop policy if exists "departments_update_authenticated" on public.departments;
drop policy if exists "departments_tenant_select" on public.departments;
drop policy if exists "departments_tenant_insert" on public.departments;
drop policy if exists "departments_tenant_update" on public.departments;

create policy "departments_tenant_select" on public.departments
  for select to authenticated
  using (
    company_id is null
    or company_id = any (public.get_user_company_ids())
    or public.is_master()
  );

create policy "departments_tenant_insert" on public.departments
  for insert to authenticated
  with check (
    public.is_master()
    or (company_id is not null and public.has_company_role(company_id, array['ADMIN','ALMOXARIFE','DIRETORIA']))
  );

create policy "departments_tenant_update" on public.departments
  for update to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master())
  with check (company_id = any (public.get_user_company_ids()) or public.is_master());

-- ---------- remote_links ----------
-- Importante: links remotos são acessados sem login. A leitura/escrita
-- pelo trabalhador é feita SEMPRE via rotas server-side (que usam o
-- service_role e validam o token). Portanto: bloqueamos acesso direto
-- via PostgREST com anon/authenticated.
alter table public.remote_links enable row level security;
drop policy if exists "Leitura pública de links remotos"        on public.remote_links;
drop policy if exists "Leitura publica de links remotos"        on public.remote_links;
drop policy if exists "Service role pode tudo em remote_links"  on public.remote_links;
drop policy if exists "remote_links_tenant_select"              on public.remote_links;

-- MASTER e usuários da empresa-dona podem ver os links emitidos.
create policy "remote_links_tenant_select" on public.remote_links
  for select to authenticated
  using (company_id = any (public.get_user_company_ids()) or public.is_master());

-- INSERT/UPDATE/DELETE somente via service role.

-- ---------- profiles / companies / company_users ----------
-- Garante RLS habilitado e policies mínimas. Ajuste conforme seu
-- modelo real se já houver scripts próprios para essas tabelas.
alter table if exists public.profiles      enable row level security;
alter table if exists public.companies     enable row level security;
alter table if exists public.company_users enable row level security;

-- profiles: cada usuário vê o próprio; MASTER vê todos.
drop policy if exists "profiles_self_select" on public.profiles;
drop policy if exists "profiles_master_select" on public.profiles;
create policy "profiles_self_select" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_master());

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_master())
  with check (id = auth.uid() or public.is_master());

-- companies: visíveis para usuários da empresa; MASTER vê todas.
drop policy if exists "companies_tenant_select" on public.companies;
create policy "companies_tenant_select" on public.companies
  for select to authenticated
  using (id = any (public.get_user_company_ids()) or public.is_master());

-- company_users: o próprio usuário vê o próprio vínculo; MASTER vê todos.
drop policy if exists "company_users_self_select" on public.company_users;
create policy "company_users_self_select" on public.company_users
  for select to authenticated
  using (user_id = auth.uid() or public.is_master());

-- ============================================================================
-- D. ÍNDICES (queries multi-tenant ficam ~ordens de magnitude mais rápidas)
-- ============================================================================
create index if not exists idx_employees_company_active
  on public.employees(company_id, active);
create index if not exists idx_employees_cpf
  on public.employees(cpf);

create index if not exists idx_ppes_company_active
  on public.ppes(company_id, active);

create index if not exists idx_deliveries_company_date
  on public.deliveries(company_id, delivery_date desc);
create index if not exists idx_deliveries_employee
  on public.deliveries(employee_id);
create index if not exists idx_deliveries_ppe
  on public.deliveries(ppe_id);

create index if not exists idx_trainings_company_completion
  on public.trainings(company_id, completion_date desc);
create index if not exists idx_trainings_employee
  on public.trainings(employee_id);

create index if not exists idx_workplaces_company_active
  on public.workplaces(company_id, active);

create index if not exists idx_stock_movements_company_created
  on public.stock_movements(company_id, created_at desc);
create index if not exists idx_stock_movements_ppe
  on public.stock_movements(ppe_id);

create index if not exists idx_signed_documents_company_created
  on public.signed_documents(company_id, created_at desc);

create index if not exists idx_remote_links_company_status
  on public.remote_links(company_id, status);
create index if not exists idx_remote_links_employee_type_status
  on public.remote_links(employee_id, type, status);

create index if not exists idx_company_users_user_active
  on public.company_users(user_id, active);
create index if not exists idx_company_users_company_role
  on public.company_users(company_id, role) where active;

create index if not exists idx_job_titles_company
  on public.job_titles(company_id);
create index if not exists idx_departments_company
  on public.departments(company_id);

-- ============================================================================
-- E. RECARREGAR SCHEMA PostgREST
-- ============================================================================
notify pgrst, 'reload schema';

-- ============================================================================
-- NOTAS FINAIS — CHECKLIST PÓS-DEPLOY
-- ----------------------------------------------------------------------------
-- 1. STORAGE (CRÍTICO):
--    O bucket "ppe_signatures" precisa virar PRIVADO (Dashboard → Storage).
--    Hoje todos os PDFs/assinaturas/biometria estão acessíveis via URL pública.
--    Após privar, o frontend precisará usar createSignedUrl() em vez de
--    getPublicUrl(); as rotas server-side já estão preparadas para isso.
--
-- 2. SERVICE ROLE KEY:
--    Rotacione SUPABASE_SERVICE_ROLE_KEY no Dashboard
--    (Settings → API → Reset service_role secret) e atualize o ambiente
--    de produção (Vercel/host) IMEDIATAMENTE. A key foi exposta.
--
-- 3. SIGNUP PÚBLICO:
--    No Dashboard Supabase → Authentication → Providers → Email,
--    desabilite "Allow new users to sign up" se o app não deve aceitar
--    auto-cadastro. Caso contrário, cada signup cria empresa nova.
--
-- 4. APP_METADATA vs USER_METADATA:
--    Promover usuários a MASTER deve ser feito via:
--      supabaseAdmin.auth.admin.updateUserById(id, {
--        app_metadata: { role: 'MASTER' }
--      })
--    NUNCA via user_metadata (gravável pelo cliente).
--
-- 5. TESTE DAS POLICIES:
--    Antes de remover o ADMIN_BYPASS_EMAILS do código, teste com um usuário
--    não-master que ele consegue enxergar APENAS dados da própria empresa.
-- ============================================================================
