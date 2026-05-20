-- Arquivo auditavel de documentos assinados.
-- Rode este script no SQL Editor do Supabase antes de exigir arquivamento juridico dos PDFs.

create table if not exists public.signed_documents (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (
    document_type in (
      'delivery',
      'remote_delivery',
      'return',
      'nr06',
      'training_certificate'
    )
  ),
  employee_id uuid references public.employees(id) on delete set null,
  delivery_id uuid references public.deliveries(id) on delete set null,
  delivery_ids uuid[] default '{}'::uuid[],
  training_id uuid references public.trainings(id) on delete set null,
  file_name text not null,
  document_url text not null,
  storage_path text not null,
  sha256_hash text not null unique,
  auth_method text,
  signature_url text,
  photo_evidence_url text,
  ip_address text,
  geo_location text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_signed_documents_employee
  on public.signed_documents(employee_id, created_at desc);

create index if not exists idx_signed_documents_delivery
  on public.signed_documents(delivery_id);

create index if not exists idx_signed_documents_training
  on public.signed_documents(training_id);

alter table public.signed_documents enable row level security;

drop policy if exists "signed_documents_select_authenticated" on public.signed_documents;
create policy "signed_documents_select_authenticated"
  on public.signed_documents
  for select
  to authenticated
  using (true);

drop policy if exists "signed_documents_service_role_all" on public.signed_documents;
create policy "signed_documents_service_role_all"
  on public.signed_documents
  for all
  to service_role
  using (true)
  with check (true);
