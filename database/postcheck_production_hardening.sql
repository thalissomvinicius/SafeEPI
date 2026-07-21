-- SafeEPI - validacao somente leitura depois de production_hardening.sql
-- O primeiro resultado esperado e uma linha com todos os campos em true.

select
  to_regclass('public.api_rate_limits') is not null as tabela_rate_limit,
  to_regclass('public.biometric_deletion_queue') is not null as fila_biometrica,
  (
    to_regclass('public.biometric_profiles') is not null
    and to_regclass('public.biometric_sessions') is not null
    and to_regclass('public.biometric_audit_log') is not null
  ) as plataforma_biometrica,
  to_regclass('public.idx_deliveries_company_idempotency') is not null as indice_idempotencia,
  to_regclass('public.idx_signed_documents_remote_link_once') is not null as indice_documento_remoto,
  exists (
    select 1
    from pg_trigger
    where tgname = 'trg_clean_biometric_on_deactivation'
      and not tgisinternal
  ) as trigger_limpeza_biometrica,
  exists (
    select 1
    from pg_trigger
    where tgname = 'trg_protect_signed_document_integrity'
      and not tgisinternal
  ) as trigger_integridade_documento,
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'consume_rate_limit',
        'safeepi_complete_delivery_signature',
        'safeepi_complete_remote_capture',
        'safeepi_create_delivery',
        'safeepi_dashboard_delivery_buckets',
        'safeepi_notification_summary',
        'safeepi_queue_employee_biometric_deletion',
        'safeepi_record_stock_movement',
        'safeepi_return_delivery',
        'safeepi_void_delivery'
      )
  ) = 10 as dez_funcoes_instaladas,
  has_function_privilege(
    'service_role',
    'public.safeepi_create_delivery(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text,timestamptz,text,uuid,text,uuid,text,boolean)',
    'EXECUTE'
  ) as service_role_pode_criar_entrega,
  not has_function_privilege(
    'authenticated',
    'public.safeepi_create_delivery(uuid,uuid,uuid,uuid,uuid,text,integer,text,text,text,timestamptz,text,uuid,text,uuid,text,boolean)',
    'EXECUTE'
  ) as cliente_nao_pode_criar_entrega_direto,
  (
    has_table_privilege('service_role', 'public.biometric_profiles', 'SELECT')
    and has_table_privilege('service_role', 'public.biometric_profiles', 'INSERT')
    and has_table_privilege('service_role', 'public.biometric_profiles', 'UPDATE')
    and has_table_privilege('service_role', 'public.biometric_profiles', 'DELETE')
  ) as service_role_pode_usar_biometria,
  not has_table_privilege('authenticated', 'public.biometric_profiles', 'SELECT')
    as cliente_nao_le_biometria_direto;

-- Confirme que service_role possui EXECUTE e que anon/authenticated/public nao possuem.
select
  p.proname as funcao,
  coalesce(array_to_string(p.proacl, E'\n'), 'ACL padrao') as permissoes
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'consume_rate_limit',
    'safeepi_complete_delivery_signature',
    'safeepi_complete_remote_capture',
    'safeepi_create_delivery',
    'safeepi_dashboard_delivery_buckets',
    'safeepi_notification_summary',
    'safeepi_queue_employee_biometric_deletion',
    'safeepi_record_stock_movement',
    'safeepi_return_delivery',
    'safeepi_void_delivery'
  )
order by p.proname;

-- Deve retornar exatamente dois buckets e ambos com public = false.
select id, name, public
from storage.buckets
where id in ('ppe_signatures', 'biometric_photos')
order by id;

-- Revise qualquer policy remanescente: o app novo nao precisa de leitura publica.
select policyname, roles, cmd, qual
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;
