# Security Hardening - SafeEPI

Data da auditoria: 20/07/2026

## Protecoes implementadas

- Supabase Storage privado para documentos, assinaturas, fotos e evidencias sensiveis.
- URLs de arquivos sensiveis geradas por signed URL server-side, com validade curta.
- RLS revisado e documentado em `rls_audit.sql`.
- Rate limiting atomico e distribuido no Supabase, com fallback local limitado apenas para indisponibilidade temporaria da migration.
- Middleware server-side com Supabase SSR para bloquear paginas protegidas sem sessao valida.
- CSP bloqueante com nonce por request, headers defensivos e endpoint `/api/csp-report`.
- Validacao Zod nas rotas criticas de usuarios, links remotos, assinatura remota e uploads.
- Respostas HTTP nao expõem mais `message`, `code` ou `details` internos do Supabase.
- Uploads validam magic bytes reais antes de salvar no Storage.

## Buckets

| Bucket | Conteúdo | Acesso |
|--------|----------|--------|
| `ppe_signatures` | assinaturas, PDFs, evidências | service_role + signed URL |
| `biometric_photos` | fotos faciais de colaboradores | service_role apenas |

Novos buckets com dados pessoais, documentos, assinaturas ou biometria devem nascer privados. O cliente nao deve chamar `getPublicUrl()` para esses arquivos.

## Dados Biométricos — Arquitetura e Política de Retenção

**Arquitetura atual:** o navegador apenas abre a câmera, captura frames WebP compactados e envia para APIs server-side. O processamento facial pesado fica fora do browser em um serviço FastAPI com InsightFace/ArcFace, RetinaFace e engine de risco. Não há Faceplugin, ONNX Runtime Web, OpenCV.js ou modelos faciais carregados no celular.

**O que é coletado:** foto facial de referência/evidência e descritor numérico ArcFace de 512 dimensões para verificação de identidade.

**Onde fica:** bucket privado `biometric_photos` (foto) e coluna `face_descriptor_encrypted` em `employees`. O vetor e cifrado no servidor com AES-256-GCM e AAD por empresa; `BIOMETRIC_ENCRYPTION_KEY` nunca e enviada ao navegador nem persistida no banco. Valores antigos em `face_descriptor` sao migrados e zerados na primeira leitura autenticada.

**Quem acessa:** apenas API routes server-side com service_role. O descritor nunca é enviado ao cliente.

**Como é validado:** o cliente envia frames para `/api/biometric/session/*`; o Next.js autentica o usuário ou token remoto, busca a referência biométrica no servidor e repassa apenas o necessário ao serviço FastAPI. A decisão usa similaridade cosseno, qualidade, anti-spoof passivo, consistência temporal e contexto operacional.

**Modo Evidência Facial (Vercel Free):** se `BIOMETRIC_SERVICE_URL` e `BIOMETRIC_SERVICE_TOKEN` não estiverem configurados, o componente entra automaticamente em modo leve. Nesse modo, nenhuma comparação biométrica é prometida: o sistema captura foto facial, assinatura, data, IP e contexto operacional para auditoria. A operação não fica bloqueada por custo de infraestrutura ou indisponibilidade de IA.

**Quando é deletado:**
- Automaticamente ao desativar o colaborador
- Manualmente por ADMIN/MASTER a qualquer momento
- O vinculo e o descritor sao apagados da ficha na mesma transacao que registra a auditoria
- O arquivo fisico entra em `biometric_deletion_queue` e o cron autenticado tenta a exclusao diariamente
- Toda delecao e registrada em `biometric_deletion_log`

**Base legal (LGPD):** biometria e dado pessoal sensivel e exige enquadramento especifico no Art. 11 da LGPD. Nao presumir `legitimo interesse`: a hipotese legal, necessidade, proporcionalidade, prazo de retencao e RIPD devem ser definidos e aprovados pelo encarregado/DPO para o caso concreto antes da ativacao em producao.

**Limite honesto:** sem modelo anti-spoof licenciado e implantado, a verificacao biometrica falha de forma fechada e deve oferecer assinatura manual auditavel. Nao deve ser tratada como KYC bancario.

## Rate limiting

| Escopo | Limite |
| --- | --- |
| `/api/auth/*` e login/cadastro | 5 tentativas por IP a cada 15 minutos |
| `/api/storage/signed-url` | 60 requisicoes por usuario autenticado por hora |
| `/api/remote-delivery` | limite por IP antes do parsing e por link valido depois da validacao |
| `/api/remote-capture` | limite por IP antes do parsing e por link valido depois da validacao |
| `/api/users` criacao | 10 criacoes por empresa por hora |
| Uploads de arquivo | 20 uploads por IP por hora |

## Uploads permitidos

- Imagens: JPEG, PNG e WebP, validadas por magic bytes, limite de 10MB.
- PDFs: validados por magic bytes, limite de 20MB.
- Extensoes executaveis bloqueadas: `.exe`, `.sh`, `.js`, `.php`, `.py`, `.bat`.
- Rotas com arquivo direto validam bytes antes de salvar. Rotas de signed upload URL validam nome/extensao antes de entregar a URL; a confirmacao final do documento deve continuar validando o PDF recebido.

## CSP

A CSP esta em modo report-only para observar violacoes antes de bloquear producao. Origens permitidas:

- `self`
- Supabase HTTPS e WSS derivados de `NEXT_PUBLIC_SUPABASE_URL`
- `https://api.ipify.org`
- `data:` e `blob:` apenas onde necessario para imagens/midia

A politica e enviada como `Content-Security-Policy` bloqueante. Monitore `/api/csp-report`
apos cada alteracao de scripts, Storage ou integracoes e ajuste apenas as origens estritamente necessarias.

## Orientacoes para novos deploys

- Nunca expor `SUPABASE_SERVICE_ROLE_KEY` no frontend.
- Manter `.env*` fora do Git.
- Toda nova API route deve usar autenticacao server-side quando acessar dados sensiveis.
- Toda nova operacao client-side deve depender de RLS validado e testado.
- Toda entrada JSON sensivel deve ter schema Zod.
- Todo upload deve usar `validateUpload` ou validacao equivalente por magic bytes.
- Erros internos devem ser logados no servidor e respondidos ao cliente com mensagem generica.
- Rodar `npm audit`, `npm run build` e revisar logs de CSP antes de promover para producao.
