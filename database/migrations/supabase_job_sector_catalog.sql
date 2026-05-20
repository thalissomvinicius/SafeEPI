-- Cadastro padronizado de cargos e setores.
-- Execute no SQL Editor do Supabase antes de usar a aba "Cargos / Setores".

create table if not exists public.job_titles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint job_titles_name_upper check (name = upper(name)),
  constraint job_titles_name_unique unique (name)
);

create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint departments_name_upper check (name = upper(name)),
  constraint departments_name_unique unique (name)
);

alter table public.job_titles enable row level security;
alter table public.departments enable row level security;

drop policy if exists "job_titles_select_authenticated" on public.job_titles;
create policy "job_titles_select_authenticated"
  on public.job_titles for select
  to authenticated
  using (true);

drop policy if exists "job_titles_insert_authenticated" on public.job_titles;
create policy "job_titles_insert_authenticated"
  on public.job_titles for insert
  to authenticated
  with check (true);

drop policy if exists "job_titles_update_authenticated" on public.job_titles;
create policy "job_titles_update_authenticated"
  on public.job_titles for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "departments_select_authenticated" on public.departments;
create policy "departments_select_authenticated"
  on public.departments for select
  to authenticated
  using (true);

drop policy if exists "departments_insert_authenticated" on public.departments;
create policy "departments_insert_authenticated"
  on public.departments for insert
  to authenticated
  with check (true);

drop policy if exists "departments_update_authenticated" on public.departments;
create policy "departments_update_authenticated"
  on public.departments for update
  to authenticated
  using (true)
  with check (true);

insert into public.job_titles (name)
select distinct upper(trim(job_title))
from public.employees
where nullif(trim(job_title), '') is not null
on conflict (name) do nothing;

insert into public.departments (name)
select distinct upper(trim(coalesce(department, 'ADMINISTRATIVO')))
from public.employees
where nullif(trim(coalesce(department, 'ADMINISTRATIVO')), '') is not null
on conflict (name) do nothing;
