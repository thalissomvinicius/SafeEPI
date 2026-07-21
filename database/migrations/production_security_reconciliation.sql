-- SafeEPI - reconciliacao de seguranca para schema legado em producao.
-- Remove exposicoes publicas sem alterar os dados operacionais.

begin;
set local lock_timeout = '10s';

-- Remove policies legadas destinadas a PUBLIC nas tabelas operacionais.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'employees', 'ppes', 'deliveries', 'stock_movements',
        'trainings', 'workplaces', 'remote_links'
      )
      and 'public' = any(roles)
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      policy_record.policyname,
      policy_record.tablename
    );
  end loop;
end;
$$;

-- Links remotos sao validados exclusivamente pelas API routes server-side.
do $$
declare
  policy_record record;
begin
  for policy_record in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'remote_links'
  loop
    execute format('drop policy if exists %I on public.remote_links', policy_record.policyname);
  end loop;
end;
$$;

alter table public.remote_links enable row level security;
alter table public.remote_links force row level security;
revoke all on public.remote_links from anon;
grant select, insert, update, delete on public.remote_links to service_role;

create policy "remote_links_tenant_select" on public.remote_links
  for select to authenticated
  using (company_id = any(public.get_user_company_ids()) or public.is_master());

-- Remove a leitura de documentos de todas as empresas por qualquer usuario logado.
drop policy if exists "signed_documents_select_authenticated" on public.signed_documents;
revoke all on public.signed_documents from anon;

-- A copia tecnica nao deve estar exposta pela API.
alter table if exists public.stock_movements_backup_20260513_141525 enable row level security;
alter table if exists public.stock_movements_backup_20260513_141525 force row level security;
revoke all on public.stock_movements_backup_20260513_141525 from anon, authenticated;

-- Funcoes auxiliares de RLS continuam acessiveis ao usuario autenticado, nunca ao anon.
revoke all on function public.get_user_company_ids() from public;
grant execute on function public.get_user_company_ids() to authenticated;
revoke all on function public.is_master() from public;
grant execute on function public.is_master() to authenticated;
revoke all on function public.has_company_role(uuid, text[]) from public;
grant execute on function public.has_company_role(uuid, text[]) to authenticated;
revoke all on function public.current_company_id() from public;
grant execute on function public.current_company_id() to authenticated;
revoke all on function public.user_has_company(uuid) from public;
grant execute on function public.user_has_company(uuid) to authenticated;
revoke all on function public.is_master_user() from public;
grant execute on function public.is_master_user() to authenticated;
revoke all on function public.third_parties_feature_enabled(uuid) from public;
grant execute on function public.third_parties_feature_enabled(uuid) to authenticated;

-- Funcao de trigger nao deve ser chamavel por RPC.
revoke all on function public.clean_biometric_on_deactivation() from public, anon, authenticated;

alter function public.handle_delivery_stock_reduction() set search_path = public, pg_temp;
alter function public.handle_manual_stock_adjustment() set search_path = public, pg_temp;

notify pgrst, 'reload schema';

commit;
