-- SafeEPI - acesso operacional MASTER a todas as empresas
-- Rode no SQL Editor do Supabase para que o usuario MASTER consiga consultar
-- e operar qualquer empresa usando o seletor de contexto no sistema.

create or replace function public.is_master_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'MASTER'
  )
$$;

create or replace function public.user_has_company(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_master_user()
    or exists (
      select 1
      from public.company_users cu
      join public.companies c on c.id = cu.company_id
      where cu.user_id = auth.uid()
        and cu.company_id = target_company_id
        and cu.active = true
        and c.active = true
    )
$$;
