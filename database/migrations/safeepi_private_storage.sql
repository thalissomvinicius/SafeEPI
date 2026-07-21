-- SafeEPI - Storage privado para documentos, assinaturas e evidencias.
-- Rode no Supabase SQL Editor caso prefira aplicar pelo banco em vez do painel.

begin;
set local lock_timeout = '10s';

insert into storage.buckets (id, name, public)
values
  ('ppe_signatures', 'ppe_signatures', false),
  ('biometric_photos', 'biometric_photos', false)
on conflict (id) do update
set public = false;

-- Remove policies antigas de leitura publica, se existirem com estes nomes comuns.
drop policy if exists "Public read access" on storage.objects;
drop policy if exists "Give public access to ppe_signatures" on storage.objects;
drop policy if exists "Leitura publica ppe_signatures" on storage.objects;
drop policy if exists "Leitura pública ppe_signatures" on storage.objects;

commit;

-- O app usa rotas server-side com service_role para gerar signed URLs curtas.
-- Upload direto do cliente continua apenas via token de createSignedUploadUrl.
