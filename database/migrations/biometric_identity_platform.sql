-- SafeEPI biometric identity platform
-- Arquitetura server-side: captura leve no Next.js, processamento facial no FastAPI.

create table if not exists biometric_profiles (
  employee_id uuid primary key references employees(id) on delete cascade,
  company_id uuid references companies(id) on delete cascade,
  embedding jsonb not null,
  model_provider text not null default 'insightface',
  model_name text not null default 'arcface-buffalo_l',
  embedding_dimensions integer not null default 512,
  key_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists biometric_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete set null,
  company_id uuid references companies(id) on delete cascade,
  mode text not null check (mode in ('enroll', 'verify', 'evidence')),
  state text not null,
  decision text not null default 'pending',
  quality_score numeric,
  spoof_score numeric,
  similarity_score numeric,
  consistency_score numeric,
  final_score numeric,
  reason text,
  device_info jsonb,
  ip_address text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists biometric_audit_log (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references biometric_sessions(id) on delete set null,
  employee_id uuid references employees(id) on delete set null,
  company_id uuid references companies(id) on delete cascade,
  event_type text not null,
  decision text,
  reason text,
  scores jsonb,
  challenge_sequence jsonb,
  frame_hashes jsonb,
  device_info jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create index if not exists idx_biometric_profiles_company_id on biometric_profiles(company_id);
create index if not exists idx_biometric_sessions_employee_id on biometric_sessions(employee_id);
create index if not exists idx_biometric_sessions_company_id_created_at on biometric_sessions(company_id, created_at desc);
create index if not exists idx_biometric_audit_company_created_at on biometric_audit_log(company_id, created_at desc);

alter table biometric_profiles enable row level security;
alter table biometric_sessions enable row level security;
alter table biometric_audit_log enable row level security;

comment on table biometric_profiles is 'Perfis biometricos server-side. O app legado ainda pode espelhar employees.face_descriptor durante a transicao.';
comment on column biometric_profiles.embedding is 'Embedding ArcFace 512d. Em producao, criptografar por empresa antes de persistir.';
comment on table biometric_sessions is 'Sessao temporal de verificacao/cadastro facial, usada para observabilidade e auditoria.';
comment on table biometric_audit_log is 'Trilha forense de decisoes biometricas, retries, fallback e tentativas suspeitas.';
