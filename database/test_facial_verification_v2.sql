-- Run ONLY on a disposable/homologation database after the ordered migrations.
-- Every fixture/change is rolled back, including failed subtransaction tests.
-- psql -v ON_ERROR_STOP=1 -f database/test_facial_verification_v2.sql
begin;

do $$
declare
  company_id_ uuid := gen_random_uuid();
  other_company_id uuid := gen_random_uuid();
  employee_id_ uuid := gen_random_uuid();
  actor_id_ uuid := gen_random_uuid();
  ppe_id_ uuid := gen_random_uuid();
  second_ppe_id uuid := gen_random_uuid();
  session_id_ uuid := gen_random_uuid();
  enrollment_id_ uuid := gen_random_uuid();
  grace_session_id uuid := gen_random_uuid();
  grace_enrollment_id uuid := gen_random_uuid();
  link_id_ uuid := gen_random_uuid();
  delivery_id_ uuid;
  context_ jsonb;
  result_ jsonb;
  retry_ jsonb;
  profile_updated timestamptz;
  rejected boolean;
  count_ integer;
begin
  if has_function_privilege('authenticated',
    'public.safeepi_finalize_facial_delivery(uuid,uuid,uuid,text,text,text,text,boolean)', 'EXECUTE')
    or has_table_privilege('authenticated', 'public.biometric_enrollments', 'SELECT') then
    raise exception 'FAIL: biometric service-only grants';
  end if;

  insert into auth.users(id, raw_app_meta_data) values (actor_id_, '{"role":"MASTER"}');
  insert into public.companies(id, name) values (company_id_, 'FACIAL TEST'), (other_company_id, 'OTHER TENANT');
  insert into public.employees(id, company_id, full_name, cpf, job_title, active, admission_date,photo_url,registration_number)
  values (employee_id_, company_id_, 'FACIAL TEST', left(replace(employee_id_::text, '-', ''), 14), 'TEST', true, current_date,'test/old-photo.jpg','TEST-001');
  insert into public.employees(id,company_id,full_name,cpf,job_title,active,admission_date,registration_number)
  values (gen_random_uuid(),other_company_id,'OTHER TENANT EMPLOYEE',left(replace(gen_random_uuid()::text,'-',''),14),'TEST',true,current_date,'TEST-001');
  rejected := false;
  begin
    insert into public.employees(id,company_id,full_name,cpf,job_title,active,admission_date,registration_number)
    values (gen_random_uuid(),company_id_,'DUPLICATE MATRICULA',left(replace(gen_random_uuid()::text,'-',''),14),'TEST',true,current_date,'TEST-001');
  exception when unique_violation then rejected := true; end;
  if not rejected then raise exception 'FAIL: registration unique per company'; end if;
  insert into public.ppes(id, company_id, name, ca_number, ca_expiry_date, active, current_stock)
  values (ppe_id_, company_id_, 'TEST EPI', '123', current_date + 365, true, 10),
         (second_ppe_id, company_id_, 'TEST EPI TWO', '456', current_date + 365, true, 1);
  insert into public.biometric_enrollments(company_id,employee_id,actor_id,embedding_encrypted,
    model_id,model_sha256,key_version,photo_path)
  values (company_id_,employee_id_,actor_id_,'superseded-template','opencv-sface-2021dec',repeat('a',64),'v1','test/superseded.jpg');
  insert into public.biometric_enrollments(id, company_id, employee_id, actor_id, embedding_encrypted,
    model_id, model_sha256, quality, key_version,photo_path)
  values (enrollment_id_, company_id_, employee_id_, actor_id_, 'encrypted-test-fixture',
    'opencv-sface-2021dec', repeat('a', 64), '0.95', 'v1','test/approved-photo.jpg');
  perform public.safeepi_approve_facial_enrollment(enrollment_id_, company_id_, employee_id_, actor_id_);
  select updated_at into profile_updated from public.biometric_profiles where employee_id = employee_id_;
  if not exists (select 1 from public.biometric_profiles where employee_id = employee_id_
    and status = 'active' and embedding is null and embedding_dimensions = 128) then
    raise exception 'FAIL: approved encrypted profile';
  end if;
  if (select photo_url from public.employees where id = employee_id_) <> 'test/approved-photo.jpg'
    or exists(select 1 from public.biometric_enrollments where employee_id = employee_id_ and status = 'pending')
    or not exists(select 1 from public.biometric_deletion_queue where storage_path = 'test/old-photo.jpg')
    or not exists(select 1 from public.biometric_deletion_queue where storage_path = 'test/superseded.jpg') then
    raise exception 'FAIL: supervised recapture replaces photo and rejects stale pending';
  end if;

  context_ := jsonb_build_object('company_id', company_id_, 'employee_id', employee_id_,
    'workplace_id', null, 'third_party_id', null, 'delivery_date', clock_timestamp(),
    'items', jsonb_build_array(jsonb_build_object('ppe_id', ppe_id_, 'quantity', 2,
      'reason', 'Primeira Entrega', 'ca_number', '123', 'ppe_name', 'TEST EPI')));
  insert into public.biometric_sessions(id, company_id, employee_id, actor_id, mode, state, decision,
    expires_at, context_hash, delivery_context, reference_profile_updated_at, reference_model_id,
    model_id, model_sha256, evidence_hash, capture_storage_path, calibration_id, pad_model_id, threshold, similarity_score,pad_threshold,spoof_score)
  values (session_id_, company_id_, employee_id_, actor_id_, 'verify', 'approved', 'approved',
    clock_timestamp() + interval '5 minutes', repeat('b',64), context_, profile_updated,
    'opencv-sface-2021dec', 'opencv-sface-2021dec', repeat('a',64), md5(session_id_::text)||md5(session_id_::text), 'test/capture.jpg',
    'fixture-calibration', 'fixture-pad', 0.5, 0.9,0.7,0.9);

  rejected := false;
  begin
    insert into public.deliveries(company_id, employee_id, ppe_id, quantity, reason, auth_method)
    values (company_id_, employee_id_, ppe_id_, 1, 'Primeira Entrega', 'facial');
  exception when others then rejected := sqlerrm = 'facial_proof_required'; end;
  if not rejected then raise exception 'FAIL: direct facial insert'; end if;

  rejected := false;
  begin
    perform public.safeepi_finalize_facial_delivery(session_id_, actor_id_, null, repeat('b',64),
      'test-key-0001', 'test/capture.jpg', '127.0.0.1', false);
  exception when others then rejected := sqlerrm = 'facial_acceptance_required'; end;
  if not rejected then raise exception 'FAIL: express acceptance'; end if;

  rejected := false;
  begin
    perform public.safeepi_finalize_facial_delivery(session_id_, gen_random_uuid(), null, repeat('b',64),
      'test-key-0001', 'test/capture.jpg', '127.0.0.1', true);
  exception when others then rejected := sqlerrm = 'facial_actor_mismatch'; end;
  if not rejected then raise exception 'FAIL: actor binding'; end if;

  rejected := false;
  begin
    perform public.safeepi_finalize_facial_delivery(session_id_, actor_id_, null, repeat('d',64),
      'test-key-0001', 'test/capture.jpg', '127.0.0.1', true);
  exception when others then rejected := sqlerrm = 'facial_context_mismatch'; end;
  if not rejected then raise exception 'FAIL: transaction binding'; end if;

  rejected := false;
  begin
    perform public.safeepi_finalize_facial_delivery(session_id_, actor_id_, null, repeat('b',64),
      'test-key-0001', 'test/other-photo.jpg', '127.0.0.1', true);
  exception when others then rejected := sqlerrm = 'facial_capture_mismatch'; end;
  if not rejected then raise exception 'FAIL: capture binding'; end if;

  result_ := public.safeepi_finalize_facial_delivery(session_id_, actor_id_, null, repeat('b',64),
    'test-key-0001', 'test/capture.jpg', '127.0.0.1', true);
  delivery_id_ := (result_->'deliveries'->0->>'id')::uuid;
  retry_ := public.safeepi_finalize_facial_delivery(session_id_, actor_id_, null, repeat('b',64),
    'test-key-0001', 'test/capture.jpg', '127.0.0.1', true);
  if result_ is distinct from retry_ then raise exception 'FAIL: idempotent retry'; end if;
  if (select current_stock from public.ppes where id = ppe_id_) <> 8 then
    raise exception 'FAIL: stock exactly once';
  end if;
  if result_->'receipt'->>'model_id' <> 'opencv-sface-2021dec'
    or result_->'receipt'->>'accepted_at' is null then raise exception 'FAIL: receipt evidence'; end if;

  rejected := false;
  begin
    update public.deliveries set signature_url = 'tampered' where id = delivery_id_;
  exception when others then rejected := sqlerrm = 'facial_delivery_immutable'; end;
  if not rejected then raise exception 'FAIL: immutable signed row'; end if;
  rejected := false;
  begin
    delete from public.deliveries where id = delivery_id_;
  exception when others then rejected := sqlerrm = 'facial_delivery_immutable'; end;
  if not rejected then raise exception 'FAIL: immutable signed row deletion'; end if;
  update public.deliveries set returned_quantity = 1 where id = delivery_id_;

  -- A second item lacking stock must roll back the entire batch.
  session_id_ := gen_random_uuid();
  context_ := jsonb_set(context_, '{items}', (context_->'items') || jsonb_build_array(
    jsonb_build_object('ppe_id', second_ppe_id, 'quantity', 2, 'reason', 'Primeira Entrega',
      'ca_number', '456', 'ppe_name', 'TEST EPI TWO')));
  insert into public.biometric_sessions(id, company_id, employee_id, actor_id, mode, state, decision,
    expires_at, context_hash, delivery_context, reference_profile_updated_at, reference_model_id,
    model_id, model_sha256, evidence_hash, capture_storage_path, calibration_id, pad_model_id, threshold, similarity_score,pad_threshold,spoof_score)
  values (session_id_, company_id_, employee_id_, actor_id_, 'verify', 'approved', 'approved',
    clock_timestamp() + interval '5 minutes', repeat('e',64), context_, profile_updated,
    'opencv-sface-2021dec', 'opencv-sface-2021dec', repeat('a',64), md5(session_id_::text)||md5(session_id_::text), 'test/capture.jpg',
    'fixture-calibration', 'fixture-pad', 0.5, 0.9,0.7,0.9);
  rejected := false;
  begin
    perform public.safeepi_finalize_facial_delivery(session_id_, actor_id_, null, repeat('e',64),
      'test-key-0002', 'test/capture.jpg', '127.0.0.1', true);
  exception when others then rejected := sqlerrm = 'insufficient_stock'; end;
  if not rejected then raise exception 'FAIL: batch insufficient stock'; end if;
  if (select current_stock from public.ppes where id = ppe_id_) <> 8 then
    raise exception 'FAIL: batch rollback';
  end if;
  select count(*) into count_ from public.deliveries where company_id = company_id_;
  if count_ <> 1 then raise exception 'FAIL: batch no partial delivery'; end if;

  rejected := false;
  begin
    update public.biometric_sessions set delivery_context = '{}' where id = session_id_;
  exception when others then rejected := sqlerrm = 'facial_context_immutable'; end;
  if not rejected then raise exception 'FAIL: immutable session context'; end if;

  -- Expired verification and enrollment are not usable; cleanup queues only
  -- their temporary photos and never removes a consumed receipt capture.
  insert into public.biometric_sessions(company_id,employee_id,actor_id,mode,state,decision,
    expires_at,context_hash,delivery_context,reference_profile_updated_at,reference_model_id,
    model_id,model_sha256,evidence_hash,capture_storage_path,calibration_id,pad_model_id,threshold,similarity_score,pad_threshold,spoof_score)
  values (company_id_,employee_id_,actor_id_,'verify','approved','approved',
    clock_timestamp() - interval '11 minutes',repeat('f',64),context_,profile_updated,
    'opencv-sface-2021dec','opencv-sface-2021dec',repeat('a',64),repeat('c',64),'test/expired-capture.jpg',
    'fixture-calibration','fixture-pad',0.5,0.9,0.7,0.9) returning id into session_id_;
  rejected := false;
  begin
    perform public.safeepi_finalize_facial_delivery(session_id_, actor_id_, null, repeat('f',64),
      'test-key-expired', 'test/expired-capture.jpg', '127.0.0.1', true);
  exception when others then rejected := sqlerrm = 'facial_proof_invalid'; end;
  if not rejected then raise exception 'FAIL: expired proof'; end if;
  insert into public.biometric_enrollments(company_id,employee_id,actor_id,embedding_encrypted,
    model_id,model_sha256,key_version,photo_path,expires_at)
  values (company_id_,employee_id_,actor_id_,'expired-template','opencv-sface-2021dec',repeat('a',64),
    'v1','test/expired-enrollment.jpg',clock_timestamp() - interval '11 minutes');
  -- A non-cancellable upload may still be completing after session expiry.
  -- Keep its durable path binding during cleanup grace, without accepting it.
  insert into public.biometric_sessions(id,company_id,employee_id,actor_id,mode,state,decision,
    expires_at,context_hash,delivery_context,reference_profile_updated_at,reference_model_id,capture_storage_path,
    model_id,model_sha256,evidence_hash,calibration_id,pad_model_id,threshold,similarity_score,pad_threshold,spoof_score)
  values (grace_session_id,company_id_,employee_id_,actor_id_,'verify','approved','approved',
    clock_timestamp() - interval '1 second',repeat('a',64),context_,profile_updated,
    'opencv-sface-2021dec','test/grace-capture.jpg','opencv-sface-2021dec',repeat('a',64),repeat('d',64),
    'fixture-calibration','fixture-pad',0.5,0.9,0.7,0.9);
  insert into public.biometric_enrollments(id,company_id,employee_id,actor_id,embedding_encrypted,
    model_id,model_sha256,key_version,photo_path,expires_at)
  values (grace_enrollment_id,company_id_,employee_id_,actor_id_,'grace-template','opencv-sface-2021dec',repeat('a',64),
    'v1','test/grace-enrollment.jpg',clock_timestamp() - interval '1 second');
  rejected := false;
  begin
    perform public.safeepi_approve_facial_enrollment(grace_enrollment_id,company_id_,employee_id_,actor_id_);
  exception when others then rejected := sqlerrm = 'enrollment_not_pending'; end;
  if not rejected then raise exception 'FAIL: cleanup grace must not extend enrollment validity'; end if;
  rejected := false;
  begin
    perform public.safeepi_finalize_facial_delivery(grace_session_id,actor_id_,null,repeat('a',64),
      'test-grace-session','test/grace-capture.jpg','127.0.0.1',true);
  exception when others then rejected := sqlerrm = 'facial_proof_invalid'; end;
  if not rejected then raise exception 'FAIL: cleanup grace must not extend proof validity'; end if;
  result_ := public.safeepi_expire_facial_enrollments(500);
  if (result_->>'expired_enrollments')::integer < 1 or (result_->>'expired_sessions')::integer < 1 then
    raise exception 'FAIL: cleanup expiration';
  end if;
  if not exists (select 1 from public.biometric_deletion_queue where storage_path = 'test/expired-capture.jpg'
    and storage_bucket = 'ppe_signatures') or not exists (select 1 from public.biometric_deletion_queue
    where storage_path = 'test/expired-enrollment.jpg' and storage_bucket = 'biometric_photos') then
    raise exception 'FAIL: cleanup bucket routing';
  end if;
  if exists (select 1 from public.biometric_deletion_queue where storage_path = 'test/capture.jpg') then
    raise exception 'FAIL: must retain consumed receipt capture';
  end if;
  if exists(select 1 from public.biometric_deletion_queue where storage_path in ('test/grace-capture.jpg','test/grace-enrollment.jpg'))
    or (select capture_storage_path from public.biometric_sessions where id = grace_session_id) is distinct from 'test/grace-capture.jpg'
    or (select photo_path from public.biometric_enrollments where id = grace_enrollment_id) is distinct from 'test/grace-enrollment.jpg' then
    raise exception 'FAIL: cleanup grace preserves durable upload binding';
  end if;

  -- Remote capture is consumed atomically, never automatically approved.
  insert into public.remote_links(id,company_id,employee_id,type,token,expires_at)
  values (link_id_,company_id_,employee_id_,'capture',repeat('d',64),clock_timestamp() + interval '1 hour');
  enrollment_id_ := public.safeepi_create_facial_enrollment(gen_random_uuid(),company_id_,employee_id_,null,
    link_id_,'remote-template','opencv-sface-2021dec',repeat('a',64),'0.95',null,'v1');
  if (select status from public.remote_links where id = link_id_) <> 'completed'
    or (select status from public.biometric_enrollments where id = enrollment_id_) <> 'pending' then
    raise exception 'FAIL: remote enrollment supervision';
  end if;
  rejected := false;
  begin
    perform public.safeepi_create_facial_enrollment(gen_random_uuid(),company_id_,employee_id_,null,
      link_id_,'remote-template','opencv-sface-2021dec',repeat('a',64),'0.95',null,'v1');
  exception when others then rejected := sqlerrm = 'remote_link_invalid'; end;
  if not rejected then raise exception 'FAIL: capture link one use'; end if;
  update auth.users set raw_app_meta_data = '{"role":"ALMOXARIFE"}' where id = actor_id_;
  insert into public.company_users(company_id,user_id,role,active) values(company_id_,actor_id_,'ALMOXARIFE',true);
  rejected := false;
  begin
    perform public.safeepi_approve_facial_enrollment(enrollment_id_,company_id_,employee_id_,actor_id_);
  exception when others then rejected := sqlerrm = 'facial_enrollment_forbidden'; end;
  if not rejected then raise exception 'FAIL: supervision requires ADMIN/MASTER'; end if;
  update auth.users set raw_app_meta_data = '{"role":"MASTER"}' where id = actor_id_;

  -- Signature-only confirmation preserves the original delivery date and stock.
  delivery_id_ := gen_random_uuid();
  insert into public.deliveries(id,company_id,employee_id,ppe_id,quantity,reason,delivery_date,auth_method)
  values (delivery_id_,company_id_,employee_id_,ppe_id_,1,'Primeira Entrega',now() - interval '7 days','manual');
  link_id_ := gen_random_uuid(); session_id_ := gen_random_uuid();
  context_ := jsonb_build_object('company_id',company_id_,'employee_id',employee_id_,
    'workplace_id',null,'third_party_id',null,'delivery_date',now(),
    'delivery_ids',jsonb_build_array(delivery_id_),
    'items',jsonb_build_array(jsonb_build_object('ppe_id',ppe_id_,'quantity',1,'reason','Primeira Entrega',
      'ca_number','123','ppe_name','TEST EPI')));
  insert into public.remote_links(id,company_id,employee_id,type,token,expires_at,data)
  values (link_id_,company_id_,employee_id_,'delivery',repeat('e',64),clock_timestamp() + interval '1 hour',
    jsonb_build_object('deliveryIds',jsonb_build_array(delivery_id_),'signatureOnly',true));
  insert into public.biometric_sessions(id,company_id,employee_id,remote_link_id,mode,state,decision,
    expires_at,context_hash,delivery_context,reference_profile_updated_at,reference_model_id,
    model_id,model_sha256,evidence_hash,capture_storage_path,calibration_id,pad_model_id,threshold,similarity_score,pad_threshold,spoof_score)
  values (session_id_,company_id_,employee_id_,link_id_,'verify','approved','approved',
    clock_timestamp() + interval '5 minutes',repeat('b',64),context_,profile_updated,
    'opencv-sface-2021dec','opencv-sface-2021dec',repeat('a',64),md5(session_id_::text)||md5(session_id_::text),'test/remote-capture.jpg',
    'fixture-calibration','fixture-pad',0.5,0.9,0.7,0.9);
  result_ := public.safeepi_finalize_facial_delivery(session_id_,null,link_id_,repeat('b',64),
    'test-key-remote','test/remote-capture.jpg','127.0.0.1',true);
  retry_ := public.safeepi_finalize_facial_delivery(session_id_,null,link_id_,repeat('b',64),
    'test-key-remote','test/remote-capture.jpg','127.0.0.1',true);
  if result_ is distinct from retry_ then raise exception 'FAIL: consumed remote retry'; end if;
  if (select current_stock from public.ppes where id = ppe_id_) <> 8
    or (select delivery_date from public.deliveries where id = delivery_id_) <> now() - interval '7 days' then
    raise exception 'FAIL: signature only does not change stock/date';
  end if;

  link_id_ := gen_random_uuid(); session_id_ := gen_random_uuid();
  insert into public.remote_links(id,company_id,employee_id,type,token,expires_at,data)
  values (link_id_,company_id_,employee_id_,'delivery',repeat('f',64),clock_timestamp() + interval '1 hour','{}');
  insert into public.biometric_sessions(id,company_id,employee_id,remote_link_id,mode,state,decision,
    expires_at,context_hash,delivery_context,reference_profile_updated_at,reference_model_id)
  values (session_id_,company_id_,employee_id_,link_id_,'verify','pending','pending',
    clock_timestamp() + interval '5 minutes',repeat('b',64),context_,profile_updated,'opencv-sface-2021dec');
  update public.remote_links set data = '{"changed":true}' where id = link_id_;
  if (select decision from public.biometric_sessions where id = session_id_) <> 'rejected' then
    raise exception 'FAIL: remote payload changes invalidate proof';
  end if;

  -- Revocation invalidates pending approvals, including empty legacy employee fields.
  perform public.safeepi_queue_employee_biometric_deletion(employee_id_, company_id_, 'test');
  if exists (select 1 from public.biometric_profiles where employee_id = employee_id_
      and (status <> 'revoked' or embedding_encrypted is not null)) then
    raise exception 'FAIL: profile removal';
  end if;
  if exists (select 1 from public.biometric_sessions where id = session_id_ and decision = 'approved') then
    raise exception 'FAIL: invalidate proof after removal';
  end if;

  raise notice 'PASS: grants, enrollment, forged facial write, acceptance, actor/context/capture binding, idempotency, stock, immutable receipt, atomic rollback, expiration/grace/buckets, supervision, remote capture/signature replay, link changes, revocation';
end;
$$;

rollback;
