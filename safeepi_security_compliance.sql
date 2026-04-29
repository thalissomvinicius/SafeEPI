-- SafeEPI - multiempresa, RLS forte, auditoria e LGPD
-- Rode este arquivo depois dos scripts estruturais já existentes.

create extension if not exists "pgcrypto";

-- Empresas e vínculos de usuários
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  document text,
  active boolean not null default true,
  created_at timestamptz not null default now()
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
    where cu.company_id = target_company_id
      and cu.user_id = auth.uid()
      and cu.active = true
  );
$$;

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cu.company_id
  from public.company_users cu
  join public.companies c on c.id = cu.company_id
  where cu.user_id = auth.uid()
    and cu.active = true
    and c.active = true
  order by cu.created_at asc
  limit 1;
$$;

alter table public.companies enable row level security;
alter table public.company_users enable row level security;

drop policy if exists companies_member_select on public.companies;
create policy companies_member_select
  on public.companies for select
  to authenticated
  using (public.user_has_company(id));

drop policy if exists company_users_member_select on public.company_users;
create policy company_users_member_select
  on public.company_users for select
  to authenticated
  using (public.user_has_company(company_id));

drop policy if exists company_users_service_all on public.company_users;
create policy company_users_service_all
  on public.company_users for all
  to service_role
  using (true)
  with check (true);

-- Coluna company_id nas tabelas operacionais.
alter table public.employees add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.ppes add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.deliveries add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.workplaces add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.stock_movements add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.trainings add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.job_titles add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.departments add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.signed_documents add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.remote_links add column if not exists company_id uuid references public.companies(id) on delete restrict;
alter table public.profiles add column if not exists company_id uuid references public.companies(id) on delete set null;

create index if not exists idx_employees_company_id on public.employees(company_id);
create index if not exists idx_ppes_company_id on public.ppes(company_id);
create index if not exists idx_deliveries_company_id on public.deliveries(company_id);
create index if not exists idx_workplaces_company_id on public.workplaces(company_id);
create index if not exists idx_stock_movements_company_id on public.stock_movements(company_id);
create index if not exists idx_trainings_company_id on public.trainings(company_id);
create index if not exists idx_job_titles_company_id on public.job_titles(company_id);
create index if not exists idx_departments_company_id on public.departments(company_id);
create index if not exists idx_signed_documents_company_id on public.signed_documents(company_id);
create index if not exists idx_remote_links_company_id on public.remote_links(company_id);

-- LGPD/biometria no cadastro do colaborador.
alter table public.employees add column if not exists biometric_consent boolean not null default false;
alter table public.employees add column if not exists biometric_consent_at timestamptz;
alter table public.employees add column if not exists biometric_consent_method text;
alter table public.employees add column if not exists biometric_consent_text text;
alter table public.employees add column if not exists biometric_revoked_at timestamptz;

-- Remove políticas antigas abertas e substitui por políticas por empresa.
drop policy if exists "Permitir leitura anon de colaboradores" on public.employees;
drop policy if exists "Permitir inserção anon de colaboradores" on public.employees;
drop policy if exists "Permitir leitura anon de epis" on public.ppes;
drop policy if exists "Permitir inserção anon de epis" on public.ppes;
drop policy if exists "Permitir leitura anon de entregas" on public.deliveries;
drop policy if exists "Permitir inserção anon de entregas" on public.deliveries;
drop policy if exists "Permitir update anon de entregas" on public.deliveries;
drop policy if exists "Permitir leitura anon de canteiros" on public.workplaces;
drop policy if exists "Permitir inserção anon de canteiros" on public.workplaces;
drop policy if exists "Permitir leitura anon de estoque" on public.stock_movements;
drop policy if exists "Permitir inserção anon de estoque" on public.stock_movements;
drop policy if exists "Permitir leitura anon de treinamentos" on public.trainings;
drop policy if exists "Permitir inserção anon de treinamentos" on public.trainings;
drop policy if exists "job_titles_select_authenticated" on public.job_titles;
drop policy if exists "job_titles_insert_authenticated" on public.job_titles;
drop policy if exists "job_titles_update_authenticated" on public.job_titles;
drop policy if exists "departments_select_authenticated" on public.departments;
drop policy if exists "departments_insert_authenticated" on public.departments;
drop policy if exists "departments_update_authenticated" on public.departments;
drop policy if exists "signed_documents_select_authenticated" on public.signed_documents;
drop policy if exists "Leitura pública de links remotos" on public.remote_links;

alter table public.employees enable row level security;
alter table public.ppes enable row level security;
alter table public.deliveries enable row level security;
alter table public.workplaces enable row level security;
alter table public.stock_movements enable row level security;
alter table public.trainings enable row level security;
alter table public.job_titles enable row level security;
alter table public.departments enable row level security;
alter table public.signed_documents enable row level security;
alter table public.remote_links enable row level security;

create or replace function public.set_current_company_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    new.company_id := public.current_company_id();
  end if;

  if new.company_id is null then
    raise exception 'Empresa ativa nao encontrada para o usuario atual.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_employees_set_company on public.employees;
create trigger trg_employees_set_company before insert on public.employees for each row execute function public.set_current_company_id();
drop trigger if exists trg_ppes_set_company on public.ppes;
create trigger trg_ppes_set_company before insert on public.ppes for each row execute function public.set_current_company_id();
drop trigger if exists trg_deliveries_set_company on public.deliveries;
create trigger trg_deliveries_set_company before insert on public.deliveries for each row execute function public.set_current_company_id();
drop trigger if exists trg_workplaces_set_company on public.workplaces;
create trigger trg_workplaces_set_company before insert on public.workplaces for each row execute function public.set_current_company_id();
drop trigger if exists trg_stock_movements_set_company on public.stock_movements;
create trigger trg_stock_movements_set_company before insert on public.stock_movements for each row execute function public.set_current_company_id();
drop trigger if exists trg_trainings_set_company on public.trainings;
create trigger trg_trainings_set_company before insert on public.trainings for each row execute function public.set_current_company_id();
drop trigger if exists trg_job_titles_set_company on public.job_titles;
create trigger trg_job_titles_set_company before insert on public.job_titles for each row execute function public.set_current_company_id();
drop trigger if exists trg_departments_set_company on public.departments;
create trigger trg_departments_set_company before insert on public.departments for each row execute function public.set_current_company_id();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'employees','ppes','deliveries','workplaces','stock_movements',
    'trainings','job_titles','departments','signed_documents','remote_links'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', table_name || '_company_select', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (public.user_has_company(company_id))', table_name || '_company_select', table_name);

    execute format('drop policy if exists %I on public.%I', table_name || '_company_insert', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.user_has_company(company_id))', table_name || '_company_insert', table_name);

    execute format('drop policy if exists %I on public.%I', table_name || '_company_update', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (public.user_has_company(company_id)) with check (public.user_has_company(company_id))', table_name || '_company_update', table_name);

    execute format('drop policy if exists %I on public.%I', table_name || '_company_delete', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (public.user_has_company(company_id))', table_name || '_company_delete', table_name);
  end loop;
end $$;

drop policy if exists signed_documents_service_role_all on public.signed_documents;
create policy signed_documents_service_role_all on public.signed_documents
  for all to service_role using (true) with check (true);

drop policy if exists "Service role pode tudo em remote_links" on public.remote_links;
create policy remote_links_service_role_all on public.remote_links
  for all to service_role using (true) with check (true);

-- Trilha de auditoria imutável.
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_events enable row level security;

drop policy if exists audit_events_company_select on public.audit_events;
create policy audit_events_company_select
  on public.audit_events for select
  to authenticated
  using (public.user_has_company(company_id));

drop policy if exists audit_events_service_insert on public.audit_events;
create policy audit_events_service_insert
  on public.audit_events for insert
  to service_role
  with check (true);

create or replace function public.block_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Trilha de auditoria imutavel: eventos nao podem ser alterados ou excluidos.';
end;
$$;

drop trigger if exists trg_audit_events_immutable on public.audit_events;
create trigger trg_audit_events_immutable
  before update or delete on public.audit_events
  for each row execute function public.block_audit_event_mutation();

create or replace function public.write_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload_company_id uuid;
  payload_record_id uuid;
  old_payload jsonb;
  new_payload jsonb;
begin
  old_payload := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_payload := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  payload_company_id := coalesce((new_payload->>'company_id')::uuid, (old_payload->>'company_id')::uuid);
  payload_record_id := coalesce((new_payload->>'id')::uuid, (old_payload->>'id')::uuid);

  insert into public.audit_events (
    company_id,
    actor_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  ) values (
    payload_company_id,
    auth.uid(),
    tg_table_name,
    payload_record_id,
    tg_op,
    old_payload,
    new_payload
  );

  return coalesce(new, old);
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'employees','ppes','deliveries','workplaces','stock_movements',
    'trainings','job_titles','departments','signed_documents','remote_links'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || table_name || '_audit', table_name);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.write_audit_event()', 'trg_' || table_name || '_audit', table_name);
  end loop;
end $$;

create or replace function public.block_signed_document_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Documento juridico arquivado e imutavel. Emita novo documento retificador.';
end;
$$;

drop trigger if exists trg_signed_documents_immutable on public.signed_documents;
create trigger trg_signed_documents_immutable
  before update or delete on public.signed_documents
  for each row execute function public.block_signed_document_mutation();

create or replace function public.protect_delivery_legal_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Entrega assinada nao pode ser excluida. Registre devolucao/baixa.';
  end if;

  if old.employee_id is distinct from new.employee_id
    or old.ppe_id is distinct from new.ppe_id
    or old.company_id is distinct from new.company_id
    or old.delivery_date is distinct from new.delivery_date
    or old.reason is distinct from new.reason
    or old.quantity is distinct from new.quantity
    or old.signature_url is distinct from new.signature_url
    or old.auth_method is distinct from new.auth_method
    or old.ip_address is distinct from new.ip_address
  then
    raise exception 'Campos juridicos da entrega sao imutaveis. Use devolucao ou novo registro.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_deliveries_legal_guard on public.deliveries;
create trigger trg_deliveries_legal_guard
  before update or delete on public.deliveries
  for each row execute function public.protect_delivery_legal_fields();

-- Consentimentos LGPD, também imutáveis.
create table if not exists public.lgpd_consents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  employee_id uuid not null references public.employees(id) on delete restrict,
  consent_type text not null check (consent_type in ('biometric', 'photo_evidence', 'geolocation')),
  consent_text text not null,
  granted boolean not null,
  granted_at timestamptz,
  revoked_at timestamptz,
  source text not null default 'system',
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.lgpd_consents enable row level security;

drop policy if exists lgpd_consents_company_select on public.lgpd_consents;
create policy lgpd_consents_company_select
  on public.lgpd_consents for select
  to authenticated
  using (public.user_has_company(company_id));

drop policy if exists lgpd_consents_company_insert on public.lgpd_consents;
create policy lgpd_consents_company_insert
  on public.lgpd_consents for insert
  to authenticated
  with check (public.user_has_company(company_id));

drop policy if exists lgpd_consents_service_all on public.lgpd_consents;
create policy lgpd_consents_service_all
  on public.lgpd_consents for all
  to service_role
  using (true)
  with check (true);

drop trigger if exists trg_lgpd_consents_immutable on public.lgpd_consents;
create trigger trg_lgpd_consents_immutable
  before update or delete on public.lgpd_consents
  for each row execute function public.block_audit_event_mutation();

drop trigger if exists trg_lgpd_consents_audit on public.lgpd_consents;
create trigger trg_lgpd_consents_audit
  after insert or update or delete on public.lgpd_consents
  for each row execute function public.write_audit_event();
