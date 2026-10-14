# Facial SafeEPI — decisão e plano

## Escopo aprovado

Em 13/10/2026 o usuário aprovou evoluir o módulo existente: captura PC/mobile,
cadastro supervisionado, comparação 1:1 no servidor, software com licença
comercial permissiva, aceite explícito dos EPIs e alternativa manual.
Não haverá API facial comercial, treinamento de modelo do zero ou aprovação
biométrica fictícia na ausência de PAD validado.

## Decisões

| Decisão | Alternativa rejeitada | Motivo |
|---|---|---|
| Preservar Next.js, Supabase e serviço Python | Reescrever o produto | Reusar autenticação, cadastro e estoque |
| YuNet/SFace com artefatos oficiais fixados | InsightFace/buffalo_l público | Restrição comercial dos pesos atuais |
| Inferência e template no servidor | Aceitar descritor do navegador | Evitar cadastro adulterável |
| Sessão vinculada a ator, empresa, colaborador e itens | Flag `facial` do cliente | Provar qual recebimento foi verificado |
| Prova consumida junto à entrega numa transação | Consumir antes de baixar estoque | Evitar estado parcial e replay |
| Cadastro remoto pendente de supervisão | Link como prova de identidade | Não identifica quem cadastrou o próprio rosto |
| PAD e limiar calibrados como requisito de ativação | Piscar/mover cabeça como prova suficiente | Não confundir qualidade/semelhança com presença |
| Captura isolada da rolagem do formulário | Modal de câmera dentro do cadastro | Corrigir altura, foco e câmera no mobile |

## Suposições e limites

- Aproximadamente 1.000 cadastros, não 1.000 capturas simultâneas; carga a medir.
- Infraestrutura, hospedagem e testes com pessoas/dispositivos reais não são
  gratuitos por consequência das licenças de software.
- Migrações locais não comprovam schema aplicado no ambiente online.
- Na ausência de configuração, modelo, PAD ou referência compatível: bloquear
  apenas a modalidade facial e manter assinatura manual explicitamente rotulada.
- A validação humana do cadastro não substitui PAD na entrega remota.
- Templates de modelos diferentes exigem recadastro, nunca conversão silenciosa.
- Não enviar fotos/biometria de produção a terceiros durante testes.

## Revisão e resoluções

O revisor cético exigiu proteção também nas rotas legadas/RPC, consumo atômico,
cadastro server-side, indisponibilidade honesta sem PAD e serviço stateless.
Todos aceitos. O revisor de restrições exigiu retenção limitada de cadastros
pendentes, alternativa manual e não declarar produção validada sem runtime e
ensaio real; todos aceitos.

O revisor de experiência exigiu estado pendente explícito no cadastro remoto,
nenhum sucesso antes da resposta definitiva, preservação de dados após erro e
repetição idempotente. Aceitos. O árbitro aprovou a implementação local, mantendo
os critérios de ativação online como bloqueios obrigatórios, não como promessas.

## Execução

1. Revisar contratos e escrever testes negativos antes da implementação.
2. Substituir motor facial e documentar instalação/verificação dos modelos.
3. Implementar sessão, cadastro protegido e transações no backend/banco.
4. Integrar captura isolada e confirmação explícita nas telas existentes.
5. Corrigir comprovantes e modalidades; preservar fluxo manual.
6. Testar unidades, rotas, tipos, build e mobile simulado; entregar roteiro para
   homologação real, migração e publicação no ambiente autorizado.

## Critérios para ativação online

Licenças e hashes registrados; serviço acessível com autenticação; modelos e
chaves configurados; migração validada; PAD e limiar calibrados; testes reais de
foto impressa/tela/vídeo e identidade; testes de replay, tenant, concorrência,
estoque, repetição e comprovante. Sem isso, implementação não é certificação
nem autorização para vender antifraude como validado.
