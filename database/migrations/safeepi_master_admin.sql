-- SafeEPI - camada MASTER para operacao multiempresa
-- Rode este script no SQL Editor do Supabase antes de usar o painel /companies.

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint if exists %I', constraint_record.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('MASTER', 'ADMIN', 'ALMOXARIFE', 'DIRETORIA'));

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.company_users'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.company_users drop constraint if exists %I', constraint_record.conname);
  end loop;
end $$;

alter table public.company_users
  add constraint company_users_role_check
  check (role in ('ADMIN', 'ALMOXARIFE', 'DIRETORIA'));

update public.profiles
set role = 'MASTER',
    company_id = null
where lower(email) in (
  'thalissomvinicius7@gmail.com',
  'thalissom.cruz@valle.br'
);

delete from public.company_users
where user_id in (
  select id
  from public.profiles
  where lower(email) in (
    'thalissomvinicius7@gmail.com',
    'thalissom.cruz@valle.br'
  )
);
