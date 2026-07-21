# Banco de dados

O SafeEPI usa Supabase para Auth, Postgres, RLS e Storage.

## Biometria server-side

A biometria facial nova não roda modelos no navegador. O Next.js captura frames, autentica a sessão/token e chama um serviço FastAPI interno configurado por:

```env
BIOMETRIC_SERVICE_URL=
BIOMETRIC_SERVICE_TOKEN=
SAFE_EPI_BIOMETRIC_SERVICE_TOKEN=
BIOMETRIC_ENCRYPTION_KEY=
CRON_SECRET=
```

O serviço FastAPI usa InsightFace/ArcFace para embeddings 512d e mantém a engine de qualidade, consistência temporal e decisão de risco fora do cliente. Execute a migration `biometric_identity_platform.sql` para preparar as tabelas dedicadas `biometric_profiles`, `biometric_sessions` e `biometric_audit_log`.

## Buckets

O bucket usado para assinaturas, PDFs, fotos e evidências é:

```text
ppe_signatures
biometric_photos
```

Ele deve permanecer **privado**.

Crie o bucket `biometric_photos` (privado) no Supabase Storage antes do primeiro deploy. Ele armazena fotos faciais de colaboradores separadas de assinaturas, PDFs e evidencias operacionais.

Arquivos sensíveis nunca devem ser servidos com `getPublicUrl()`. Use signed URLs geradas por API route server-side.

## Variáveis

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` fica só no servidor.

## Migrations

Os scripts SQL ficam em:

```text
database/migrations/
```

Ordem recomendada para uma base nova:

1. `supabase_schema.sql`
2. `safeepi_multi_company.sql`
3. `safeepi_company_commercial_controls.sql`
4. `safeepi_master_admin.sql`
5. `safeepi_master_all_company_access.sql`
6. `add_workplaces.sql`
7. `supabase_job_sector_catalog.sql`
8. `inventory_management.sql`
9. `add_delivery_id_to_stock_movements.sql`
10. `add_returns_logic.sql`
11. `safeepi_partial_returns_and_employee_dates.sql`
12. `add_facial_biometrics.sql`
13. `add_remote_links.sql`
14. `add_training_instructor.sql`
15. `signed_documents_audit.sql`
16. `safeepi_third_parties.sql`
17. `add_employee_soft_delete.sql`
18. `safeepi_private_storage.sql`
19. `safeepi_security_hardening.sql`
20. `rls_audit.sql`
21. `rls_remote_links_fix.sql`
22. `biometric_retention.sql`
23. `biometric_suspicious_log.sql`
24. `biometric_identity_platform.sql`
25. `production_hardening.sql`

`production_hardening.sql` e obrigatoria nesta versao. Ela instala o rate limit
distribuido, as funcoes transacionais de estoque/entrega, protecao de integridade
dos PDFs, consultas agregadas do dashboard e a fila de exclusao fisica da biometria.
Valide primeiro em staging e faca backup da base de producao antes de aplicar.

Para atualizar uma base de producao existente pelo SQL Editor:

1. Confirme um backup recente.
2. Execute `database/preflight_production_hardening.sql`. Pare se houver erro.
3. Execute o arquivo inteiro `database/migrations/production_hardening.sql`.
4. Execute `database/migrations/production_security_reconciliation.sql` para
   remover policies publicas legadas e proteger a tabela de backup.
5. Execute `database/migrations/production_catalog_rls_reconciliation.sql` para
   restringir cargos e departamentos a empresa selecionada ou ao usuario MASTER.
6. Execute `database/migrations/safeepi_private_storage.sql` depois de confirmar
   que `SUPABASE_SERVICE_ROLE_KEY` esta configurada no ambiente de producao.
7. Execute `database/postcheck_production_hardening.sql` e confirme todos os checks.

Nao execute `supabase db reset` em producao e nao reaplique todas as migrations
antigas sem antes comparar o schema atual. Os scripts de preflight e postcheck nao
alteram dados; as duas migrations acima usam transacao e revertem tudo em caso de
falha.

Depois de mudanças estruturais, execute:

```sql
notify pgrst, 'reload schema';
```

## RLS

Toda tabela pública sensível deve ter RLS ativo.

Operações remotas por token passam por API routes server-side. Não crie policy anônima para assinatura, captura ou entrega remota.

## Checklist antes de produção

- Bucket `ppe_signatures` privado.
- Bucket `biometric_photos` privado.
- RLS aplicado e testado.
- Usuário MASTER com `app_metadata.role = 'MASTER'`.
- Signup público do Supabase desativado se o sistema não aceitar cadastro aberto.
- `npm audit` sem vulnerabilidades.
- `CRON_SECRET` aleatorio com no minimo 32 caracteres configurado na Vercel.
- Cron `/api/cron/biometric-retention` ativo e sem itens com cinco falhas na fila.
- Invocacao autenticada inicial do cron concluida ate `migratedDescriptors` chegar a zero, removendo descritores legados em texto claro.
- `BIOMETRIC_SERVICE_TOKEN` e `SAFE_EPI_BIOMETRIC_SERVICE_TOKEN` iguais, aleatorios e com no minimo 32 caracteres.
- `BIOMETRIC_ENCRYPTION_KEY` gerada com `openssl rand -base64 32`; nunca reutilize o token do servico.
