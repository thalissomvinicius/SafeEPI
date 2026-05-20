-- SafeEPI - controles comerciais por empresa
-- Rode no SQL Editor do Supabase para liberar:
-- 1. modulo premium de treinamentos por empresa
-- 2. bloqueio/desbloqueio de acesso por inadimplencia

alter table public.companies
  add column if not exists training_enabled boolean not null default false,
  add column if not exists subscription_status text not null default 'ACTIVE',
  add column if not exists suspended_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'companies_subscription_status_check'
      and conrelid = 'public.companies'::regclass
  ) then
    alter table public.companies
      add constraint companies_subscription_status_check
      check (subscription_status in ('ACTIVE', 'PAST_DUE', 'SUSPENDED'));
  end if;
end $$;

update public.companies
set subscription_status = case when active then 'ACTIVE' else 'SUSPENDED' end
where subscription_status is null;
