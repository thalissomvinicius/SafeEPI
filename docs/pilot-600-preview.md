# Prévia do piloto SafeEPI para 600 colaboradores

Branch: `codex/pilot-600-preview`. A versão deve ser publicada como **Preview**, mantendo `main` e o domínio de produção na versão anterior até aprovação do usuário.

## O que esta versão entrega

- Lista de colaboradores com 50 registros renderizados por página. Busca, filtros, contagens e exportações continuam considerando todos os metadados carregados, para preservar as regras atuais.
- Fotos privadas carregadas quando seus elementos se aproximam da área visível, em lotes de até 50 e com até duas chamadas simultâneas. URLs válidas são reutilizadas em memória; mudança de contexto limpa o cache. Falha de foto usa placeholder.
- Recuperação autenticada de PDFs em IndexedDB, antes do primeiro envio. Mantém o Blob original e os vínculos por usuário/empresa; não refaz entregas nem movimentações. Reenvio exige ação do operador e contexto original.
- Aviso de armazenamento indisponível e alternativa de baixar PDF. Essa recuperação é local ao navegador/dispositivo; não substitui uma fila no servidor nem um backup.
- Links públicos mantêm recuperação apenas em memória, por link, sem persistir o token de acesso.
- Laboratório `/preview-lab` disponível apenas na prévia para testar um PDF fictício e recarregar a página, sem chamadas de gravação ao servidor.

## Banco e modo de consulta

Foi confirmado que Preview e Production compartilham os mesmos registros de configuração Supabase na Vercel. O usuário escolheu manter a prévia em consulta enquanto não houver um banco separado.

`VERCEL_ENV=preview` ativa o bloqueio das operações da aplicação no proxy e no fetch dos clientes Supabase. Ficam disponíveis consultas e autenticação normal. O perfil não é sincronizado por escrita no `/api/me` da prévia; contadores de rate limit usam contingência local. Logout usa escopo local para não revogar as sessões de produção.

Isto é proteção dos caminhos desta aplicação, **não isolamento das credenciais ou do banco**. As consultas ainda usam dados reais dentro das permissões existentes. Login/renovação de sessão continuam sendo operações normais do serviço de autenticação. Não criar entregas ou executar scripts de carga no banco real.

## Roteiro para o usuário

1. Entrar no endereço de Preview e conferir o aviso de consulta.
2. Abrir Colaboradores, pesquisar alguém, alternar páginas e conferir os filtros. Exportação deve respeitar o conjunto completo filtrado, não só a página.
3. Abrir um cadastro/prontuário e conferir se uma foto ausente ou indisponível não impede a consulta.
4. Abrir o teste de recuperação pelo banner. Criar o PDF fictício, recarregar, baixar o arquivo recuperado e concluir a simulação.
5. Conferir as telas no computador e celular, anotando erros, demoras e problemas de enquadramento.
6. Após aprovação, planejar a homologação de gravações em Supabase separado antes de promover a versão para o domínio principal.

O laboratório usa um escopo sintético próprio no armazenamento local e não arquiva documentos no Supabase. Nenhum dado fictício deve ser confundido com uma entrega real.

## Conferência autenticada em 04/11/2026

- Acesso à prévia liberado com a proteção da Vercel mantida; sessão do SafeEPI aberta pelo próprio usuário.
- Indicadores e consultas da ANTARES responderam. Colaboradores exibiu 121 registros próprios, em três páginas de até 50; a busca encontrou registros fora da página corrente e voltou à primeira página filtrada. Esse total inclui inativos e não deve ser confundido com a equipe ativa do painel.
- Prontuário, estoque, histórico e formulário inicial de entrega abriram sem confirmar entregas, alterar cadastros ou executar SQL. Nas telas consultadas em 390 px não houve rolagem horizontal do documento.
- Um PDF fictício foi criado no laboratório, persistiu após recarregar e foi baixado. A cópia de teste foi mantida no navegador para conferência do usuário. Nenhum PDF real foi reenviado ao servidor.
- Corrigida a reserva de espaço do aviso no login da prévia. Conferidos 390×844, 390×568, 390×320 e 1440×900 no navegador. Em altura curta, o aviso preserva o status e o link; a explicação extensa continua disponível a leitores de tela. A produção não usa esse arranjo adicional.
- A conferência do login foi local, sem credenciais ou banco real. A redução para 320 px simula espaço disponível com teclado: não substitui teste em Safari/iOS ou Chrome/Android físicos.
- Após o ajuste, passaram 542 testes em 86 arquivos, lint, TypeScript e compilação da prévia. A cobertura configurada considera somente três utilitários de segurança, não a aplicação inteira.

Esta é uma verificação funcional dirigida, não um teste de carga, de concorrência ou uma homologação completa das assinaturas. Os cadastros inspecionados estavam sem foto; imagens reais e o arquivamento autenticado ainda precisam de amostras e banco separado para homologação de gravações.

## Limites e próximos passos

Esta rodada não altera SQL. A listagem ainda consulta todos os metadados em páginas Supabase, com paginação da exibição; busca/paginação integral no servidor permanecem evolução posterior. Custos históricos, matriz por função, kits e parâmetros de estoque/vida útil não foram implementados nesta versão.

Arquivamento real, concorrência de entregas, recuperação de resposta perdida, RLS e restauração de backup precisam de homologação própria em ambiente isolado. Testes sintéticos de 600 registros não são teste de carga de produção.

## Dependências

Next.js e eslint-config-next foram atualizados para 16.4.5 e Zod para a faixa a partir de 4.6.6 após avisos publicados de segurança. `fake-indexeddb` 6.2.7 é dependência apenas de desenvolvimento para testar a persistência. A auditoria de produção ainda aponta oito alertas moderados na cadeia de ExcelJS/minimatch; não foi aplicado downgrade forçado de ExcelJS. Esses alertas exigem revisão antes da promoção definitiva, preservando a compatibilidade das importações/exportações.

Referências verificadas: https://github.com/advisories/GHSA-2464-fhr4-w9xw e https://github.com/advisories/GHSA-mrhx-c7xc-m3w5 e https://github.com/advisories/GHSA-g3hv-75wg-m249.
