# Validação do módulo facial antes da produção

Este documento é um roteiro de homologação, não um laudo de acurácia, uma certificação de prova de vida ou uma declaração de conformidade jurídica. Testes automatizados de contratos, autorização e PDFs não substituem os ensaios abaixo.

## Critérios e registro dos resultados

- Definir antes do ensaio os limites aceitos de falsa aceitação (FAR), falsa rejeição (FRR), ataques aceitos (APCER), pessoas reais rejeitadas pelo PAD (BPCER), latência p50/p95 e taxa de falhas. Não usar o mesmo conjunto para calibrar e aprovar.
- Registrar modelos, hashes dos pesos, versão do código, limiares, calibração, equipamentos, iluminação e tamanhos de amostra. Apresentar numeradores, denominadores e incerteza; nenhuma aceitação indevida em amostra pequena demonstra risco zero.
- Avaliar participantes com diferentes características e condições de uso, inclusive óculos e EPIs que não impeçam a captura, mediante procedimentos apropriados de proteção de dados. Não inferir atributos sensíveis dos rostos.
- Não habilitar confirmação facial automática enquanto a licença comercial dos artefatos ou a evidência de desempenho estiver pendente. Não permitir que configuração de ambiente seja confundida com aprovação técnica.

## Cadastro supervisionado

- Conferir a identidade por procedimento autorizado antes de vincular o rosto ao funcionário e à empresa.
- Testar ausência de rosto, duas pessoas, desfoque, pouca luz, rosto cortado, foto girada, tamanho inválido e arquivo disfarçado de imagem.
- Confirmar que o servidor extrai o descritor da imagem; não aceitar vetor arbitrário enviado pelo cliente.
- Confirmar isolamento entre empresas, RBAC, matrícula/identificador estável, operador responsável, data do servidor e auditoria da recaptura.
- Revogar os templates antigos no recadastro; modelos diferentes exigem novo cadastro ou migração explicitamente validada, nunca comparação silenciosa.

## Identidade e prova de vida (PAD)

- Executar comparações genuínas e de impostores, separadas do conjunto de calibração.
- Ensaiar foto impressa fosca/brilhante, foto em celular e monitor, vídeo pré-gravado, recorte de rosto, captura reutilizada e, conforme o risco, câmera virtual/injeção.
- Avaliar cada câmera e condição de iluminação operacional; piscar ou virar a cabeça isoladamente não comprova resistência a fraude.
- Bloquear ou oferecer outra modalidade explícita quando PAD/modelos/calibração estiverem indisponíveis. Jamais trocar silenciosamente uma reprovação por "facial aprovada".

## Integridade da entrega

- Vincular a sessão à empresa, funcionário, operador ou link autorizado, itens, quantidades, CA e contexto da entrega.
- Alterar um desses dados após aprovação deve invalidar o aceite ou exigir nova sessão.
- Exigir confirmação expressa do recebimento após o resultado facial, com data do servidor.
- Testar sessão expirada, já consumida, requisição repetida, sessão de outro colaborador/empresa, parâmetros adulterados e chamadas diretas sem passar pela tela.
- Testar duas confirmações simultâneas, perda da resposta após commit, queda antes do commit e repetição idempotente. Entrega e estoque não podem duplicar.
- Limitar tentativas de verificação por sessão/ator sem que cada frame esgote a cota de toda a empresa.

## Dispositivos e captura

Registrar modelo, versão do sistema, navegador e resultado de cada execução real:

| Ambiente | Casos mínimos |
| --- | --- |
| Windows + Chrome/Edge + webcam | Abrir/fechar câmera; câmera ausente/ocupada; negar e conceder permissão; selecionar dispositivo; captura longa; duplo clique |
| iPhone + Safari | Modo retrato e paisagem; safe areas; câmera frontal/traseira; fundo/retorno ao app; permissão negada; bloqueio de tela; viewport com teclado |
| Android + Chrome | Aparelho intermediário; frontal/traseira; mudança de orientação; retomada; baixa memória; permissão negada |
| Rede móvel | Alta latência, perda de conexão e reconexão; timeout com mensagem; impedir envio duplicado e liberação indevida |

O rosto exibido e a imagem enviada devem corresponder: validar recorte, espelhamento, rotação, `object-fit` e coordenadas do enquadramento. Testar encerramento das trilhas da câmera ao sair da tela.

## Recibos e histórico

- `authMethod: facial` legado ou presença de foto não comprovam biometria. Exibir essa limitação nos PDFs reemitidos sem evidência válida.
- A propriedade `biometricReceipt` do gerador é um DTO obtido da resposta do servidor após confirmação. O gerador verifica apenas completude de apresentação; não substitui a validação da sessão no backend.
- Renderizar sessão, aceite com horário do servidor, modelo, calibração, hash de contexto e demais evidências disponíveis. Nunca criar metadados de verificação no navegador.
- A assinatura manual com foto de apoio deve ser nomeada dessa maneira, sem alegação de validação por IA.
- O código/QR de referência localiza o registro. Não é uma assinatura criptográfica, um certificado ICP-Brasil nem o SHA-256 do PDF final.
- Calcular o hash de integridade a partir dos bytes efetivamente arquivados. Conferir que histórico, itens, assinatura/foto e recibo arquivado correspondem à mesma transação.
- Conferir visualmente uma entrega curta, dezenas de itens, nomes/cargos/unidades extensos, hashes sem espaços, imagens ausentes e documento multipágina: nenhuma sobreposição com cabeçalho ou rodapé.

## Operação e proteção de dados

- Aprovar finalidade, necessidade, base legal, retenção, eliminação e alternativa não biométrica com os responsáveis apropriados. Não assumir que consentimento do empregado resolve essas decisões.
- Verificar TLS, serviço de inferência privado, segredos fora do cliente, rotação de chaves, templates criptografados, acesso mínimo e logs sem imagens/templates/tokens.
- Testar retenção, revogação, exclusão e recuperação autorizada de falhas; documentar backup e responsabilidades.
- Medir consumo e custo de infraestrutura e pico simultâneo. Licença gratuita do software não elimina custo de operação.
- Fazer piloto supervisionado por empresa, com alternativa manual e rollback. Só ampliar após registrar e aprovar os resultados.

## Estado da evidência

Os testes do repositório verificam contratos e comportamentos específicos. Ainda é necessário anexar os resultados reais de dispositivos, comparação facial, ataques PAD e carga antes de declarar o recurso aprovado para produção.
