-- SafeEPI: server-authoritative, transaction-bound facial verification.
-- Prerequisites: biometric_identity_platform.sql + production_hardening.sql.
-- No legacy template is converted to another model or implicitly approved.
begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regclass('public.biometric_profiles') is null
    or to_regclass('public.biometric_sessions') is null
    or to_regprocedure('public.safeepi_queue_employee_biometric_deletion(uuid,uuid,text)') is null then
    raise exception 'facial_v2_missing_dependencies'
      using hint = 'Apply biometric_identity_platform.sql and production_hardening.sql first.';
  end if;
  if exists (select 1 from pg_trigger where not tgisinternal and tgenabled <> 'D'
    and ((tgrelid = 'public.deliveries'::regclass and tgname = 'trigger_reduce_stock_on_delivery')
      or (tgrelid = 'public.stock_movements'::regclass and tgname = 'trigger_update_ppe_stock_on_movement'))) then
    raise exception 'facial_v2_legacy_stock_triggers'
      using hint = 'Reconcile production_hardening.sql stock RPCs/triggers before applying facial v2; do not double-debit stock.';
  end if;
end;
$$;

alter table public.biometric_deletion_queue
  add column if not exists storage_bucket text not null default 'biometric_photos';
alter table public.biometric_deletion_queue drop constraint if exists biometric_deletion_queue_storage_bucket_check;
alter table public.biometric_deletion_queue add constraint biometric_deletion_queue_storage_bucket_check
  check (storage_bucket in ('biometric_photos', 'ppe_signatures'));

-- This additive soft-delete prerequisite was missing in the observed live
-- schema; do not assume every old migration from the source snapshot ran.
alter table public.employees
  add column if not exists registration_number text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;
create index if not exists idx_employees_company_active_not_deleted
  on public.employees(company_id,active) where deleted_at is null;
alter table public.employees drop constraint if exists employees_registration_number_check;
alter table public.employees add constraint employees_registration_number_check
  check (registration_number is null or (length(registration_number) <= 64
    and length(btrim(registration_number)) > 0 and registration_number = btrim(registration_number)));
create unique index if not exists employees_company_registration_number_unique
  on public.employees(company_id,registration_number) where registration_number is not null;

alter table public.biometric_profiles
  add column if not exists status text not null default 'revoked',
  add column if not exists model_sha256 text;
alter table public.biometric_profiles drop constraint if exists biometric_profiles_status_check;
alter table public.biometric_profiles add constraint biometric_profiles_status_check
  check (status in ('active', 'revoked'));
alter table public.biometric_profiles drop constraint if exists biometric_profiles_active_v2_check;
alter table public.biometric_profiles add constraint biometric_profiles_active_v2_check check (
  status <> 'active' or (
    embedding_encrypted is not null and length(embedding_encrypted) > 0
    and embedding is null and model_name = 'opencv-sface-2021dec'
    and embedding_dimensions = 128 and model_sha256 is not null and model_sha256 ~ '^[0-9a-f]{64}$'
    and key_version is not null and length(key_version) > 0 and revoked_at is null
  )
);

create table if not exists public.biometric_enrollments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  actor_id uuid,
  remote_link_id uuid references public.remote_links(id) on delete set null,
  embedding_encrypted text,
  model_id text not null,
  model_sha256 text not null check (model_sha256 ~ '^[0-9a-f]{64}$'),
  quality jsonb,
  photo_path text,
  key_version text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists biometric_enrollments_one_capture_link
  on public.biometric_enrollments(remote_link_id) where remote_link_id is not null;
create index if not exists biometric_enrollments_pending_employee
  on public.biometric_enrollments(company_id, employee_id, created_at desc) where status = 'pending';
alter table public.biometric_enrollments enable row level security;
alter table public.biometric_enrollments force row level security;
revoke all on public.biometric_enrollments from public, anon, authenticated;
grant select, insert, update, delete on public.biometric_enrollments to service_role;
alter table public.biometric_profiles enable row level security;
alter table public.biometric_profiles force row level security;
alter table public.biometric_sessions enable row level security;
alter table public.biometric_sessions force row level security;
revoke all on public.biometric_profiles,public.biometric_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.biometric_profiles,public.biometric_sessions to service_role;

alter table public.biometric_sessions
  add column if not exists actor_id uuid,
  add column if not exists remote_link_id uuid references public.remote_links(id) on delete set null,
  add column if not exists expires_at timestamptz,
  add column if not exists context_hash text,
  add column if not exists delivery_context jsonb,
  add column if not exists reference_profile_updated_at timestamptz,
  add column if not exists reference_model_id text,
  add column if not exists verification_nonce uuid not null default gen_random_uuid(),
  add column if not exists evidence_hash text,
  add column if not exists capture_storage_path text,
  add column if not exists model_id text,
  add column if not exists model_sha256 text,
  add column if not exists calibration_id text,
  add column if not exists pad_model_id text,
  add column if not exists threshold numeric,
  add column if not exists pad_threshold numeric,
  add column if not exists accepted_at timestamptz,
  add column if not exists consumed_at timestamptz,
  add column if not exists idempotency_key text,
  add column if not exists delivery_ids uuid[],
  add column if not exists result jsonb;
create index if not exists biometric_sessions_unconsumed_v2
  on public.biometric_sessions(company_id, employee_id, expires_at)
  where context_hash is not null and consumed_at is null;
create unique index if not exists biometric_sessions_unique_approved_capture
  on public.biometric_sessions(company_id,evidence_hash)
  where decision = 'approved' and evidence_hash is not null;
alter table public.biometric_sessions drop constraint if exists biometric_sessions_v2_scope_check;
alter table public.biometric_sessions add constraint biometric_sessions_v2_scope_check check (
  context_hash is null or (
    context_hash ~ '^[0-9a-f]{64}$' and delivery_context is not null
    and expires_at is not null and company_id is not null and employee_id is not null
    and ((actor_id is not null and remote_link_id is null)
      or (actor_id is null and remote_link_id is not null))
  )
);
alter table public.deliveries add column if not exists biometric_session_id uuid
  references public.biometric_sessions(id) on delete restrict;
create index if not exists deliveries_biometric_session_id
  on public.deliveries(biometric_session_id) where biometric_session_id is not null;

-- Explicit actor arguments are safe only because these functions are service-only.
-- Also check current trusted account/membership data, not a client role string.
create or replace function public.safeepi_facial_actor_allowed(p_actor_id uuid, p_company_id uuid, p_admin_only boolean)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_actor_id is not null and exists (
    select 1 from auth.users u where u.id = p_actor_id and (
      u.raw_app_meta_data->>'role' = 'MASTER'
      or exists (select 1 from public.profiles p where p.id = u.id and p.role = 'MASTER')
      or exists (select 1 from public.company_users cu where cu.user_id = u.id
        and cu.company_id = p_company_id and cu.active = true
        and (cu.role = 'ADMIN' or (not p_admin_only and cu.role = 'ALMOXARIFE')))
    )
  );
$$;

create or replace function public.safeepi_create_facial_enrollment(
  p_id uuid, p_company_id uuid, p_employee_id uuid, p_actor_id uuid, p_remote_link_id uuid,
  p_embedding_encrypted text, p_model_id text, p_model_sha256 text,
  p_quality jsonb, p_photo_path text, p_key_version text
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare link_row public.remote_links%rowtype;
begin
  if p_id is null or p_company_id is null or p_employee_id is null
    or coalesce(length(p_embedding_encrypted),0) = 0 or coalesce(length(p_key_version),0) = 0
    or p_model_id is distinct from 'opencv-sface-2021dec'
    or p_model_sha256 is null or p_model_sha256 !~ '^[0-9a-f]{64}$'
    or (p_actor_id is null) = (p_remote_link_id is null) then
    raise exception 'invalid_facial_enrollment';
  end if;
  perform 1 from public.companies where id = p_company_id and active = true for share;
  if not found then raise exception 'company_not_found'; end if;
  perform 1 from public.employees where id = p_employee_id and company_id = p_company_id
    and active = true and deleted_at is null for update;
  if not found then raise exception 'employee_not_found'; end if;
  if p_actor_id is not null and not public.safeepi_facial_actor_allowed(p_actor_id, p_company_id, true) then
    raise exception 'facial_enrollment_forbidden';
  end if;
  if p_remote_link_id is not null then
    select * into link_row from public.remote_links where id = p_remote_link_id for update;
    if not found or link_row.company_id is distinct from p_company_id
      or link_row.employee_id is distinct from p_employee_id or link_row.type <> 'capture'
      or link_row.status <> 'pending' or link_row.expires_at <= clock_timestamp() then
      raise exception 'remote_link_invalid';
    end if;
  end if;
  insert into public.biometric_enrollments(id, company_id, employee_id, actor_id, remote_link_id,
    embedding_encrypted, model_id, model_sha256, quality, photo_path, key_version)
  values (p_id, p_company_id, p_employee_id, p_actor_id, p_remote_link_id,
    p_embedding_encrypted, p_model_id, p_model_sha256, p_quality, p_photo_path, p_key_version);
  if p_remote_link_id is not null then
    update public.remote_links set status = 'completed', completed_at = clock_timestamp() where id = p_remote_link_id;
  end if;
  insert into public.biometric_audit_log(employee_id, company_id, event_type, decision, reason)
  values (p_employee_id, p_company_id, 'facial_enrollment_created', 'pending',
    jsonb_build_object('enrollment_id', p_id, 'actor_id', p_actor_id, 'remote_link_id', p_remote_link_id)::text);
  return p_id;
end;
$$;

create or replace function public.safeepi_approve_facial_enrollment(
  p_enrollment_id uuid, p_company_id uuid, p_employee_id uuid, p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare enrollment_row public.biometric_enrollments%rowtype;
  previous_photo text;
  approved_time timestamptz := clock_timestamp();
begin
  if not public.safeepi_facial_actor_allowed(p_actor_id, p_company_id, true) then
    raise exception 'facial_enrollment_forbidden';
  end if;
  perform 1 from public.companies where id = p_company_id and active = true for share;
  if not found then raise exception 'company_not_found'; end if;
  perform 1 from public.employees where id = p_employee_id and company_id = p_company_id
    and active = true and deleted_at is null for update;
  if not found then raise exception 'employee_not_found'; end if;
  select * into enrollment_row from public.biometric_enrollments where id = p_enrollment_id for update;
  if not found or enrollment_row.company_id is distinct from p_company_id
    or enrollment_row.employee_id is distinct from p_employee_id then raise exception 'enrollment_not_found'; end if;
  if enrollment_row.status <> 'pending' or enrollment_row.expires_at <= approved_time then
    raise exception 'enrollment_not_pending';
  end if;
  if enrollment_row.model_id <> 'opencv-sface-2021dec' or enrollment_row.embedding_encrypted is null then
    raise exception 'invalid_facial_enrollment';
  end if;
  if enrollment_row.photo_path is not null then
    select photo_url into previous_photo from public.employees where id = p_employee_id;
    if nullif(previous_photo,'') is not null and previous_photo is distinct from enrollment_row.photo_path then
      insert into public.biometric_deletion_queue(employee_id,company_id,storage_path,reason)
      values (p_employee_id,p_company_id,previous_photo,'facial_photo_replaced');
    end if;
    update public.employees set photo_url = enrollment_row.photo_path where id = p_employee_id;
  end if;
  insert into public.biometric_profiles(employee_id, company_id, embedding, embedding_encrypted,
    model_provider, model_name, embedding_dimensions, key_version, model_sha256, status, revoked_at, updated_at)
  values (p_employee_id, p_company_id, null, enrollment_row.embedding_encrypted, 'opencv',
    enrollment_row.model_id, 128, enrollment_row.key_version, enrollment_row.model_sha256, 'active', null, approved_time)
  on conflict (employee_id) do update set company_id = excluded.company_id, embedding = null,
    embedding_encrypted = excluded.embedding_encrypted, model_provider = excluded.model_provider,
    model_name = excluded.model_name, embedding_dimensions = excluded.embedding_dimensions,
    key_version = excluded.key_version, model_sha256 = excluded.model_sha256,
    status = 'active', revoked_at = null, updated_at = excluded.updated_at;
  update public.biometric_enrollments set status = 'approved', approved_by = p_actor_id,
    approved_at = approved_time, embedding_encrypted = null where id = p_enrollment_id;
  insert into public.biometric_deletion_queue(employee_id,company_id,storage_path,reason)
    select employee_id,company_id,photo_path,'facial_enrollment_superseded' from public.biometric_enrollments
    where company_id = p_company_id and employee_id = p_employee_id and id <> p_enrollment_id
      and status = 'pending' and photo_path is not null and photo_path is distinct from enrollment_row.photo_path;
  update public.biometric_enrollments set status = 'rejected',embedding_encrypted = null,photo_path = null
    where company_id = p_company_id and employee_id = p_employee_id and id <> p_enrollment_id and status = 'pending';
  -- Legacy employee descriptors are never used or populated by v2.
  insert into public.biometric_audit_log(employee_id, company_id, event_type, decision, reason)
  values (p_employee_id, p_company_id, 'facial_enrollment_approved', 'approved',
    jsonb_build_object('enrollment_id', p_enrollment_id, 'actor_id', p_actor_id,
      'model_id', enrollment_row.model_id, 'model_sha256', enrollment_row.model_sha256)::text);
  return jsonb_build_object('employee_id', p_employee_id, 'company_id', p_company_id,
    'status', 'active', 'model_name', enrollment_row.model_id, 'model_sha256', enrollment_row.model_sha256,
    'embedding_dimensions', 128, 'updated_at', approved_time);
end;
$$;

-- Bind the challenge context at creation; neither browser nor later API updates
-- may swap a person, tenant, operator, reference template or receipt contents.
create or replace function public.safeepi_guard_facial_session()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.context_hash is not null then
    if old.consumed_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'facial_session_consumed';
    end if;
    if row(new.company_id, new.employee_id, new.actor_id, new.remote_link_id, new.mode,
      new.context_hash, new.delivery_context, new.verification_nonce, new.reference_profile_updated_at,
      new.reference_model_id, new.expires_at)
      is distinct from row(old.company_id, old.employee_id, old.actor_id, old.remote_link_id, old.mode,
      old.context_hash, old.delivery_context, old.verification_nonce, old.reference_profile_updated_at,
      old.reference_model_id, old.expires_at) then raise exception 'facial_context_immutable'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_safeepi_guard_facial_session on public.biometric_sessions;
create trigger trg_safeepi_guard_facial_session before update on public.biometric_sessions
  for each row execute function public.safeepi_guard_facial_session();

-- All facial writes, including legacy service RPCs and direct client writes,
-- must refer to an ID preallocated inside the finalization transaction.
create or replace function public.safeepi_guard_facial_delivery()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare session_row public.biometric_sessions%rowtype; item jsonb; item_index integer;
begin
  if tg_op = 'DELETE' then
    if old.biometric_session_id is not null then raise exception 'facial_delivery_immutable'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.biometric_session_id is not null then
    if (to_jsonb(new) - array['returned_at','returned_quantity','return_motive','deleted_at','deleted_by','deleted_reason'])
      is distinct from
      (to_jsonb(old) - array['returned_at','returned_quantity','return_motive','deleted_at','deleted_by','deleted_reason']) then
      raise exception 'facial_delivery_immutable';
    end if;
    return new;
  end if;
  -- Old facial rows remain explicitly unverified, but ordinary returns/voids
  -- must not be disabled by installing v2. No historical evidence rewrite.
  if tg_op = 'UPDATE' and old.auth_method = 'facial' and new.biometric_session_id is null then
    if (to_jsonb(new) - array['returned_at','returned_quantity','return_motive','deleted_at','deleted_by','deleted_reason'])
      is distinct from
      (to_jsonb(old) - array['returned_at','returned_quantity','return_motive','deleted_at','deleted_by','deleted_reason']) then
      raise exception 'facial_proof_required';
    end if;
    return new;
  end if;
  if coalesce(new.auth_method,'') <> 'facial' and new.biometric_session_id is null then return new; end if;
  if new.auth_method is distinct from 'facial' or new.biometric_session_id is null then
    raise exception 'facial_proof_required';
  end if;
  select * into session_row from public.biometric_sessions where id = new.biometric_session_id;
  if not found or session_row.mode <> 'verify' or session_row.decision <> 'approved'
    or session_row.consumed_at is not null or session_row.accepted_at is null
    or session_row.expires_at <= clock_timestamp() or session_row.result->'receipt' is null
    or not coalesce(new.id = any(session_row.delivery_ids), false) then raise exception 'facial_proof_required'; end if;
  item_index := array_position(session_row.delivery_ids, new.id);
  item := session_row.delivery_context->'items'->(item_index - 1);
  if new.company_id is distinct from session_row.company_id
    or new.employee_id is distinct from session_row.employee_id
    or new.ppe_id is distinct from (item->>'ppe_id')::uuid
    or new.quantity is distinct from (item->>'quantity')::integer
    or new.reason is distinct from item->>'reason'
    or new.workplace_id is distinct from (session_row.delivery_context->>'workplace_id')::uuid
    or new.third_party_id is distinct from (session_row.delivery_context->>'third_party_id')::uuid
    or new.signature_url is distinct from session_row.capture_storage_path
    or new.ip_address is distinct from session_row.result->'receipt'->>'ip_address' then
    raise exception 'facial_delivery_context_mismatch';
  end if;
  if coalesce(jsonb_array_length(session_row.delivery_context->'delivery_ids'),0) = 0 then
    if tg_op <> 'INSERT' or new.delivery_date is distinct from
      (session_row.delivery_context->>'delivery_date')::timestamptz
      or new.idempotency_key is distinct from session_row.idempotency_key || ':' || item_index::text then
      raise exception 'facial_delivery_context_mismatch';
    end if;
  else
    if tg_op <> 'UPDATE' or old.signature_url is not null or old.deleted_at is not null
      or (to_jsonb(new) - array['signature_url','auth_method','ip_address','biometric_session_id'])
        is distinct from (to_jsonb(old) - array['signature_url','auth_method','ip_address','biometric_session_id']) then
      raise exception 'facial_delivery_context_mismatch';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_safeepi_guard_facial_delivery on public.deliveries;
create trigger trg_safeepi_guard_facial_delivery before insert or update or delete on public.deliveries
  for each row execute function public.safeepi_guard_facial_delivery();

create or replace function public.safeepi_finalize_facial_delivery(
  p_session_id uuid, p_actor_id uuid, p_remote_link_id uuid, p_context_hash text,
  p_idempotency_key text, p_signature_url text, p_ip_address text, p_accepted boolean
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  session_row public.biometric_sessions%rowtype;
  profile_row public.biometric_profiles%rowtype;
  link_row public.remote_links%rowtype;
  ppe_row public.ppes%rowtype;
  delivery_row public.deliveries%rowtype;
  item jsonb; items jsonb; receipt jsonb; result_ jsonb;
  ids uuid[] := array[]::uuid[];
  signature_only boolean; item_index integer := 0; item_count integer; locked_count integer;
  target_workplace uuid; target_third_party uuid; item_ppe uuid;
  accepted_time timestamptz := clock_timestamp();
begin
  if p_accepted is distinct from true then raise exception 'facial_acceptance_required'; end if;
  if coalesce(length(p_idempotency_key),0) < 8 or length(p_idempotency_key) > 180 then
    raise exception 'invalid_idempotency_key';
  end if;
  select * into session_row from public.biometric_sessions where id = p_session_id;
  if not found or session_row.context_hash is null then raise exception 'facial_session_not_found'; end if;
  if session_row.actor_id is distinct from p_actor_id or session_row.remote_link_id is distinct from p_remote_link_id
    or (p_actor_id is null) = (p_remote_link_id is null) then raise exception 'facial_actor_mismatch'; end if;
  if p_context_hash is distinct from session_row.context_hash then raise exception 'facial_context_mismatch'; end if;
  perform 1 from public.companies where id = session_row.company_id and active = true for share;
  if not found then raise exception 'company_not_found'; end if;
  if p_actor_id is not null and not public.safeepi_facial_actor_allowed(p_actor_id, session_row.company_id, false) then
    raise exception 'facial_actor_forbidden';
  end if;
  -- Same lock order as enrollment/revocation: employee, profile, link, session.
  -- A preliminary read is safe because the scope/context fields are immutable.
  perform 1 from public.employees where id = session_row.employee_id for update;
  select * into profile_row from public.biometric_profiles where employee_id = session_row.employee_id for share;
  if p_remote_link_id is not null then
    select * into link_row from public.remote_links where id = p_remote_link_id for update;
    if not found or link_row.company_id is distinct from session_row.company_id
      or link_row.employee_id is distinct from session_row.employee_id or link_row.type <> 'delivery' then
      raise exception 'remote_link_invalid';
    end if;
  end if;
  select * into session_row from public.biometric_sessions where id = p_session_id for update;
  -- An exact retry is a read of an already committed receipt, not a new approval.
  if session_row.consumed_at is not null then
    if session_row.idempotency_key is distinct from p_idempotency_key or session_row.result is null then
      raise exception 'facial_session_consumed';
    end if;
    return session_row.result;
  end if;
  if session_row.mode <> 'verify' or session_row.decision <> 'approved'
    or session_row.expires_at is null or session_row.expires_at <= accepted_time
    or session_row.model_id is distinct from 'opencv-sface-2021dec'
    or session_row.evidence_hash is null or session_row.evidence_hash !~ '^[0-9a-f]{64}$'
    or nullif(session_row.capture_storage_path,'') is null
    or nullif(session_row.calibration_id,'') is null or nullif(session_row.pad_model_id,'') is null
    or session_row.threshold is null or session_row.threshold <= 0 or session_row.threshold > 1
    or session_row.similarity_score is null or session_row.pad_threshold is null
    or session_row.pad_threshold <= 0 or session_row.pad_threshold > 1
    or session_row.spoof_score is null or session_row.spoof_score < session_row.pad_threshold
    or session_row.similarity_score < session_row.threshold then raise exception 'facial_proof_invalid'; end if;
  if p_signature_url is distinct from session_row.capture_storage_path then
    raise exception 'facial_capture_mismatch';
  end if;
  if p_remote_link_id is not null and (link_row.status <> 'pending' or link_row.expires_at <= accepted_time) then
    raise exception 'remote_link_invalid';
  end if;
  perform 1 from public.employees where id = session_row.employee_id and company_id = session_row.company_id
    and active = true and deleted_at is null for update;
  if not found then raise exception 'employee_not_found'; end if;
  select * into profile_row from public.biometric_profiles where employee_id = session_row.employee_id for share;
  if not found or profile_row.company_id is distinct from session_row.company_id or profile_row.status <> 'active'
    or profile_row.revoked_at is not null or profile_row.embedding_encrypted is null
    or profile_row.updated_at is distinct from session_row.reference_profile_updated_at
    or profile_row.model_name is distinct from session_row.reference_model_id
    or profile_row.model_name is distinct from session_row.model_id
    or profile_row.model_sha256 is distinct from session_row.model_sha256 then raise exception 'facial_reference_changed'; end if;
  if (session_row.delivery_context->>'company_id')::uuid is distinct from session_row.company_id
    or (session_row.delivery_context->>'employee_id')::uuid is distinct from session_row.employee_id then
    raise exception 'facial_context_mismatch';
  end if;
  items := session_row.delivery_context->'items';
  if jsonb_typeof(items) is distinct from 'array' then raise exception 'facial_items_invalid'; end if;
  item_count := jsonb_array_length(items);
  if item_count < 1 or item_count > 100 then raise exception 'facial_items_invalid'; end if;
  target_workplace := (session_row.delivery_context->>'workplace_id')::uuid;
  target_third_party := (session_row.delivery_context->>'third_party_id')::uuid;
  if target_workplace is not null then
    perform 1 from public.workplaces where id = target_workplace and company_id = session_row.company_id for share;
    if not found then raise exception 'workplace_scope_mismatch'; end if;
  end if;
  if target_third_party is not null then
    perform 1 from public.third_parties where id = target_third_party and company_id = session_row.company_id for share;
    if not found then raise exception 'third_party_scope_mismatch'; end if;
  end if;
  signature_only := coalesce(jsonb_array_length(session_row.delivery_context->'delivery_ids'),0) > 0;
  for item in select value from jsonb_array_elements(items) loop
    if (item->>'ppe_id')::uuid is null or (item->>'quantity')::integer is null or (item->>'quantity')::integer <= 0
      or item->>'reason' is null then raise exception 'facial_items_invalid'; end if;
  end loop;
  if signature_only then
    select array_agg(value::uuid order by ord) into ids
      from jsonb_array_elements_text(session_row.delivery_context->'delivery_ids') with ordinality as d(value,ord);
    if cardinality(ids) <> item_count or (select count(distinct x) from unnest(ids) as x) <> item_count then
      raise exception 'delivery_scope_mismatch';
    end if;
    -- Stable order prevents deadlocks when two links mention overlapping batches.
    perform 1 from public.deliveries where id = any(ids) order by id for update;
    get diagnostics locked_count = row_count;
    if locked_count <> item_count then raise exception 'delivery_scope_mismatch'; end if;
    for item_index in 1..item_count loop
      item := items->(item_index - 1);
      select * into delivery_row from public.deliveries where id = ids[item_index];
      if delivery_row.company_id is distinct from session_row.company_id
        or delivery_row.employee_id is distinct from session_row.employee_id
        or delivery_row.ppe_id is distinct from (item->>'ppe_id')::uuid
        or delivery_row.quantity is distinct from (item->>'quantity')::integer
        or delivery_row.reason is distinct from item->>'reason'
        or delivery_row.workplace_id is distinct from target_workplace
        or delivery_row.third_party_id is distinct from target_third_party
        or delivery_row.signature_url is not null or delivery_row.biometric_session_id is not null
        or delivery_row.deleted_at is not null then raise exception 'delivery_scope_mismatch'; end if;
    end loop;
  else
    if session_row.delivery_context->>'delivery_date' is null then raise exception 'facial_items_invalid'; end if;
    -- Lock every PPE before touching any stock, including repeated PPE items.
    for item_ppe in select distinct (value->>'ppe_id')::uuid from jsonb_array_elements(items) order by 1 loop
      select * into ppe_row from public.ppes where id = item_ppe and company_id = session_row.company_id
        and active = true for update;
      if not found then raise exception 'ppe_not_found'; end if;
      if coalesce(ppe_row.current_stock,0) < (select sum((value->>'quantity')::bigint)
        from jsonb_array_elements(items) where (value->>'ppe_id')::uuid = item_ppe) then
        raise exception 'insufficient_stock';
      end if;
      if exists (select 1 from jsonb_array_elements(items) where (value->>'ppe_id')::uuid = item_ppe
        and (value->>'ca_number' is distinct from ppe_row.ca_number or value->>'ppe_name' is distinct from ppe_row.name)) then
        raise exception 'ppe_catalog_changed';
      end if;
    end loop;
    for item_index in 1..item_count loop ids := array_append(ids, gen_random_uuid()); end loop;
  end if;
  receipt := jsonb_build_object('session_id', session_row.id, 'company_id', session_row.company_id,
    'employee_id', session_row.employee_id, 'actor_id', p_actor_id, 'remote_link_id', p_remote_link_id,
    'context_hash', session_row.context_hash, 'context', session_row.delivery_context,
    'accepted_at', accepted_time, 'acceptance', 'explicit', 'model_id', session_row.model_id,
    'model_sha256', session_row.model_sha256, 'calibration_id', session_row.calibration_id,
    'pad_model_id', session_row.pad_model_id, 'evidence_hash', session_row.evidence_hash,
    'quality_score', session_row.quality_score, 'spoof_score', session_row.spoof_score,
    'pad_threshold', session_row.pad_threshold,
    'similarity_score', session_row.similarity_score, 'threshold', session_row.threshold,
    'signature_url', session_row.capture_storage_path, 'ip_address', left(p_ip_address,120));
  receipt := receipt || jsonb_build_object('receipt_hash',encode(sha256(convert_to(receipt::text,'UTF8')),'hex'),
    'receipt_hash_format','postgres-jsonb-v1');
  update public.biometric_sessions set accepted_at = accepted_time, delivery_ids = ids,
    idempotency_key = p_idempotency_key, result = jsonb_build_object('receipt', receipt) where id = session_row.id;
  for item_index in 1..item_count loop
    item := items->(item_index - 1);
    if signature_only then
      update public.deliveries set signature_url = session_row.capture_storage_path, auth_method = 'facial',
        ip_address = left(p_ip_address,120), biometric_session_id = session_row.id where id = ids[item_index];
    else
      update public.ppes set current_stock = current_stock - (item->>'quantity')::integer
        where id = (item->>'ppe_id')::uuid;
      insert into public.deliveries(id, company_id, employee_id, ppe_id, workplace_id, third_party_id,
        delivery_date, reason, quantity, signature_url, auth_method, ip_address, idempotency_key, biometric_session_id)
      values (ids[item_index], session_row.company_id, session_row.employee_id, (item->>'ppe_id')::uuid,
        target_workplace, target_third_party, (session_row.delivery_context->>'delivery_date')::timestamptz,
        item->>'reason', (item->>'quantity')::integer, session_row.capture_storage_path, 'facial', left(p_ip_address,120),
        p_idempotency_key || ':' || item_index::text, session_row.id);
      insert into public.stock_movements(company_id, ppe_id, delivery_id, quantity, type, motive, created_by_id)
      values (session_row.company_id, (item->>'ppe_id')::uuid, ids[item_index], (item->>'quantity')::integer,
        'SAIDA', 'Entrega de EPI (confirmacao facial)', p_actor_id);
    end if;
  end loop;
  select jsonb_build_object('deliveries', jsonb_agg(to_jsonb(d) order by array_position(ids,d.id)),
    'session_id', session_row.id, 'accepted_at', accepted_time, 'receipt', receipt) into result_
    from public.deliveries d where d.id = any(ids);
  update public.biometric_sessions set consumed_at = clock_timestamp(), state = 'consumed', result = result_
    where id = session_row.id;
  if p_remote_link_id is not null then
    update public.remote_links set status = 'completed', completed_at = clock_timestamp() where id = p_remote_link_id;
  end if;
  insert into public.biometric_audit_log(session_id, employee_id, company_id, event_type, decision, scores, reason, ip_address)
  values (session_row.id, session_row.employee_id, session_row.company_id, 'facial_delivery_accepted', 'approved',
    jsonb_build_object('similarity', session_row.similarity_score, 'threshold', session_row.threshold,
      'quality', session_row.quality_score, 'spoof', session_row.spoof_score, 'pad_threshold',session_row.pad_threshold),
    jsonb_build_object('context_hash', session_row.context_hash, 'delivery_ids', ids,
      'accepted_at', accepted_time, 'actor_id', p_actor_id, 'remote_link_id', p_remote_link_id)::text, left(p_ip_address,120));
  return result_;
end;
$$;

-- A profile replacement or revocation immediately invalidates unused proofs.
create or replace function public.safeepi_invalidate_facial_profile_sessions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if row(old.embedding_encrypted,old.model_name,old.model_sha256,old.status,old.updated_at)
    is distinct from row(new.embedding_encrypted,new.model_name,new.model_sha256,new.status,new.updated_at) then
    update public.biometric_sessions set decision = 'rejected', state = 'rejected', reason = 'reference_changed'
      where employee_id = new.employee_id and company_id = new.company_id and consumed_at is null and context_hash is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_safeepi_invalidate_facial_profile on public.biometric_profiles;
create trigger trg_safeepi_invalidate_facial_profile after update on public.biometric_profiles
  for each row execute function public.safeepi_invalidate_facial_profile_sessions();

-- An administrator editing/revoking a remote link invalidates its unused
-- challenge. The finalizer locks the same link, so this cannot race acceptance.
create or replace function public.safeepi_invalidate_facial_link_sessions()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if row(old.company_id,old.employee_id,old.type,old.data,old.token,old.status,old.expires_at)
    is distinct from row(new.company_id,new.employee_id,new.type,new.data,new.token,new.status,new.expires_at) then
    update public.biometric_sessions set decision = 'rejected', state = 'rejected', reason = 'remote_context_changed'
      where remote_link_id = new.id and consumed_at is null and context_hash is not null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_safeepi_invalidate_facial_link on public.remote_links;
create trigger trg_safeepi_invalidate_facial_link after update on public.remote_links
  for each row execute function public.safeepi_invalidate_facial_link_sessions();

create or replace function public.safeepi_revoke_employee_facial(p_employee_id uuid, p_company_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.biometric_profiles set status = 'revoked', embedding = null, embedding_encrypted = null,
    key_version = null, revoked_at = clock_timestamp(), updated_at = clock_timestamp()
    where employee_id = p_employee_id and company_id = p_company_id;
  insert into public.biometric_deletion_queue(employee_id, company_id, storage_path, reason)
    select employee_id, company_id, photo_path, left(p_reason,100) from public.biometric_enrollments
    where employee_id = p_employee_id and company_id = p_company_id and photo_path is not null;
  update public.biometric_enrollments set status = case when status = 'pending' then 'rejected' else status end,
    embedding_encrypted = null, photo_path = null where employee_id = p_employee_id and company_id = p_company_id;
  update public.biometric_sessions set decision = 'rejected', state = 'rejected', reason = left(p_reason,100)
    where employee_id = p_employee_id and company_id = p_company_id and consumed_at is null and context_hash is not null;
end;
$$;

create or replace function public.safeepi_revoke_facial_on_employee_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (old.active = true and new.active = false) or (old.deleted_at is null and new.deleted_at is not null)
    or old.company_id is distinct from new.company_id
    or (old.face_descriptor_encrypted is not null and new.face_descriptor_encrypted is null)
    or (old.face_descriptor is not null and new.face_descriptor is null and new.face_descriptor_encrypted is null)
    or (old.photo_url is not null and new.photo_url is null) then
    perform public.safeepi_revoke_employee_facial(old.id, old.company_id, 'employee_changed_or_biometry_removed');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_safeepi_revoke_facial_on_employee_change on public.employees;
create trigger trg_safeepi_revoke_facial_on_employee_change after update on public.employees
  for each row execute function public.safeepi_revoke_facial_on_employee_change();

-- Replace only the scoped deletion RPC to cover a v2 profile even when all
-- legacy employees.face_* fields were already NULL. Preserve existing queue.
create or replace function public.safeepi_queue_employee_biometric_deletion(
  p_employee_id uuid, p_company_id uuid, p_reason text default 'manual_deletion'
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare employee_row public.employees%rowtype;
begin
  select * into employee_row from public.employees where id = p_employee_id
    and (p_company_id is null or company_id = p_company_id) for update;
  if not found then raise exception 'employee_not_found'; end if;
  if nullif(employee_row.photo_url,'') is not null then
    insert into public.biometric_deletion_queue(employee_id,company_id,storage_path,reason)
    values (employee_row.id,employee_row.company_id,employee_row.photo_url,left(coalesce(nullif(p_reason,''),'manual_deletion'),100));
  end if;
  insert into public.biometric_deletion_log(employee_id,company_id,photo_url,deleted_at,reason)
  values (employee_row.id,employee_row.company_id,employee_row.photo_url,clock_timestamp(),left(coalesce(nullif(p_reason,''),'manual_deletion'),100));
  perform public.safeepi_revoke_employee_facial(employee_row.id,employee_row.company_id,coalesce(nullif(p_reason,''),'manual_deletion'));
  update public.employees set photo_url = null,face_descriptor = null,face_descriptor_encrypted = null,
    biometric_key_version = null where id = employee_row.id;
  return jsonb_build_object('ok',true,'queued',employee_row.photo_url is not null,'employee_id',employee_row.id);
end;
$$;

create or replace function public.safeepi_expire_facial_enrollments(p_limit integer default 500)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare enrollment_row public.biometric_enrollments%rowtype;
  session_row public.biometric_sessions%rowtype;
  expired_enrollments integer := 0; expired_sessions integer := 0; queued_paths integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 2000 then raise exception 'invalid_cleanup_limit'; end if;
  -- Cleanup grace absorbs uploads bound before expiry but finishing late.
  -- Approval/finalization above still enforce expires_at without any grace.
  for enrollment_row in select * from public.biometric_enrollments
    where status = 'pending' and expires_at + interval '10 minutes' <= clock_timestamp()
    order by expires_at limit p_limit for update skip locked loop
    if enrollment_row.photo_path is not null then
      insert into public.biometric_deletion_queue(employee_id,company_id,storage_path,reason)
      values (enrollment_row.employee_id,enrollment_row.company_id,enrollment_row.photo_path,'expired_facial_enrollment');
      queued_paths := queued_paths + 1;
    end if;
    update public.biometric_enrollments set status = 'rejected',embedding_encrypted = null,photo_path = null
      where id = enrollment_row.id;
    expired_enrollments := expired_enrollments + 1;
  end loop;
  for session_row in select * from public.biometric_sessions
    where context_hash is not null and consumed_at is null
      and expires_at + interval '10 minutes' <= clock_timestamp()
      and (state <> 'expired' or capture_storage_path is not null)
    order by expires_at limit p_limit for update skip locked loop
    if session_row.capture_storage_path is not null then
      insert into public.biometric_deletion_queue(employee_id,company_id,storage_path,reason,storage_bucket)
      values (session_row.employee_id,session_row.company_id,session_row.capture_storage_path,'expired_facial_session','ppe_signatures');
      queued_paths := queued_paths + 1;
    end if;
    update public.biometric_sessions set state = 'expired',decision = 'rejected',reason = 'expired',capture_storage_path = null
      where id = session_row.id;
    expired_sessions := expired_sessions + 1;
  end loop;
  return jsonb_build_object('expired_enrollments',expired_enrollments,'expired_sessions',expired_sessions,'queued_paths',queued_paths);
end;
$$;

revoke all on function public.safeepi_facial_actor_allowed(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.safeepi_create_facial_enrollment(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text) from public,anon,authenticated;
revoke all on function public.safeepi_approve_facial_enrollment(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.safeepi_finalize_facial_delivery(uuid,uuid,uuid,text,text,text,text,boolean) from public,anon,authenticated;
revoke all on function public.safeepi_revoke_employee_facial(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.safeepi_guard_facial_session() from public,anon,authenticated;
revoke all on function public.safeepi_guard_facial_delivery() from public,anon,authenticated;
revoke all on function public.safeepi_invalidate_facial_profile_sessions() from public,anon,authenticated;
revoke all on function public.safeepi_invalidate_facial_link_sessions() from public,anon,authenticated;
revoke all on function public.safeepi_revoke_facial_on_employee_change() from public,anon,authenticated;
revoke all on function public.safeepi_queue_employee_biometric_deletion(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.safeepi_expire_facial_enrollments(integer) from public,anon,authenticated;
grant execute on function public.safeepi_create_facial_enrollment(uuid,uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text) to service_role;
grant execute on function public.safeepi_approve_facial_enrollment(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.safeepi_finalize_facial_delivery(uuid,uuid,uuid,text,text,text,text,boolean) to service_role;
grant execute on function public.safeepi_queue_employee_biometric_deletion(uuid,uuid,text) to service_role;
grant execute on function public.safeepi_expire_facial_enrollments(integer) to service_role;

comment on table public.biometric_enrollments is 'Encrypted server-computed enrollment, requiring explicit ADMIN/MASTER supervised identity approval. No public template access.';
comment on column public.biometric_sessions.delivery_context is 'Immutable canonical snapshot of the employee and EPI batch verified by this session.';
comment on column public.deliveries.biometric_session_id is 'Server-approved, one-use proof bound to this immutable signed delivery. Null for legacy/unverified rows.';
notify pgrst, 'reload schema';
commit;
