# Auditoria de interface e operação — SafeEPI

Data: 13/10/2026. Escopo: código da interface, fluxos de consulta, hierarquia visual, estados e adaptação mobile. Nenhuma alteração de banco de dados, política SQL ou modelo biométrico foi realizada nesta auditoria. Não foram feitos testes de carga contra produção.

## Direção visual

Produto operacional, não página promocional: títulos curtos, texto legível, números tabulares, uma ação principal por contexto e cor da empresa reservada para ação/seleção. Bordas suaves em vez de sombras fortes em todos os elementos. Estados de erro e atualização devem explicar o que aconteceu sem inventar garantias. Animações discretas, sem atrasar navegação ou movimentar dados permanentemente; respeitar preferência de movimento reduzido.

## Achados e prioridades

| Prioridade | Evidência no código | Risco / recomendação |
| --- | --- | --- |
| P1 | Movimentações chama `getDeliveries()` sem `all`, paginação ou filtros remotos. O serviço retorna até 500 registros por padrão. | Consulta, totais e exportação de períodos antigos podem representar apenas a primeira página. Priorizar filtro/paginação no servidor e exportação do conjunto completo; não solucionar baixando todo o histórico em cada abertura. |
| P1 | Entrega aguarda `Promise.all(getEmployees(), getPpes(), getWorkplaces())`; `getEmployees()` percorre todas as páginas e assina fotos antes de devolver a lista. | A abertura fica dependente do conjunto completo de cadastros e arquivos. Separar lista mínima pesquisável da foto sob demanda, cache com isolamento por empresa e estados de erro explícitos. |
| P1 | Movimentações e carregamento inicial de entrega registram erro apenas no console, depois removem o carregamento. | Falha de rede pode parecer lista vazia. Exibir erro inline, nova tentativa e preservar consulta anterior. Não interpretar falha como inexistência de dados. |
| P1 | Histórico assina arquivos de até 500 entregas logo na entrada e carrega documentos em paralelo. | Muitas operações de arquivo antes de qualquer clique. Carregar metadados primeiro e renovar URL privada apenas na abertura do documento/assinatura. |
| P1 | Dashboard chamava todo registro recente de “Assinado”, mas sua resposta não traz assinatura; anunciava “Live Sync” sem inscrição realtime. | Sinais falsos de integridade/sincronização. Corrigido nesta rodada: histórico recente sem selo não comprovado, data/hora real da última consulta e atualização manual. |
| P1 | Período personalizado do dashboard enviava toda a faixa ao gráfico, mas a API limita buckets a 32 dias. | Períodos longos falhavam. Corrigido: gráfico limitado aos últimos 30 dias da faixa; totais usam a faixa completa e a interface explica a janela. |
| P2 | Filtro próprios/terceiros do dashboard muda apenas contagem de equipe na API, não entregas/PDFs/gráfico. | Ambiguidade da informação. Corrigido na apresentação: controle “Equipe ativa” e descrição explícita da abrangência dos demais indicadores. Expandir semântica na API somente em rodada funcional aprovada. |
| P2 | Colaboradores, entrega, histórico e movimentações usam muitos rótulos de 8–10 px, caixa alta, tracking largo e peso máximo. | Fadiga visual, truncamento e leitura ruim no celular. Adotar texto de 12–14 px nos rótulos, peso 500/600 e títulos em sentence case; o dashboard já segue essa direção. |
| P2 | Diversos botões PDF, Excel, assinatura, exclusão e navegação têm sombras e destaque visual equivalentes. | Ações destrutivas competem com a ação principal. Usar primário para continuar/concluir, secundário para exportar e menu contextual para ações raras; exclusão com confirmação inequívoca. |
| P2 | Tela de colaboradores concentra importação, cadastro, prontuário, assinaturas e biometria em um arquivo longo e múltiplas camadas/modal. | Responsabilidades difíceis de testar e overlays mais frágeis no teclado mobile. Extrair componentes de contexto e usar tela dedicada para câmera/captura quando o teclado ou permissões estiverem envolvidos. |
| P2 | O título da entrega usa `COMPANY_CONFIG.shortName`; cores antigas são mapeadas por seletores globais de classe. | Identidade de múltiplas empresas depende de efeitos e classes legadas. Preferir tokens `--brand-color`, fonte única de empresa ativa e restauração antes da primeira pintura. Dashboard usa os tokens diretamente. |
| P2 | Gráfico anterior animava por 2 segundos em cada atualização e status decorativo pulsava continuamente. | Informação demora a estabilizar e movimento não comunica operação real. Corrigido no dashboard: gráfico sem animação de dados; movimento restrito ao indicador de atualização/pressão de botão. |

## Dashboard implementado nesta rodada

- Nova entrega aparece imediatamente, inclusive enquanto métricas carregam ou falham.
- Hierarquia enxuta: título, ação, filtros, cinco métricas, atividade e últimas entregas.
- Carregamento com skeleton de cinco métricas; nenhum zero de produção é fabricado.
- Erro de atualização mantém valores anteriores e avisa que podem estar desatualizados.
- Dados tardios de uma requisição cancelada não substituem a consulta mais recente.
- Campos de período têm labels; escolhas da equipe têm `aria-pressed`; controles possuem foco visível e área mínima de 44 px.
- Grid mobile de duas métricas por linha, filtros empilhados e nomes sem truncamento obrigatório; gráfico e histórico viram coluna única.
- “PDFs arquivados” substitui “PDFs auditados”: quantidade de arquivos não comprova auditoria independente.
- Períodos incompletos/invertidos recebem orientação, sem consulta inválida ao servidor.

## Verificação e próximas rodadas

Na segunda etapa desta rodada, histórico e movimentações recuperaram os comportamentos já publicados que estavam ausentes no snapshot local: URLs privadas geradas apenas ao abrir, comprovante associado somente aos tipos entrega/entrega remota, suporte à evidência digital e falha de consulta recuperável. Os dois receberam cabeçalhos mais claros, rótulos legíveis e menor uso de caixa alta/peso máximo. A tabela desktop do histórico mantém conteúdo sem quebras com rolagem horizontal.

Movimentações agora expõe quando o histórico foi carregado parcialmente, permite buscar as páginas seguintes em lotes de 500 e não libera exportações completas enquanto faltam páginas. Renderiza inicialmente até 100 cards para reduzir custo de DOM, sem truncar os totais dos registros já carregados. O filtro exato de colaborador combinado ao período permite emitir os EPIs dele em um único relatório. Essa proteção torna explícita a limitação de paginação, mas não substitui a futura filtragem/exportação no servidor para grandes históricos.

O dashboard tem testes de acessibilidade automatizada, retenção de dados em erro, requisição cancelada, estados de carregamento e intervalos de data. Esses testes não certificam todo o produto para 1.000 colaboradores ou validam dispositivos iOS/Android reais.

Antes de declarar prontidão para grande operação: medir p50/p95 de login, troca de empresa, abertura da entrega e confirmação; medir com conjunto representativo em staging; revisar paginação/exportações e isolamento de cache; validar fluxos de teclado, leitores de tela e câmera em Safari iOS/Chrome Android reais; conferir PDFs multipágina, nomes extensos e ausência/falha de arquivos. Alterações de banco ficam fora desta rodada conforme solicitado.
