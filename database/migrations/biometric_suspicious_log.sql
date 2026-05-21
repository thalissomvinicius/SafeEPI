-- SafeEPI - log de tentativas biometricas suspeitas

create extension if not exists pgcrypto;

create table if not exists public.biometric_suspicious_log (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  company_id uuid,
  attempts integer not null default 1,
  reason text not null check (reason in ('repeated_failure', 'low_variance', 'timeout')),
  ip text,
  created_at timestamptz not null default now()
);

alter table public.biometric_suspicious_log enable row level security;

create index if not exists idx_biometric_suspicious_log_employee
  on public.biometric_suspicious_log(employee_id, created_at desc);

create index if not exists idx_biometric_suspicious_log_company
  on public.biometric_suspicious_log(company_id, created_at desc);

