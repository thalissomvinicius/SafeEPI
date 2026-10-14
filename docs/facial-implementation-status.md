# Facial v2 — implementação e liberação

Atualizado em 13/10/2026. Este documento distingue código implementado de operação
validada em produção. Não é uma certificação biométrica ou jurídica.

## Fluxo entregue no código

1. Salvar o colaborador. A matrícula é opcional, única por empresa, e mantém zeros
   à esquerda; os registros antigos não recebem números inventados.
2. Um ADMIN/MASTER abre o cadastro facial. A câmera ocupa uma tela isolada, no
   computador ou no celular. O operador confirma a conferência da identidade.
3. O servidor detecta um único rosto, verifica qualidade, calcula o template
   SFace e o cifra antes de persistir. O navegador nunca envia um vetor aceito
   como identidade. Capturas por link ficam pendentes de revisão do administrador.
4. Na entrega, selecionar funcionário e EPIs. A sessão do servidor vincula empresa,
   ator/link, cadastro de referência e itens. A captura não confirma o recebimento.
5. Apenas uma resposta válida de identidade **e** PAD permite apresentar o aceite
   expresso dos EPIs. Ausência de configuração/calibração oferece assinatura manual.
6. A confirmação grava lote, movimentação de estoque e consumo da prova numa
   transação. Repetir a mesma solicitação consulta o resultado sem duplicar estoque.
7. O PDF distingue assinatura manual, foto de apoio e prova facial. Metadados de
   prova no arquivo são reconstruídos pelo backend a partir da sessão consumida.

Treinamentos/devoluções que ainda não possuem esse protocolo não podem criar uma
assinatura facial apenas com uma fotografia. Mantêm assinatura manual e foto de
apoio explicitamente identificadas. Na entrega facial v2, devoluções anteriores
são operações separadas; não se presume baixa automática dos EPIs antigos.

## Proteções implementadas

- Autorização por empresa, ator e finalidade do link; cadastro supervisionado.
- Template cifrado e associado a modelo/empresa/colaborador; recadastro revoga
  provas pendentes da versão anterior.
- Sessão curta, contexto imutável, aceite explícito e chave de repetição idempotente.
- Modelo/PAD/calibração ausentes ou inconsistentes não resultam em aprovação.
- A foto vinculada à prova é arquivada pelo servidor, sem substituição na confirmação.
- Caminho de retenção persistido antes do upload, com limpeza de cadastros e
  sessões expirados. Provas de entregas consumidas são preservadas.
- APIs faciais antigas aposentadas; não aceitar descritores arbitrários do cliente.
- Câmera com isolamento de foco/rolagem e encerramento dos streams ao sair.

O hash de imagem impede reutilização dos **mesmos bytes**, não uma foto antiga
reencodada. PAD RGB isolado não comprova a origem física da câmera. Foto impressa,
tela, vídeo e injeção precisam ser ensaiados; não anunciar antifraude validado
enquanto esses requisitos não forem atendidos.

## Ambiente online: verificado, não alterado

A conexão "CONTA DO SAFE-EPI" localizou o Supabase SafeEPI, e a equipe Valle contém
o projeto Vercel `safe.epi`, associado a `safe-epi.vercel.app` e ao repositório
`thalissomvinicius/SafeEPI`.

As consultas foram somente de metadados e contagens agregadas. Não foram extraídas
fotos, templates ou dados individuais. O schema online ainda não contém o facial
v2; a migração inclui os pré-requisitos aditivos que faltavam.

A Vercel possui as três variáveis Supabase, mas a consulta de nomes de variáveis
não encontrou `BIOMETRIC_SERVICE_URL`, `BIOMETRIC_SERVICE_TOKEN`,
`BIOMETRIC_ENCRYPTION_KEY` nem `CRON_SECRET`. Não foram exibidos, alterados ou
inventados segredos. O usuário informou não possuir VPS e pediu hospedagem gratuita
sem cartão; Oracle foi descartada e Render está em avaliação apenas para piloto.

Nenhuma migração, contratação ou alteração de credencial foi realizada. A rodada
de interface de 13/10/2026 foi comparada com o GitHub antes da publicação: preserva
paginação, digital/Windows, URLs renovadas e compatibilidade dos fluxos manuais.
O repositório local foi reconectado à `main` existente, sem apagar arquivos do usuário.

Publicar o visual não libera facial v2. `FACIAL_V2_ENABLED` e
`NEXT_PUBLIC_FACIAL_V2_ENABLED` permanecem desligadas por padrão; a API não consulta
tabelas/RPC v2 nesse modo. Cadastro e links manuais não exigem a coluna matrícula,
e o cron mantém o caminho legado. Ativar ambas as flags depende dos requisitos
abaixo. Arquivos SQL no repositório não são executados automaticamente pelo CI.

## O que falta antes de liberar

1. Escolher infraestrutura e testar um piloto HTTPS autenticado sem dados reais.
   Software gratuito não assegura infraestrutura gratuita permanente ou SLA.
2. Revisar os artefatos PAD, exportá-los com integridade/equivalência e executar
   calibração e avaliação independentes com participantes/dispositivos autorizados.
   Não usar limiares inventados ou testes sintéticos para declarar eficácia.
3. Definir com os responsáveis a finalidade, base legal, retenção e alternativa
   não biométrica. Não presumir que consentimento de empregado resolve o tema.
4. Homologar o schema real, concorrência, repetição de confirmação, armazenamento,
   PDF e câmera em iPhone/Safari, Android/Chrome e PC reais.
5. Comparar o código com GitHub, configurar segredos fora do cliente, coordenar a
   migração e a versão compatível, e liberar por piloto. O SQL bloqueia gravações
   faciais legadas imediatamente: não aplicar isoladamente com a versão antiga.

## Referências de execução

- [Plano e decisões](facial-implementation-plan.md)
- [Serviço, modelos e execução](../biometric_service/README.md)
- [Migração, contratos e recuperação](facial-database.md)
- [Roteiro de homologação](facial-validation-checklist.md)
- [Hospedagem gratuita: proposta e limitações](facial-free-hosting.md)
- [Exportação reproduzível do PAD candidato](pad-export.md)

Validação automatizada cobre contratos específicos, não a precisão biométrica.
`npm run verify` executa lint, tipos, testes/cobertura, auditoria de produção e build.
A cobertura configurada mede somente utilitários selecionados, não toda a aplicação.
Para o Python use o runtime 3.12 preparado:

```powershell
biometric_service/.venv/Scripts/python.exe -m unittest discover -s biometric_service/tests -v
```

Os testes SQL usam dados fictícios com rollback em PostgreSQL 17 local. Os smokes
de modelos usam pixels sintéticos. Não houve teste antifraude com pessoas reais.

### Evidências locais em 13/10/2026

- Web: 31 arquivos / 141 testes passaram na rodada final. Cobertura dos três
  utilitários selecionados: 94,89% de instruções e 93,54% de ramos; não é cobertura
  global do sistema. Rodadas concorrentes com builds/smokes atingiram o timeout
  de cinco segundos em testes de interface/importação; a repetição isolada e a
  suite completa sem essas cargas passaram, sem aumentar timeout ou ignorar testes.
- Python: 56 testes passaram, incluindo recusa sem calibração, contratos de
  modelos, autorização, limites de imagem e exportação segura do candidato PAD.
- PAD: duas conversões reais produziram o mesmo SHA-256; equivalência numérica
  em seis entradas sintéticas. Isso não mede eficácia contra fraude. O candidato
  foi preservado em `biometric_service/models/pad-candidate-e9ef6c4b/`, ignorado
  pelo Git, sem ativar qualquer configuração ou inventar limiares.
- Câmera: smoke em Edge com vídeo sintético, nos viewports 390×844, 360×740,
  844×390 e 1440×900. Portal, controles, captura e encerramento do stream passaram;
  o modo paisagem mantém vídeo e controles lado a lado. Isso não substitui
  Safari/iPhone ou Android físicos.
- PDFs reais sintéticos gerados e renderizados: entrega curta em uma página,
  entrega de 35 itens com nomes extensos em cinco páginas. Assinatura e foto
  presentes, nenhum item perdido, QR junto dos metadados e margens respeitadas.
- Lint e verificação de tipos passaram. Build de produção Next 16.3.8 concluído.
- Docker reconstruído com suporte à porta da hospedagem; `/health` respondeu
  200, cadastro sem autenticação respondeu 401 e aprovação facial permaneceu
  indisponível por falta de calibração, como esperado. Nenhum serviço hospedado.
- O smoke em 512 MiB/0,1 CPU completou, mas foi lento; detalhes e limitações estão
  no documento de hospedagem. Não comprova capacidade para mil colaboradores.
- Dependências de produção foram atualizadas para corrigir os alertas encontrados.
  `npm audit --omit=dev` retornou zero vulnerabilidades nesta execução.
  A auditoria completa ainda aponta nove alertas altos na cadeia de ferramentas
  de desenvolvimento ligada a `braces`, sem correção disponível na consulta.
  Não foi usado `npm audit fix --force` nem desativada a auditoria.
