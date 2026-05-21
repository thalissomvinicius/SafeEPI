-- SafeEPI - retencao de dados biometricos
-- Remove descritor facial quando colaborador e desativado e registra auditoria.

create extension if not exists pgcrypto;

create table if not exists public.biometric_deletion_log (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  company_id uuid,
  photo_url text,
  deleted_at timestamptz not null default now(),
  reason text not null
);

alter table public.biometric_deletion_log enable row level security;

create index if not exists idx_biometric_deletion_log_employee
  on public.biometric_deletion_log(employee_id, deleted_at desc);

create index if not exists idx_biometric_deletion_log_company
  on public.biometric_deletion_log(company_id, deleted_at desc);

create or replace function public.clean_biometric_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.active = true and new.active = false then
    insert into public.biometric_deletion_log (
      employee_id,
      company_id,
      photo_url,
      deleted_at,
      reason
    )
    values (
      new.id,
      new.company_id,
      new.photo_url,
      now(),
      'deactivation'
    );

    update public.employees
      set face_descriptor = null
      where id = new.id
        and face_descriptor is not null;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_clean_biometric_on_deactivation on public.employees;

create trigger trg_clean_biometric_on_deactivation
after update on public.employees
for each row
when (old.active = true and new.active = false)
execute function public.clean_biometric_on_deactivation();

