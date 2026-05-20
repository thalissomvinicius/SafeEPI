-- SafeEPI - Correcao pontual de RLS para remote_links
-- Rode no SQL Editor do Supabase se anon ainda conseguir ler remote_links.

begin;

alter table public.remote_links enable row level security;
alter table public.remote_links force row level security;

revoke all on public.remote_links from anon;
revoke select, insert, update, delete on public.remote_links from anon;

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
end $$;

create policy "remote_links_tenant_select" on public.remote_links
  for select to authenticated
  using (company_id = any(public.get_user_company_ids()) or public.is_master());

commit;

-- Validacao esperada para anon: zero linhas visiveis via API.
-- select * from pg_policies where schemaname = 'public' and tablename = 'remote_links';
