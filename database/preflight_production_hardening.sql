-- SafeEPI - preflight somente leitura para production_hardening.sql
-- Execute o arquivo inteiro no SQL Editor do projeto correto.
-- Resultado esperado: Success. No rows returned.

do $preflight$
declare
  missing_dependencies text;
  invalid_quantities bigint;
  invalid_returns bigint;
  negative_stock bigint;
  legacy_mojibake_reason_count bigint;
  invalid_reasons text;
begin
  with required_tables(table_name, required_migration) as (
    values
      ('biometric_deletion_log', 'biometric_retention.sql'),
      ('biometric_profiles', 'biometric_identity_platform.sql'),
      ('deliveries', 'supabase_schema.sql'),
      ('employees', 'supabase_schema.sql'),
      ('ppes', 'supabase_schema.sql'),
      ('remote_links', 'add_remote_links.sql'),
      ('signed_documents', 'signed_documents_audit.sql'),
      ('stock_movements', 'inventory_management.sql')
  ),
  required_columns(table_name, column_name, required_migration) as (
    values
      ('biometric_deletion_log', 'company_id', 'biometric_retention.sql'),
      ('biometric_deletion_log', 'deleted_at', 'biometric_retention.sql'),
      ('biometric_deletion_log', 'employee_id', 'biometric_retention.sql'),
      ('biometric_deletion_log', 'photo_url', 'biometric_retention.sql'),
      ('biometric_deletion_log', 'reason', 'biometric_retention.sql'),
      ('biometric_profiles', 'embedding', 'biometric_identity_platform.sql'),
      ('deliveries', 'company_id', 'safeepi_multi_company.sql'),
      ('deliveries', 'delivery_date', 'supabase_schema.sql'),
      ('deliveries', 'employee_id', 'supabase_schema.sql'),
      ('deliveries', 'id', 'supabase_schema.sql'),
      ('deliveries', 'ip_address', 'supabase_schema.sql'),
      ('deliveries', 'ppe_id', 'supabase_schema.sql'),
      ('deliveries', 'quantity', 'supabase_schema.sql'),
      ('deliveries', 'reason', 'supabase_schema.sql'),
      ('deliveries', 'return_motive', 'add_returns_logic.sql'),
      ('deliveries', 'returned_at', 'add_returns_logic.sql'),
      ('deliveries', 'returned_quantity', 'safeepi_partial_returns_and_employee_dates.sql'),
      ('deliveries', 'signature_url', 'supabase_schema.sql'),
      ('deliveries', 'third_party_id', 'safeepi_third_parties.sql'),
      ('deliveries', 'workplace_id', 'add_workplaces.sql'),
      ('employees', 'active', 'supabase_schema.sql'),
      ('employees', 'company_id', 'safeepi_multi_company.sql'),
      ('employees', 'face_descriptor', 'add_facial_biometrics.sql'),
      ('employees', 'full_name', 'supabase_schema.sql'),
      ('employees', 'id', 'supabase_schema.sql'),
      ('employees', 'photo_url', 'add_facial_biometrics.sql'),
      ('ppes', 'active', 'supabase_schema.sql'),
      ('ppes', 'ca_expiry_date', 'supabase_schema.sql'),
      ('ppes', 'company_id', 'safeepi_multi_company.sql'),
      ('ppes', 'current_stock', 'inventory_management.sql'),
      ('ppes', 'id', 'supabase_schema.sql'),
      ('ppes', 'lifespan_days', 'supabase_schema.sql'),
      ('ppes', 'name', 'supabase_schema.sql'),
      ('remote_links', 'company_id', 'safeepi_multi_company.sql'),
      ('remote_links', 'completed_at', 'add_remote_links.sql'),
      ('remote_links', 'employee_id', 'add_remote_links.sql'),
      ('remote_links', 'expires_at', 'add_remote_links.sql'),
      ('remote_links', 'id', 'add_remote_links.sql'),
      ('remote_links', 'status', 'add_remote_links.sql'),
      ('remote_links', 'type', 'add_remote_links.sql'),
      ('signed_documents', 'company_id', 'safeepi_multi_company.sql'),
      ('signed_documents', 'document_type', 'signed_documents_audit.sql'),
      ('signed_documents', 'sha256_hash', 'signed_documents_audit.sql'),
      ('signed_documents', 'storage_path', 'signed_documents_audit.sql'),
      ('stock_movements', 'company_id', 'safeepi_multi_company.sql'),
      ('stock_movements', 'delivery_id', 'add_delivery_id_to_stock_movements.sql'),
      ('stock_movements', 'motive', 'inventory_management.sql'),
      ('stock_movements', 'ppe_id', 'inventory_management.sql'),
      ('stock_movements', 'quantity', 'inventory_management.sql'),
      ('stock_movements', 'type', 'inventory_management.sql')
  ),
  missing as (
    select
      format('TABELA public.%I -> %s', table_name, required_migration) as problem
    from required_tables
    where to_regclass(format('public.%I', table_name)) is null

    union all

    select
      format('COLUNA public.%I.%I -> %s', table_name, column_name, required_migration) as problem
    from required_columns
    where not exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = required_columns.table_name
        and c.column_name = required_columns.column_name
    )
  )
  select string_agg(problem, E'\n' order by problem)
  into missing_dependencies
  from missing;

  if missing_dependencies is not null then
    raise exception using
      message = 'safeepi_preflight_missing_dependencies',
      detail = missing_dependencies,
      hint = 'Nao execute production_hardening.sql. Envie este erro para corrigirmos somente os pre-requisitos ausentes.';
  end if;

  select count(*) into invalid_quantities
  from public.deliveries
  where quantity <= 0;

  select count(*) into invalid_returns
  from public.deliveries
  where returned_quantity < 0
     or returned_quantity > quantity;

  select count(*) into negative_stock
  from public.ppes
  where current_stock < 0;

  select count(*) into legacy_mojibake_reason_count
  from public.deliveries
  where reason = U&'Substitui\00C3\00A7\00C3\00A3o (Desgaste/Validade)';

  select string_agg(format('%s (%s)', coalesce(reason, '<NULL>'), amount), ', ' order by amount desc)
  into invalid_reasons
  from (
    select reason, count(*) as amount
    from public.deliveries
    where reason is not null
      and reason not in (
        'Primeira Entrega',
        'Substituição (Desgaste/Validade)',
        'Substituicao (Desgaste/Validade)',
        U&'Substitui\00C3\00A7\00C3\00A3o (Desgaste/Validade)',
        'Perda',
        'Dano'
      )
    group by reason
  ) reasons;

  if invalid_quantities > 0
    or invalid_returns > 0
    or negative_stock > 0
    or invalid_reasons is not null then
    raise exception using
      message = 'safeepi_preflight_invalid_existing_data',
      detail = format(
        'quantidades_invalidas=%s; devolucoes_invalidas=%s; estoques_negativos=%s; motivos_invalidos=%s',
        invalid_quantities,
        invalid_returns,
        negative_stock,
        coalesce(invalid_reasons, 'nenhum')
      ),
      hint = 'Nao altere os dados manualmente. Envie este erro para prepararmos uma correcao auditavel.';
  end if;

  if legacy_mojibake_reason_count > 0 then
    raise notice 'safeepi_preflight_legacy_reason_detected: % registro(s) serao normalizados pela migration.', legacy_mojibake_reason_count;
  end if;

  raise notice 'safeepi_preflight_ok';
end
$preflight$;
