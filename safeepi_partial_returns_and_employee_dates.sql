-- SafeEPI - substituicao parcial e datas opcionais de colaborador
-- Execute no Supabase antes de usar substituicoes parciais em producao.

alter table public.deliveries
  add column if not exists returned_quantity integer not null default 0;

alter table public.deliveries
  drop constraint if exists deliveries_returned_quantity_non_negative;

alter table public.deliveries
  add constraint deliveries_returned_quantity_non_negative
  check (returned_quantity >= 0);

alter table public.employees
  add column if not exists termination_date date;

alter table public.employees
  alter column admission_date drop not null;

create index if not exists idx_deliveries_partial_return
  on public.deliveries(employee_id, ppe_id, returned_at, returned_quantity);

create index if not exists idx_employees_admission_date
  on public.employees(admission_date);

create index if not exists idx_employees_termination_date
  on public.employees(termination_date);
