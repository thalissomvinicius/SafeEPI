-- SafeEPI - enterprise data integrity and query indexes.

set lock_timeout = '10s';

-- All operational rows were checked before this migration: no null company_id
-- values and no cross-company references existed.
alter table public.employees alter column company_id set not null;
alter table public.ppes alter column company_id set not null;
alter table public.deliveries alter column company_id set not null;
alter table public.trainings alter column company_id set not null;
alter table public.workplaces alter column company_id set not null;
alter table public.stock_movements alter column company_id set not null;
alter table public.remote_links alter column company_id set not null;
alter table public.job_titles alter column company_id set not null;
alter table public.departments alter column company_id set not null;
alter table public.signed_documents alter column company_id set not null;

-- A worker may legitimately exist in more than one customer tenant. CPF must
-- be unique inside the company, not globally across the SaaS.
alter table public.employees drop constraint if exists employees_cpf_key;
create unique index if not exists employees_company_cpf_normalized_key
  on public.employees (
    company_id,
    (regexp_replace(cpf, '\D', '', 'g'))
  );

-- Cover foreign keys used by joins, cascade checks and operational filters.
create index if not exists idx_deliveries_ppe_id on public.deliveries(ppe_id);
create index if not exists idx_deliveries_workplace_id on public.deliveries(workplace_id);
create index if not exists idx_employees_workplace_id on public.employees(workplace_id);
create index if not exists idx_stock_movements_ppe_id on public.stock_movements(ppe_id);
create index if not exists idx_trainings_employee_id on public.trainings(employee_id);
create index if not exists idx_trainings_instructor_id on public.trainings(instructor_id);
create index if not exists idx_remote_links_employee_id on public.remote_links(employee_id);
create index if not exists idx_signed_documents_created_by on public.signed_documents(created_by);
create index if not exists idx_biometric_audit_employee_id on public.biometric_audit_log(employee_id);
create index if not exists idx_biometric_audit_session_id on public.biometric_audit_log(session_id);
create index if not exists idx_fingerprint_commands_employee_id on public.fingerprint_commands(employee_id);
create index if not exists idx_fingerprint_commands_matched_employee_id on public.fingerprint_commands(matched_employee_id);
create index if not exists idx_fingerprint_commands_requested_by on public.fingerprint_commands(requested_by);
create index if not exists idx_fingerprint_delivery_links_company_id on public.fingerprint_delivery_links(company_id);
create index if not exists idx_fingerprint_enrollments_employee_id on public.fingerprint_enrollments(employee_id);
create index if not exists idx_fingerprint_enrollments_last_command_id on public.fingerprint_enrollments(last_command_id);
create index if not exists idx_fingerprint_pairings_company_id on public.fingerprint_pairings(company_id);
create index if not exists idx_fingerprint_pairings_created_by on public.fingerprint_pairings(created_by);
create index if not exists idx_fingerprint_terminals_paired_by on public.fingerprint_terminals(paired_by);

-- Tenant-first indexes for the list and search screens.
create index if not exists idx_employees_company_active_name
  on public.employees(company_id, active, full_name, id);
create index if not exists idx_ppes_company_active_name
  on public.ppes(company_id, active, name, id);
create index if not exists idx_workplaces_company_active_name
  on public.workplaces(company_id, active, name, id);
create index if not exists idx_remote_links_company_status_expiry
  on public.remote_links(company_id, status, expires_at);
create index if not exists idx_signed_documents_company_created
  on public.signed_documents(company_id, created_at desc);
create index if not exists idx_stock_movements_company_created
  on public.stock_movements(company_id, created_at desc);

-- Defense in depth at the Storage boundary. Application validation remains in
-- place, while the bucket rejects oversized or unexpected payloads too.
update storage.buckets
set file_size_limit = 20971520,
    allowed_mime_types = array['application/pdf','image/png','image/jpeg','image/webp']
where id = 'ppe_signatures';

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/png','image/jpeg','image/webp']
where id = 'biometric_photos';

analyze public.employees;
analyze public.ppes;
analyze public.deliveries;
analyze public.stock_movements;
analyze public.signed_documents;

notify pgrst, 'reload schema';
