# Assinaturas e evidências — auditoria de código, 14/10/2026

Escopo: código local. Não foi inspecionado o conteúdo de registros individuais,
nem comprovada a aplicação dos scripts SQL no Supabase de produção. Nenhuma
migração ou alteração de banco foi executada. Esta análise técnica não substitui
parecer de advogado trabalhista nem garante resultado judicial.

## Modalidades ativas

- Assinatura na tela, desenhada ou nome digitado aplicado visualmente.
- Foto de apoio mais assinatura manual obrigatória; não é reconhecimento facial.
- Link remoto é canal para esses métodos, não identificação biométrica.
- Treinamentos já oferecem linhas em branco para coleta no papel.
- Prontuário agora oferece via expressamente identificada para coleta no papel:
  sem imagens de assinaturas, sem arquivamento como documento eletronicamente
  assinado e sem alteração das entregas existentes. O original assinado precisa
  ser guardado; imprimir não confirma assinatura no banco.

Digital USB e reconhecimento facial retirados dos fluxos ativos. Cadastro facial
e novos pareamentos/comandos de leitura bloqueados. Registros, consultas,
comprovantes anteriores e exclusão autorizada de dados antigos preservados.

## Evidências existentes no código

- Empresa e colaborador; identificação cadastral e vínculo por IDs.
- Entrega: EPI, CA cadastral, quantidade, motivo, unidade e data de entrega.
- Operador autenticado e chave idempotente, vinculados à criação pelo backend.
- Assinatura como imagem em armazenamento privado; foto de apoio no arquivo.
- Localização e indicação da fonte/precisão em metadados dos comprovantes.
- Arquivo PDF associado às entregas, SHA-256 recalculado dos bytes no servidor.
- Navegador via cabeçalho user-agent e data de criação do arquivo.
- Link vinculado à empresa/colaborador, expiração, estado e conclusão.
- Código de referência no PDF: localizador, não certificado digital.
- IP de criação/arquivo agora obtido no backend, sem aceitar o valor do formulário.

## Lacunas que impedem afirmar 'todos os registros necessários'

1. Imagem desenhada ou nome digitado não prova sozinha quem assinou. A foto é
   apoio, sem comparação de identidade. CPF em link é conferência, não segredo.
   Registrar conferência presencial, identidade do operador e procedimento é
   importante. Não há OTP ou certificado do empregado neste fluxo.
2. Não há distinção persistida e obrigatória entre desenho e nome digitado.
3. Não há comprovante obrigatório e versionado do texto do termo apresentado,
   seu hash e aceite vinculado no servidor para todos os métodos manuais.
4. Data de entrega é editável; created_at do arquivo é emissão, não prova universal
   do instante do aceite do empregado. Falta evento uniforme de aceite no servidor.
5. Geração da entrega e arquivamento do PDF são etapas separadas. Falha de arquivo
   não desfaz entrega. Verificar histórico de pendências e recuperar arquivos.
6. SHA-256 detecta alterações ao comparar contra referência confiável; não
   identifica signatário nem equivale a assinatura ICP-Brasil/carimbo do tempo.
7. Scripts contêm proteção de integridade e estorno lógico; sua execução real,
   permissões administrativas, backups, retenção e restauração não foram homologados
   nesta rodada. Não há comprovação de arquivo WORM ou trilha externa imutável.
8. Localização é evidência contextual: pode ser aproximada/rede e não prova identidade.
9. Foto ou treinamento não comprova por si orientação, adequação ao risco, uso e
   fiscalização. Reunir documentos de SST associados ao fornecimento.
10. O termo informado pela empresa contém frase incompleta ('não uso dos EPI por
    parte da empresa') e referência antiga ao item 6.7.1. Mantido sem reescrita:
    solicitar revisão jurídica do texto e de eventual desconto/responsabilização.
11. Foto antiga sem assinatura não deve ser apresentada como aceite manual.

## Referências oficiais

- NR-6: 6.5.1(d) admite livros, fichas ou sistema eletrônico, inclusive biométrico;
  6.5.1.1 exige extração de relatórios. Biometria não é obrigatória.
  https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/participacao-social/conselhos-e-orgaos-colegiados/comissao-tripartite-partitaria-permanente/normas-regulamentadora/normas-regulamentadoras-vigentes/NR06atualizada2023.pdf
- MP 2.200-2/2001, art. 10, §2: outros meios de autoria/integridade podem ser
  admitidos/aceitos; isso não elimina contestação ou garante resultado em processo.
  https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm

## Próxima etapa proposta, não executada

Revisar termo com assessoria jurídica, definir evento uniforme de aceite e
versionamento, marcar origem desenhada/digitada/papel, recuperar PDFs pendentes,
homologar retenção/trilha/backup e implementar verificação de identidade adequada.
Mudanças de schema dependerão de autorização específica.

## Correções posteriores sem migração

- Entregas presenciais e por link exigem aceite explícito no componente de
  assinatura; alterar o contexto dos itens invalida o aceite anterior.
- Origem declarada é desenhada, digitada ou mista. O PDF de entrega mostra essa
  origem; não é comprovação automática de autoria. Registros antigos permanecem
  sem origem conhecida, sem preenchimento retroativo inventado.
- Arquivamento normaliza a declaração e reconstrói o texto/versão/hash do aceite
  no servidor, em signed_documents.metadata. Dados de origem continuam declarados
  pelo navegador. Metadata não é certificado e não possui força imutável externa.
- O servidor registra server_received_at do arquivo, IDs vinculados e SHA-256
  em archivalReceipt. Event explicitamente 'pdf_archival_not_delivery_acceptance':
  não confundir horário do upload com instante do recebimento dos EPIs.
- Responsável do prontuário tem origem declarada separada da assinatura de entrega.
- Telas de entrega e prontuário oferecem recuperação em memória do mesmo PDF
  quando arquivamento falha; não repetem a entrega nem alteram estoque.
- Resposta perdida de insert pode ser recuperada pelo mesmo hash/empresa e
  vínculos, preservando o recibo anterior. Nunca troca metadados do arquivo antigo.
- Histórico sinaliza assinatura salva sem PDF arquivado. Recuperação em memória
  termina ao recarregar/sair; não é fila durável de pendências.

O texto de aceite eletrônico introduzido é declaração de conferência/recebimento,
não substitui o termo de responsabilidade da empresa. A revisão jurídica deste
último continua pendente. Backups/retenção/validação de identidade, registro
transacional do aceite e fila durável exigem etapa própria; não foram declarados
concluídos nem executados via SQL nesta correção.
