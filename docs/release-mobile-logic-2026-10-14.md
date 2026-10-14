# Correções operacionais e mobile — 14/10/2026

## Escopo e compatibilidade

Esta versão altera a aplicação e seus testes. Não inclui SQL, migração, novos campos, alterações de RLS, credenciais ou atualização de dados de produção. As RPCs existentes continuam sendo utilizadas. O acesso MASTER legado foi preservado. O reconhecimento facial v2 permanece sujeito à configuração existente; foto anexada não é apresentada como reconhecimento facial.

## Entregas, baixas e evidências

- Cada item do pedido recebe uma chave estável. A intenção e o progresso da entrega são guardados na aba, por usuário e empresa, antes da primeira gravação. Retomar não cria outra chave para um item já enviado.
- Gravações parciais mantêm os itens confirmados. Baixas com resultado incerto exigem conferência; não são repetidas silenciosamente. Isso não transforma o carrinho em uma transação atômica.
- Uma falha de resposta após uma RPC não apaga a assinatura enviada, pois a operação pode ter sido confirmada no banco. Isso pode deixar arquivos órfãos após falhas reais; uma política futura de reconciliação deverá distingui-los de evidências válidas.
- Repetir a vinculação de uma digital não estorna uma entrega válida. Evidências expiradas não autorizam novos itens do lote.
- Baixa por desgaste, dano ou perda não retorna ao estoque disponível. Reutilização exige motivo elegível e confirmação explícita do operador.
- Reposição preserva quantidade, vínculo de terceiro e método de assinatura. Falhas posteriores de PDF/arquivo não provocam nova baixa ou nova reposição na mesma tela.
- Links conferem empresa, colaborador, equipamentos e o conteúdo autorizado. Expiração também é aplicada à consulta de links concluídos. O CPF é conferência cadastral, não uma autenticação secreta.

## Layout e uso mobile

- Captura de assinatura compartilhada em entrega, baixa, prontuário e treinamento, com tela inteira e preservação do desenho/assinatura digitada ao redimensionar.
- Modais acompanham a área visível quando o teclado abre, mantêm rolagem interna, respeitam áreas seguras e devolvem o foco. Apenas o modal superior recebe Escape/Tab.
- Campos mobile com texto de 16px, controles maiores, ações secundárias agrupadas e primeira tela de colaboradores mais compacta.
- Erros de carregamento mantêm distinção entre indisponibilidade e listas vazias, com tentativa explícita de recarregar.

## Histórico, relatórios e documentos

- Histórico individual paginado, com ordem estável e escopo de empresa; consultas operacionais evitam assinar URLs privadas que não serão abertas.
- Estoque com histórico paginado, inclusive movimentações de EPIs inativos; ajuste de saldo zero permitido e limiar de alerta unificado em cinco unidades.
- Períodos inválidos não liberam exportação. Consulta por período acontece no servidor.
- Entregas e devoluções concluídas aparecem por suas próprias datas. A quantidade da devolução concluída é acumulada: o esquema atual não permite inventar datas das parcelas anteriores.
- PDFs e planilhas preservam essa distinção. O termo aprovado do prontuário não foi alterado. Carregamento de imagens tem concorrência limitada e não ignora evidência obrigatória ausente.

## Verificações

- 62 arquivos de teste, 389 testes aprovados na rodada integrada.
- TypeScript, ESLint e build de produção aprovados.
- `npm audit --omit=dev`: zero vulnerabilidades. `npm audit` completo: nove alertas altos preexistentes na cadeia de ferramentas de desenvolvimento. Não aplicado `--force`, que propõe mudanças incompatíveis.
- Inspeção de 12 telas em larguras 360/390 e desktop 1440 no Chromium; 12 telas em 360/390 no WebKit. Dados sintéticos e gravações externas bloqueadas. Sem overflow horizontal da página nas amostras.
- Assinaturas digitadas/desenhadas preservadas em tela inteira, rotação e viewport reduzido nos dois motores. Toque nativo simples também verificado. Os traços automatizados respeitam quadros de renderização; não equivalem a um arraste de dedo em aparelho físico.
- Seis PDFs sintéticos, 17 páginas: texto dentro da página e das margens horizontais de 14mm; assinaturas/fotos visíveis, quantidades e itens conferidos.
- A cobertura percentual configurada mede utilitários selecionados; não representa cobertura de toda a aplicação.

## Limites que permanecem

Não é uma certificação para mil usuários simultâneos nem um teste de carga. A validação em navegador não substitui testes em iPhone/Android físicos, câmera real, permissões e redes móveis.

Sem alteração de SQL, continuam pendentes a atomicidade de lotes completos, identificação persistente de cada baixa parcial e o fechamento das permissões diretas de gravação no banco. O reforço da API não substitui essas garantias. A retomada de baixas/reposições desta versão é mantida enquanto a tela fica aberta; não se deve fechar ou trocar de tela com conclusão pendente.

O journal de entrega é por aba, não entre dispositivos. Não contém CPF, nome, foto, assinatura ou tokens. Biometria e assinaturas nunca devem ser simuladas nos dados de produção para testes.

Melhorias visuais futuras de PDF: manter título e imagens do comprovante juntos quando a entrega for muito longa; reduzir a página exclusiva de assinatura do responsável em prontuários curtos.
