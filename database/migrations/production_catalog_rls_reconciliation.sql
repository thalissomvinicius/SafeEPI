-- SafeEPI - elimina acesso autenticado amplo aos catalogos multiempresa.

begin;
set local lock_timeout = '10s';

drop policy if exists "departments_insert_authenticated" on public.departments;
drop policy if exists "departments_select_authenticated" on public.departments;
drop policy if exists "departments_update_authenticated" on public.departments;
drop policy if exists "job_titles_insert_authenticated" on public.job_titles;
drop policy if exists "job_titles_select_authenticated" on public.job_titles;
drop policy if exists "job_titles_update_authenticated" on public.job_titles;

drop policy if exists "departments_master_all" on public.departments;
create policy "departments_master_all" on public.departments
  for all to authenticated
  using (public.is_master())
  with check (public.is_master());

drop policy if exists "job_titles_master_all" on public.job_titles;
create policy "job_titles_master_all" on public.job_titles
  for all to authenticated
  using (public.is_master())
  with check (public.is_master());

notify pgrst, 'reload schema';

commit;
