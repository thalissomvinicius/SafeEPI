-- SafeEPI - Exclusao logica de colaboradores
-- Mantem historico de entregas, treinamentos e documentos assinados.

alter table public.employees
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists idx_employees_company_active_not_deleted
  on public.employees(company_id, active)
  where deleted_at is null;

create index if not exists idx_employees_deleted_at
  on public.employees(deleted_at)
  where deleted_at is not null;

notify pgrst, 'reload schema';
