# Banco de dados do facial v2

## Instalação e limites

A migração é `database/migrations/facial_verification_v2.sql`. Executar **primeiro em homologação**, após os scripts existentes `biometric_identity_platform.sql` e `production_hardening.sql` e suas dependências descritas em `docs/database.md`. Ela usa os campos multiempresa, terceiros, devolução parcial e exclusão lógica já exigidos pelo backend atual.

A migração é transacional e reexecutável. Não aplica pesos, cria infraestrutura, modifica chaves ou aprova o reconhecimento facial. A liberação continua dependendo das verificações do serviço Python, da calibração e do PAD. Ausência de sessão aprovada impede gravar `auth_method = facial`; assinatura manual não passa por esse novo finalizador.

Antes de produção, confirmar projeto/empresa, backup, espaço para índices, permissões das funções e estado dos gatilhos de estoque. `production_hardening.sql` remove os gatilhos antigos de redução automática: **não reinstalá-los**, pois os RPCs atualizam estoque dentro da própria transação.

Nenhum SQL de alteração foi aplicado ao Supabase por esta implementação. A validação local foi feita em PostgreSQL 17, contêiner descartável sem portas publicadas, com tabelas de dependência sintéticas e a migração original da plataforma biométrica. Isso não substitui a execução contra uma cópia do schema real nem testes de carga/concorrência.

Inspeção somente de leitura do projeto SafeEPI em 13/10/2026 confirmou os pré-requisitos de perfis/sessões, fila e RPCs do hardening. Confirmou também que `employees.deleted_at/deleted_by` ainda não existiam: a migração v2 inclui essas colunas de maneira aditiva. Os defaults de perfis em produção já eram `opencv`/`sface-2021dec`/128, diferentemente do snapshot local antigo; isso não equivale a template validado ou hash de pesos. Os campos auxiliares legados `biometric_enrolled_at/provider/model/dimensions` e o trigger que os limpa na desativação não são removidos. Não havia triggers antigos de débito nas tabelas `deliveries`/`stock_movements`.

### Ordem de publicação e recuperação

1. Validar o serviço Python, os modelos, sua licença, os critérios de calibração/PAD e a configuração num ambiente de homologação. Enquanto indisponível, manter a alternativa manual e não anunciar biometria verificada.
2. Agendar a transição do fluxo facial, deixando claro que o legado não consegue usar os novos RPCs. A migração bloqueia imediatamente novas gravações legadas marcadas como `facial`; não bloqueia criação manual, devolução ou estorno.
3. Com backup e versão nova do aplicativo pronta, aplicar a migração antes de liberar consultas que dependem das novas colunas. Executar os testes no clone/homologação, conferir grants, cron e rotas de cadastro/aceite.
4. Publicar frontend/backend compatíveis, verificar manual primeiro, depois cadastro supervisionado e fluxo facial em um piloto autorizado. Não reaproveitar uma URL de sessão antiga.
5. Se ocorrer falha de implantação, desabilitar a entrada facial e manter a alternativa manual na versão compatível. Preservar schema, recibos, IDs e provas já consumidas. Não eliminar tabelas ou retirar guardas para voltar a aceitar o fluxo facial inseguro.

Uma falha durante o SQL aborta a transação inteira. Após uma aplicação bem-sucedida, a recuperação recomendada é corrigir adiante; rollback destrutivo de schema exige revisão e backup específicos. Limpeza de fotos depende do cron atualizado para entender `storage_bucket`; não ativar a nova expiração com o consumidor antigo que ignora esse campo.

## Dados e acesso

- `employees.registration_number`: matrícula opcional, texto aparado de 1–64 caracteres; unicidade por empresa, preservando zeros à esquerda. Não são inventadas matrículas para registros existentes.
- `biometric_profiles`: template criptografado, empregado e empresa, `status`, modelo, dimensões, SHA-256 dos pesos e versão da chave. Perfil ativo exige `opencv-sface-2021dec`, 128 dimensões, template cifrado e nenhum vetor em claro. Perfis legados começam revogados, com seus dados preservados; não são convertidos entre modelos.
- `biometric_enrollments`: candidatos cifrados que aguardam conferência supervisionada, expiram em 24 horas e registram operador ou link remoto. Aprovação copia o template ao perfil e remove a cópia redundante do candidato.
- `biometric_sessions`: contexto e referência imutáveis, identidade do ator/link, validade, nonce, métricas, modelos e seus hashes, captura verificada, aceite, consumo único, resultado e IDs das entregas.
- `deliveries.biometric_session_id`: referência à prova usada naquele lote. Registros legados continuam sem essa referência e **não recebem retrospectivamente uma prova**.
- `biometric_deletion_queue.storage_bucket`: `biometric_photos` por padrão; capturas temporárias de verificação usam `ppe_signatures`. O cron deve respeitar essa lista permitida.

As tabelas de perfis, candidatos e sessões têm RLS forçada e nenhum privilégio para `anon` ou `authenticated`. Somente o backend com `service_role` acessa os templates. A chave criptográfica fica fora do banco. Os RPCs recebem IDs de atores explicitamente; por isso são exclusivos do backend, que deve validar o token antes de chamá-los. O SQL também consulta os privilégios atuais da conta e da empresa.

## Contrato de cadastro

`safeepi_create_facial_enrollment(p_id, p_company_id, p_employee_id, p_actor_id, p_remote_link_id, p_embedding_encrypted, p_model_id, p_model_sha256, p_quality, p_photo_path, p_key_version) → uuid`

`p_quality` é JSONB. Exatamente um entre operador e link deve ser informado. O colaborador deve estar ativo na empresa. Um link deve ser de captura, estar pendente e dentro da validade. A criação consome esse link na mesma transação; índice único impede dois candidatos para o mesmo link. O resultado continua **pendente**, não aprova identidade automaticamente.

`safeepi_approve_facial_enrollment(p_enrollment_id, p_company_id, p_employee_id, p_actor_id) → jsonb`

Exige MASTER confiável ou vínculo ADMIN ativo naquela empresa, candidato pendente/não expirado e colaborador ativo. A interface deve exigir que o operador confirme a conferência presencial/documental da identidade. O banco registra o operador, não pode comprovar que essa conferência humana ocorreu.

A aprovação atualiza o perfil, troca a foto do cadastro se o candidato tiver foto, enfileira a foto anterior diferente e rejeita os demais candidatos pendentes do colaborador. Retorna metadados do perfil, nunca o template. A nova versão invalida provas ainda não consumidas contra a versão anterior. ALMOXARIFE não aprova cadastro biométrico.

## Contrato de sessão e conclusão

Na criação, informar a empresa, o colaborador, `actor_id` **ou** `remote_link_id`, `expires_at`, `context_hash`, `delivery_context`, `reference_profile_updated_at` e `reference_model_id`. Esses campos não podem ser modificados posteriormente.

O snapshot `delivery_context` possui:

```json
{
  "company_id": "uuid",
  "employee_id": "uuid",
  "workplace_id": null,
  "third_party_id": null,
  "delivery_date": "ISO-8601",
  "items": [
    { "ppe_id": "uuid", "quantity": 1, "reason": "Primeira Entrega", "ca_number": "123", "ppe_name": "Luva" }
  ],
  "delivery_ids": ["somente-na-modalidade-assinar-entregas-existentes"]
}
```

Para nova entrega, omitir `delivery_ids`. Para assinatura de registros existentes, os IDs e itens devem estar na **mesma ordem**, sem IDs duplicados. Datas originais desses registros são preservadas e estoque não é debitado novamente. Local e terceiro devem corresponder aos registros selecionados; lotes com escopos diferentes devem ser separados antes de criar a sessão.

O servidor de verificação atualiza `decision`, `model_id`, `model_sha256`, `calibration_id`, `pad_model_id`, `threshold`, `pad_threshold`, `similarity_score`, `spoof_score`, `quality_score`, `evidence_hash`, `capture_storage_path` e `completed_at`. `spoof_score` representa a probabilidade de apresentação **viva**, portanto deve ser maior ou igual ao limiar PAD. Não confundir com probabilidade de ataque.

Há um índice único `(company_id, evidence_hash)` para provas aprovadas: sessões simultâneas não podem aprovar reutilização dos mesmos bytes. Isso complementa as verificações da API; não substitui PAD nem valida a origem física da câmera.

`safeepi_finalize_facial_delivery(p_session_id, p_actor_id, p_remote_link_id, p_context_hash, p_idempotency_key, p_signature_url, p_ip_address, p_accepted) → jsonb`

O retorno tem `deliveries`, `session_id`, `accepted_at` e `receipt`. Regras:

1. Aceite expresso obrigatório, ator/link exatamente igual ao da sessão e empresa ativa.
2. Prova aprovada, não expirada, referência ativa e mesma versão/modelo/hash. Similaridade e PAD precisam atingir seus limiares, ambos no intervalo `(0,1]`.
3. A imagem da entrega vem de `session.capture_storage_path`. `p_signature_url` diferente é recusado; o cliente não escolhe outra foto depois da verificação.
4. Validar escopos, itens, quantidades, catálogo e estoque. Travar EPIs em ordem estável, considerando quantidades repetidas do mesmo EPI.
5. Alocar todos os IDs antes de inserir e vincular cada linha ao item correspondente. A confirmação do lote e os movimentos de estoque são atômicos.
6. Registrar horário do servidor, métricas e contexto; consumir sessão/link uma única vez. Não existe devolução automática de EPIs anteriores.

Repetir a mesma sessão, chave, ator/link e contexto devolve o recibo já persistido, sem novo débito de estoque. Essa leitura idempotente continua possível depois do consumo do link ou mudança do perfil, desde que o chamador ainda esteja autorizado e a empresa ativa. Outra chave/contexto é recusado.

O `receipt_hash` é SHA-256 do UTF-8 de `receipt::text` **antes** de acrescentar `receipt_hash` e `receipt_hash_format`; formato `postgres-jsonb-v1`. Para conferir no PostgreSQL, remover essas duas propriedades antes de calcular. Não é um hash do PDF, não é assinatura ICP-Brasil e não autentica sozinho a pessoa. O PDF arquivado precisa do seu próprio hash de bytes.

## Integridade, cancelamento e retenção

Um trigger cobre INSERT/UPDATE diretos e RPCs antigos: não é possível criar uma nova entrega facial sem sessão com IDs pré-alocados. Depois da confirmação, os campos assinados não podem ser reescritos nem a linha removida. Permanecem permitidos os campos de devolução e exclusão lógica usados pelos RPCs atuais. Linhas faciais legadas também podem receber devolução/estorno, sem ganhar selo de verificação.

Alterar dados, tipo, token, status ou validade de um link invalida suas provas não consumidas. Troca/revogação do perfil, desativação, exclusão lógica, mudança de empresa ou remoção da biometria do colaborador invalidam provas pendentes. A criptografia de um descritor legado pelo cron não é confundida com exclusão.

`safeepi_queue_employee_biometric_deletion` continua sendo o ponto de entrada para remoção administrativa. Agora também revoga o perfil v2, limpa candidatos e invalida sessões mesmo quando `employees.face_*` já estiver vazio. Arquivos vão para a fila; remoção física depende do cron. Evidências históricas de entregas consumidas não são silenciosamente apagadas por essa operação: prazo/base de retenção documental devem ser definidos separadamente.

`safeepi_expire_facial_enrollments(p_limit integer default 500)` retorna `expired_enrollments`, `expired_sessions`, `queued_paths`. O cron chama antes de drenar a fila. A função rejeita candidatos vencidos, elimina seus templates e enfileira fotos temporárias; expira sessões não consumidas e enfileira suas capturas em `ppe_signatures`. Usa lotes limitados e `SKIP LOCKED`. Capturas que fundamentam entregas consumidas são preservadas.

A limpeza física tem **10 minutos de tolerância depois de `expires_at`**, tanto para candidatos quanto para sessões não consumidas de qualquer estado. Durante esse intervalo, os caminhos continuam vinculados ao registro para absorver uploads já iniciados que não possam ser cancelados. Essa tolerância não estende a validade: cadastro vencido não pode ser aprovado e sessão vencida não pode confirmar entrega. É uma proteção operacional contra uploads retardatários, não uma garantia para uploads que permaneçam em curso por tempo ilimitado; o cliente/servidor deve manter limites de tamanho e tempo e não iniciar novo upload depois do vencimento.

## Testes

Em banco de homologação com as migrações instaladas:

```powershell
psql -v ON_ERROR_STOP=1 -f database/test_facial_verification_v2.sql
```

O arquivo cria dados fictícios dentro de `BEGIN`/`ROLLBACK`; não usar como teste de carga na produção. Cobertura: privilégios, matrícula por empresa, cadastro supervisionado, substituição de foto/candidatos, gravação facial forjada, aceite, ator/contexto/imagem, repetição idempotente, estoque uma única vez, lote sem gravação parcial, imutabilidade, validade, encaminhamento da limpeza por bucket, link de captura de uso único, assinatura de entrega existente, alteração de link e revogação.

Ainda exigidos antes da liberação: executar contra cópia do schema de produção, ensaiar concorrência em sessões/lotes sobrepostos, falhas entre storage e SQL, retenção física pelo cron e testes reais de falso aceite/rejeição/PAD/mobile. Aprovação de SQL não equivale a validação biométrica.
