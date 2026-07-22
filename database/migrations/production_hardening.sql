-- SafeEPI - hardening de producao
-- Aplicar depois de biometric_identity_platform.sql.

-- Esta migration e atomica: qualquer falha reverte todas as alteracoes abaixo.
begin;
set local lock_timeout = '10s';

create table if not exists public.api_rate_limits (
  key_hash text primary key,
  request_count integer not null check (request_count > 0),
  window_started_at timestamptz not null,
  expires_at timestamptz not null
);

create index if not exists idx_api_rate_limits_expires_at
  on public.api_rate_limits(expires_at);

alter table public.api_rate_limits enable row level security;
alter table public.api_rate_limits force row level security;
revoke all on public.api_rate_limits from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row public.api_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if length(p_key) < 8 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid_rate_limit_parameters';
  end if;

  insert into public.api_rate_limits (
    key_hash,
    request_count,
    window_started_at,
    expires_at
  ) values (
    p_key,
    1,
    v_now,
    v_now + make_interval(secs => p_window_seconds)
  )
  on conflict (key_hash) do update
  set
    request_count = case
      when api_rate_limits.expires_at <= v_now then 1
      else api_rate_limits.request_count + 1
    end,
    window_started_at = case
      when api_rate_limits.expires_at <= v_now then v_now
      else api_rate_limits.window_started_at
    end,
    expires_at = case
      when api_rate_limits.expires_at <= v_now
        then v_now + make_interval(secs => p_window_seconds)
      else api_rate_limits.expires_at
    end
  returning * into current_row;

  allowed := current_row.request_count <= p_limit;
  retry_after := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (current_row.expires_at - v_now)))::integer)
  end;
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Operacoes de estoque e entregas: uma unica transacao e uma unica autoridade.
-- ---------------------------------------------------------------------------

alter table public.deliveries add column if not exists auth_method text;
alter table public.deliveries add column if not exists idempotency_key text;
alter table public.deliveries add column if not exists deleted_at timestamptz;
alter table public.deliveries add column if not exists deleted_by uuid;
alter table public.deliveries add column if not exists deleted_reason text;
alter table public.stock_movements add column if not exists created_by_id uuid;
alter table public.stock_movements add column if not exists created_by_name text;
alter table public.signed_documents add column if not exists remote_link_id uuid references public.remote_links(id) on delete set null;
alter table public.employees add column if not exists face_descriptor_encrypted text;
alter table public.employees add column if not exists biometric_key_version text;
alter table public.biometric_profiles add column if not exists embedding_encrypted text;
alter table public.biometric_profiles alter column embedding drop not null;
alter table public.biometric_profiles force row level security;
revoke all on public.biometric_profiles from public, anon, authenticated;

comment on column public.employees.face_descriptor_encrypted is
  'Descritor ArcFace criptografado com AES-256-GCM no servidor; a chave nunca e persistida no banco.';
comment on column public.employees.face_descriptor is
  'Campo legado. Deve permanecer nulo depois da migracao preguiçosa para face_descriptor_encrypted.';
comment on column public.biometric_profiles.embedding is
  'Campo legado descontinuado. Novos descritores nao devem ser persistidos em texto claro.';
comment on column public.biometric_profiles.embedding_encrypted is
  'Campo reservado para perfil criptografado; acesso exclusivo via service_role.';

create table if not exists public.biometric_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null,
  company_id uuid,
  storage_path text not null,
  reason text not null,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_biometric_deletion_queue_pending
  on public.biometric_deletion_queue(created_at)
  where processed_at is null;

alter table public.biometric_deletion_queue enable row level security;
alter table public.biometric_deletion_queue force row level security;
alter table public.biometric_deletion_log force row level security;
revoke all on public.biometric_deletion_queue from public, anon, authenticated;
revoke all on public.biometric_deletion_log from public, anon, authenticated;

create or replace function public.clean_biometric_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.active = true and new.active = false then
    if old.photo_url is not null and length(old.photo_url) > 0 then
      insert into public.biometric_deletion_queue (
        employee_id, company_id, storage_path, reason
      ) values (
        old.id, old.company_id, old.photo_url, 'deactivation'
      );
    end if;

    insert into public.biometric_deletion_log (
      employee_id, company_id, photo_url, deleted_at, reason
    ) values (
      old.id, old.company_id, old.photo_url, clock_timestamp(), 'deactivation'
    );

    new.photo_url := null;
    new.face_descriptor := null;
    new.face_descriptor_encrypted := null;
    new.biometric_key_version := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_clean_biometric_on_deactivation on public.employees;
create trigger trg_clean_biometric_on_deactivation
before update on public.employees
for each row
when (old.active = true and new.active = false)
execute function public.clean_biometric_on_deactivation();

create or replace function public.safeepi_queue_employee_biometric_deletion(
  p_employee_id uuid,
  p_company_id uuid,
  p_reason text default 'manual_deletion'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  employee_row public.employees%rowtype;
begin
  select * into employee_row
  from public.employees
  where id = p_employee_id
    and (p_company_id is null or company_id = p_company_id)
  for update;

  if not found then raise exception 'employee_not_found'; end if;

  if employee_row.photo_url is not null and length(employee_row.photo_url) > 0 then
    insert into public.biometric_deletion_queue (
      employee_id, company_id, storage_path, reason
    ) values (
      employee_row.id,
      employee_row.company_id,
      employee_row.photo_url,
      left(coalesce(nullif(p_reason, ''), 'manual_deletion'), 100)
    );
  end if;

  insert into public.biometric_deletion_log (
    employee_id, company_id, photo_url, deleted_at, reason
  ) values (
    employee_row.id,
    employee_row.company_id,
    employee_row.photo_url,
    clock_timestamp(),
    left(coalesce(nullif(p_reason, ''), 'manual_deletion'), 100)
  );

  update public.employees
  set photo_url = null,
      face_descriptor = null,
      face_descriptor_encrypted = null,
      biometric_key_version = null
  where id = employee_row.id;

  return jsonb_build_object(
    'ok', true,
    'queued', employee_row.photo_url is not null,
    'employee_id', employee_row.id
  );
end;
$$;

create or replace function public.safeepi_notification_summary(p_company_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(alert_row.payload), '[]'::jsonb)
  from (
    select payload
    from (
      select
        case when p.ca_expiry_date < current_date then 0 else 1 end as priority,
        p.ca_expiry_date::timestamptz as event_at,
        jsonb_build_object(
          'id', 'ca-' || p.id::text,
          'title', case when p.ca_expiry_date < current_date then 'C.A. Vencido' else 'C.A. Vencendo' end,
          'description', case
            when p.ca_expiry_date < current_date
              then p.name || ' venceu ha ' || (current_date - p.ca_expiry_date)::text || ' dia(s).'
            else p.name || ' vence em ' || (p.ca_expiry_date - current_date)::text || ' dia(s).'
          end,
          'type', 'CA',
          'severity', case when p.ca_expiry_date < current_date + 10 then 'high' else 'medium' end
        ) as payload
      from public.ppes p
      where p.active = true
        and p.ca_expiry_date is not null
        and p.ca_expiry_date < current_date + 30
        and (p_company_id is null or p.company_id = p_company_id)

      union all

      select
        case when coalesce(p.current_stock, 0) <= 1 then 0 else 1 end as priority,
        current_timestamp as event_at,
        jsonb_build_object(
          'id', 'stock-' || p.id::text,
          'title', 'Estoque Baixo',
          'description', p.name || ' tem apenas ' || coalesce(p.current_stock, 0)::text || ' unidade(s).',
          'type', 'STOCK',
          'severity', case when coalesce(p.current_stock, 0) <= 1 then 'high' else 'medium' end
        ) as payload
      from public.ppes p
      where p.active = true
        and coalesce(p.current_stock, 0) < 5
        and (p_company_id is null or p.company_id = p_company_id)

      union all

      select
        0 as priority,
        d.delivery_date + (p.lifespan_days * interval '1 day') as event_at,
        jsonb_build_object(
          'id', 'expiry-' || d.id::text,
          'title', 'Troca Obrigatoria',
          'description', coalesce(e.full_name, 'Colaborador') || ' esta com ' || p.name || ' vencido pelo uso.',
          'type', 'LIFESPAN',
          'severity', 'high'
        ) as payload
      from public.deliveries d
      join public.ppes p on p.id = d.ppe_id and p.company_id = d.company_id
      left join public.employees e on e.id = d.employee_id and e.company_id = d.company_id
      where d.returned_at is null
        and d.deleted_at is null
        and p.lifespan_days is not null
        and p.lifespan_days > 0
        and d.delivery_date + (p.lifespan_days * interval '1 day') < current_timestamp
        and (p_company_id is null or d.company_id = p_company_id)
    ) alerts
    order by priority asc, event_at asc
    limit 100
  ) alert_row;
$$;

create or replace function public.safeepi_dashboard_delivery_buckets(
  p_company_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with days as (
    select generate_series(
      date_trunc('day', p_start),
      date_trunc('day', p_end),
      interval '1 day'
    ) as day_start
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'date', to_char(days.day_start, 'YYYY-MM-DD'),
        'value', coalesce(counts.delivery_count, 0)
      )
      order by days.day_start
    ),
    '[]'::jsonb
  )
  from days
  left join lateral (
    select count(*)::integer as delivery_count
    from public.deliveries d
    where d.deleted_at is null
      and d.delivery_date >= days.day_start
      and d.delivery_date < days.day_start + interval '1 day'
      and (p_company_id is null or d.company_id = p_company_id)
  ) counts on true
  where p_start is not null
    and p_end is not null
    and p_end >= p_start
    and p_end - p_start <= interval '32 days';
$$;

create or replace function public.safeepi_complete_remote_capture(
  p_remote_link_id uuid,
  p_employee_id uuid,
  p_company_id uuid,
  p_photo_url text,
  p_face_descriptor_encrypted text,
  p_biometric_key_version text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  employee_row public.employees%rowtype;
begin
  perform 1
  from public.remote_links
  where id = p_remote_link_id
    and employee_id = p_employee_id
    and company_id = p_company_id
    and type = 'capture'
    and status = 'pending'
    and expires_at > clock_timestamp()
  for update;
  if not found then raise exception 'remote_link_already_consumed'; end if;

  update public.employees
  set photo_url = p_photo_url,
      face_descriptor = null,
      face_descriptor_encrypted = p_face_descriptor_encrypted,
      biometric_key_version = p_biometric_key_version
  where id = p_employee_id and company_id = p_company_id
  returning * into employee_row;
  if not found then raise exception 'employee_not_found'; end if;

  update public.remote_links
  set status = 'completed', completed_at = clock_timestamp()
  where id = p_remote_link_id;

  return to_jsonb(employee_row)
    - 'face_descriptor'
    - 'face_descriptor_encrypted'
    - 'biometric_key_version';
end;
$$;

create unique index if not exists idx_deliveries_company_idempotency
  on public.deliveries(company_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_deliveries_active_company_date
  on public.deliveries(company_id, delivery_date desc)
  where deleted_at is null;

create unique index if not exists idx_signed_documents_remote_link_once
  on public.signed_documents(remote_link_id)
  where remote_link_id is not null;

create or replace function public.protect_signed_document_integrity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.storage_path is distinct from old.storage_path
    or new.sha256_hash is distinct from old.sha256_hash
    or new.company_id is distinct from old.company_id
    or new.document_type is distinct from old.document_type then
    raise exception 'signed_document_integrity_fields_are_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_signed_document_integrity on public.signed_documents;
create trigger trg_protect_signed_document_integrity
before update on public.signed_documents
for each row execute function public.protect_signed_document_integrity();

alter table public.deliveries drop constraint if exists deliveries_reason_check;

-- Corrige o texto legado depois de remover a restricao antiga, que tambem foi
-- criada com codificacao corrompida. A transformacao e idempotente e atomica.
update public.deliveries
set reason = U&'Substitui\00E7\00E3o (Desgaste/Validade)'
where reason = U&'Substitui\00C3\00A7\00C3\00A3o (Desgaste/Validade)';

alter table public.deliveries
  add constraint deliveries_reason_check check (reason in (
    'Primeira Entrega',
    'Substituição (Desgaste/Validade)',
    'Substituicao (Desgaste/Validade)',
    'Perda',
    'Dano'
  ));

alter table public.deliveries drop constraint if exists deliveries_quantity_positive;
alter table public.deliveries
  add constraint deliveries_quantity_positive check (quantity > 0);

alter table public.deliveries drop constraint if exists deliveries_returned_quantity_valid;
alter table public.deliveries
  add constraint deliveries_returned_quantity_valid
  check (returned_quantity >= 0 and returned_quantity <= quantity);

alter table public.ppes drop constraint if exists ppes_current_stock_non_negative;
alter table public.ppes
  add constraint ppes_current_stock_non_negative check (current_stock >= 0);

drop trigger if exists trigger_reduce_stock_on_delivery on public.deliveries;
drop trigger if exists trigger_update_ppe_stock_on_movement on public.stock_movements;

create or replace function public.safeepi_record_stock_movement(
  p_company_id uuid,
  p_ppe_id uuid,
  p_quantity integer,
  p_type text,
  p_motive text default null,
  p_delivery_id uuid default null,
  p_created_by_id uuid default null,
  p_created_by_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_row public.ppes%rowtype;
  movement_row public.stock_movements%rowtype;
  next_stock integer;
begin
  if p_quantity < 0 or p_type not in ('ENTRADA', 'SAIDA', 'AJUSTE') then
    raise exception 'invalid_stock_movement';
  end if;
  if p_type <> 'AJUSTE' and p_quantity = 0 then
    raise exception 'invalid_stock_quantity';
  end if;

  select * into current_row
  from public.ppes
  where id = p_ppe_id
    and (p_company_id is null or company_id = p_company_id)
  for update;

  if not found then raise exception 'ppe_not_found'; end if;

  next_stock := case p_type
    when 'ENTRADA' then coalesce(current_row.current_stock, 0) + p_quantity
    when 'SAIDA' then coalesce(current_row.current_stock, 0) - p_quantity
    else p_quantity
  end;

  if next_stock < 0 then raise exception 'insufficient_stock'; end if;

  update public.ppes set current_stock = next_stock where id = current_row.id;

  insert into public.stock_movements (
    company_id, ppe_id, delivery_id, quantity, type, motive,
    created_by_id, created_by_name
  ) values (
    current_row.company_id, p_ppe_id, p_delivery_id, p_quantity, p_type, p_motive,
    p_created_by_id, left(p_created_by_name, 200)
  ) returning * into movement_row;

  return to_jsonb(movement_row) || jsonb_build_object('current_stock', next_stock);
end;
$$;

create or replace function public.safeepi_return_delivery(
  p_company_id uuid,
  p_delivery_id uuid,
  p_quantity integer,
  p_motive text,
  p_restock boolean,
  p_created_by_id uuid default null,
  p_created_by_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  delivery_row public.deliveries%rowtype;
  ppe_row public.ppes%rowtype;
  remaining integer;
  quantity_now integer;
  next_returned integer;
begin
  select * into delivery_row
  from public.deliveries
  where id = p_delivery_id and company_id = p_company_id
  for update;
  if not found then raise exception 'delivery_not_found'; end if;

  remaining := greatest(0, delivery_row.quantity - coalesce(delivery_row.returned_quantity, 0));
  quantity_now := least(remaining, coalesce(p_quantity, remaining));
  if quantity_now <= 0 then
    return jsonb_build_object(
      'ok', true,
      'returned_quantity', coalesce(delivery_row.returned_quantity, 0),
      'quantity_returned_now', 0
    );
  end if;

  next_returned := coalesce(delivery_row.returned_quantity, 0) + quantity_now;
  update public.deliveries
  set returned_quantity = next_returned,
      return_motive = left(p_motive, 150),
      returned_at = case when next_returned >= quantity then clock_timestamp() else returned_at end
  where id = delivery_row.id;

  if p_restock and delivery_row.ppe_id is not null then
    select * into ppe_row
    from public.ppes
    where id = delivery_row.ppe_id and company_id = p_company_id
    for update;
    if not found then raise exception 'ppe_not_found'; end if;

    update public.ppes
    set current_stock = coalesce(current_stock, 0) + quantity_now
    where id = ppe_row.id;

    insert into public.stock_movements (
      company_id, ppe_id, delivery_id, quantity, type, motive,
      created_by_id, created_by_name
    ) values (
      p_company_id, delivery_row.ppe_id, delivery_row.id, quantity_now, 'ENTRADA',
      'Devolucao de EPI (' || left(p_motive, 150) || ')',
      p_created_by_id, left(p_created_by_name, 200)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'returned_quantity', next_returned,
    'quantity_returned_now', quantity_now
  );
end;
$$;

create or replace function public.safeepi_create_delivery(
  p_company_id uuid,
  p_employee_id uuid,
  p_ppe_id uuid,
  p_workplace_id uuid,
  p_third_party_id uuid,
  p_reason text,
  p_quantity integer,
  p_signature_url text,
  p_auth_method text,
  p_ip_address text,
  p_delivery_date timestamptz,
  p_idempotency_key text,
  p_created_by_id uuid default null,
  p_created_by_name text default null,
  p_remote_link_id uuid default null,
  p_auto_return_motive text default null,
  p_auto_return_restock boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  ppe_row public.ppes%rowtype;
  delivery_row public.deliveries%rowtype;
  previous_row public.deliveries%rowtype;
  previous_remaining integer;
  affected integer;
  auto_returned_ids uuid[] := array[]::uuid[];
begin
  if p_company_id is null or p_quantity <= 0 or length(coalesce(p_idempotency_key, '')) < 8 then
    raise exception 'invalid_delivery_parameters';
  end if;

  select * into delivery_row
  from public.deliveries
  where company_id = p_company_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('delivery', to_jsonb(delivery_row), 'auto_returned_delivery_ids', auto_returned_ids);
  end if;

  perform 1 from public.employees
  where id = p_employee_id and company_id = p_company_id and active = true;
  if not found then raise exception 'employee_not_found'; end if;

  select * into ppe_row
  from public.ppes
  where id = p_ppe_id and company_id = p_company_id and active = true
  for update;
  if not found then raise exception 'ppe_not_found'; end if;
  if coalesce(ppe_row.current_stock, 0) < p_quantity then raise exception 'insufficient_stock'; end if;

  if p_remote_link_id is not null then
    update public.remote_links
    set status = 'completed', completed_at = clock_timestamp()
    where id = p_remote_link_id
      and company_id = p_company_id
      and employee_id = p_employee_id
      and type = 'delivery'
      and status = 'pending'
      and expires_at > clock_timestamp();
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'remote_link_already_consumed'; end if;
  end if;

  update public.ppes
  set current_stock = current_stock - p_quantity
  where id = ppe_row.id;

  insert into public.deliveries (
    company_id, employee_id, ppe_id, workplace_id, third_party_id,
    reason, quantity, signature_url, auth_method, ip_address, delivery_date,
    idempotency_key
  ) values (
    p_company_id, p_employee_id, p_ppe_id, p_workplace_id, p_third_party_id,
    p_reason, p_quantity, p_signature_url, p_auth_method, left(p_ip_address, 120),
    coalesce(p_delivery_date, clock_timestamp()), p_idempotency_key
  ) returning * into delivery_row;

  insert into public.stock_movements (
    company_id, ppe_id, delivery_id, quantity, type, motive,
    created_by_id, created_by_name
  ) values (
    p_company_id, p_ppe_id, delivery_row.id, p_quantity, 'SAIDA',
    'Entrega de EPI (' || p_reason || ')', p_created_by_id, left(p_created_by_name, 200)
  );

  if p_auto_return_motive is not null then
    for previous_row in
      select * from public.deliveries
      where company_id = p_company_id
        and employee_id = p_employee_id
        and ppe_id = p_ppe_id
        and id <> delivery_row.id
        and returned_at is null
        and deleted_at is null
      for update
    loop
      previous_remaining := greatest(0, previous_row.quantity - coalesce(previous_row.returned_quantity, 0));
      if previous_remaining = 0 then continue; end if;

      update public.deliveries
      set returned_quantity = quantity,
          returned_at = clock_timestamp(),
          return_motive = left(p_auto_return_motive, 150)
      where id = previous_row.id;

      if p_auto_return_restock then
        update public.ppes set current_stock = current_stock + previous_remaining where id = ppe_row.id;
        insert into public.stock_movements (
          company_id, ppe_id, delivery_id, quantity, type, motive,
          created_by_id, created_by_name
        ) values (
          p_company_id, p_ppe_id, previous_row.id, previous_remaining, 'ENTRADA',
          'Devolucao de EPI (' || left(p_auto_return_motive, 150) || ')',
          p_created_by_id, left(p_created_by_name, 200)
        );
      end if;
      auto_returned_ids := array_append(auto_returned_ids, previous_row.id);
    end loop;
  end if;

  return jsonb_build_object(
    'delivery', to_jsonb(delivery_row),
    'auto_returned_delivery_ids', auto_returned_ids
  );
end;
$$;

create or replace function public.safeepi_complete_delivery_signature(
  p_company_id uuid,
  p_employee_id uuid,
  p_remote_link_id uuid,
  p_delivery_ids uuid[],
  p_signature_url text,
  p_auth_method text,
  p_ip_address text,
  p_workplace_id uuid default null,
  p_third_party_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
  result jsonb;
begin
  if cardinality(p_delivery_ids) = 0 then raise exception 'delivery_ids_required'; end if;

  perform 1 from public.deliveries
  where id = any(p_delivery_ids)
    and company_id = p_company_id
    and employee_id = p_employee_id
  group by company_id
  having count(*) = cardinality(p_delivery_ids);
  if not found then raise exception 'delivery_scope_mismatch'; end if;

  update public.remote_links
  set status = 'completed', completed_at = clock_timestamp()
  where id = p_remote_link_id
    and company_id = p_company_id
    and employee_id = p_employee_id
    and status = 'pending'
    and expires_at > clock_timestamp();
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'remote_link_already_consumed'; end if;

  update public.deliveries
  set signature_url = p_signature_url,
      auth_method = p_auth_method,
      ip_address = left(p_ip_address, 120),
      workplace_id = coalesce(p_workplace_id, workplace_id),
      third_party_id = coalesce(p_third_party_id, third_party_id)
  where id = any(p_delivery_ids)
    and company_id = p_company_id
    and employee_id = p_employee_id;

  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into result
  from public.deliveries d where d.id = any(p_delivery_ids);
  return result;
end;
$$;

create or replace function public.safeepi_void_delivery(
  p_company_id uuid,
  p_delivery_id uuid,
  p_deleted_by uuid,
  p_deleted_reason text default 'Exclusao administrativa'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  delivery_row public.deliveries%rowtype;
  ppe_row public.ppes%rowtype;
  restore_quantity integer;
begin
  select * into delivery_row
  from public.deliveries
  where id = p_delivery_id and company_id = p_company_id
  for update;
  if not found then raise exception 'delivery_not_found'; end if;

  if delivery_row.deleted_at is not null then
    return jsonb_build_object('ok', true, 'restored_quantity', 0, 'already_voided', true);
  end if;

  restore_quantity := greatest(0, delivery_row.quantity - coalesce(delivery_row.returned_quantity, 0));
  if restore_quantity > 0 and delivery_row.ppe_id is not null then
    select * into ppe_row
    from public.ppes
    where id = delivery_row.ppe_id and company_id = p_company_id
    for update;
    if not found then raise exception 'ppe_not_found'; end if;

    update public.ppes
    set current_stock = coalesce(current_stock, 0) + restore_quantity
    where id = ppe_row.id;

    insert into public.stock_movements (
      company_id, ppe_id, delivery_id, quantity, type, motive,
      created_by_id, created_by_name
    ) values (
      p_company_id, delivery_row.ppe_id, delivery_row.id, restore_quantity,
      'ENTRADA', 'Estorno de entrega (' || left(p_deleted_reason, 150) || ')',
      p_deleted_by, 'Usuario SafeEPI'
    );
  end if;

  update public.deliveries
  set deleted_at = clock_timestamp(),
      deleted_by = p_deleted_by,
      deleted_reason = left(p_deleted_reason, 250)
  where id = delivery_row.id;

  return jsonb_build_object('ok', true, 'restored_quantity', restore_quantity, 'already_voided', false);
end;
$$;

revoke all on function public.safeepi_record_stock_movement(uuid, uuid, integer, text, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.safeepi_return_delivery(uuid, uuid, integer, text, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.safeepi_create_delivery(uuid, uuid, uuid, uuid, uuid, text, integer, text, text, text, timestamptz, text, uuid, text, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.safeepi_complete_delivery_signature(uuid, uuid, uuid, uuid[], text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.safeepi_void_delivery(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.safeepi_queue_employee_biometric_deletion(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.safeepi_notification_summary(uuid) from public, anon, authenticated;
revoke all on function public.safeepi_dashboard_delivery_buckets(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.safeepi_complete_remote_capture(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.safeepi_record_stock_movement(uuid, uuid, integer, text, text, uuid, uuid, text) to service_role;
grant execute on function public.safeepi_return_delivery(uuid, uuid, integer, text, boolean, uuid, text) to service_role;
grant execute on function public.safeepi_create_delivery(uuid, uuid, uuid, uuid, uuid, text, integer, text, text, text, timestamptz, text, uuid, text, uuid, text, boolean) to service_role;
grant execute on function public.safeepi_complete_delivery_signature(uuid, uuid, uuid, uuid[], text, text, text, uuid, uuid) to service_role;
grant execute on function public.safeepi_void_delivery(uuid, uuid, uuid, text) to service_role;
grant execute on function public.safeepi_queue_employee_biometric_deletion(uuid, uuid, text) to service_role;
grant execute on function public.safeepi_notification_summary(uuid) to service_role;
grant execute on function public.safeepi_dashboard_delivery_buckets(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.safeepi_complete_remote_capture(uuid, uuid, uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';

commit;
