-- SafeEPI - Storage privado para documentos, assinaturas e evidencias.
-- Rode no Supabase SQL Editor caso prefira aplicar pelo banco em vez do painel.

update storage.buckets
set public = false
where id in ('ppe_signatures');

-- Remove policies antigas de leitura publica, se existirem com estes nomes comuns.
drop policy if exists "Public read access" on storage.objects;
drop policy if exists "Give public access to ppe_signatures" on storage.objects;
drop policy if exists "Leitura publica ppe_signatures" on storage.objects;
drop policy if exists "Leitura pública ppe_signatures" on storage.objects;

-- O app usa rotas server-side com service_role para gerar signed URLs curtas.
-- Upload direto do cliente continua apenas via token de createSignedUploadUrl.
