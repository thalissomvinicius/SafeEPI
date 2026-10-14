# Exportação offline do candidato PAD

Este procedimento produz um **candidato ONNX**, não uma aprovação para uso em produção. Não altera `.env`, não inventa limiares, não gera calibração e não usa fotos de colaboradores. O serviço continua recusando aprovação facial automática enquanto seus requisitos de homologação não estiverem satisfeitos.

## Origem e licença

O candidato é `MiniFASNetV2`, escala `2.7`, entrada `80×80`, do repositório oficial [Minivision Silent-Face-Anti-Spoofing](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/tree/b6d5f04ad78778917853b25c778acef6d5626d15), commit `b6d5f04ad78778917853b25c778acef6d5626d15`. O [README](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/b6d5f04ad78778917853b25c778acef6d5626d15/README_EN.md) descreve a abertura do modelo e alerta para dependência de câmera/cenário. Os pesos estão no próprio repositório, que contém [Apache-2.0 na raiz](https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/blob/b6d5f04ad78778917853b25c778acef6d5626d15/LICENSE). Não foi encontrada documentação detalhada de proveniência/licenciamento do conjunto de treinamento nem declaração separada específica dos pesos no material inspecionado. Registrar a revisão de direitos antes da oferta comercial; esta análise técnica não substitui essa revisão.

O exportador aceita somente os bytes previamente verificados:

| Artefato | SHA-256 |
|---|---|
| `src/model_lib/MiniFASNet.py` | `e498c4ec5e1ddfaba62b941a126c19d65aa564999f3309661fe43ee8bf38acd7` |
| `resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth` | `a5eb02e1843f19b5386b953cc4c9f011c3f985d0ee2bb9819eea9a142099bec0` |
| `LICENSE` | `daf94bf1dc9cc5700fe5af2c7c0cbd1836e70d509ed78fd0bebef7432edee6fb` |

Não usa o detector RetinaFace do projeto externo. A aplicação SafeEPI usa seu detector YuNet já fixado; a diferença de detector/recorte exige validação própria.

## Preparação e execução (Windows/PowerShell)

Use Python 3.12 e um ambiente virtual descartável, separado do serviço e sem segredos de produção. Os comandos de clone e instalação precisam de internet; o script de exportação em si não faz downloads nem acessa a rede. Escolha diretórios novos. Não execute scripts de instalação do projeto externo.

```powershell
git -c core.autocrlf=false clone https://github.com/minivision-ai/Silent-Face-Anti-Spoofing C:\pad-source
git -C C:\pad-source checkout --detach b6d5f04ad78778917853b25c778acef6d5626d15
py -3.12 -m venv C:\pad-export-env
C:\pad-export-env\Scripts\python.exe -m pip install -r biometric_service\requirements-export.txt
C:\pad-export-env\Scripts\python.exe biometric_service\scripts\export_pad.py --source-dir C:\pad-source --output-dir C:\pad-candidate
```

Executar a partir da raiz do SafeEPI. `core.autocrlf=false` preserva bytes/hash no Windows. Se Git LFS entregar apenas um ponteiro, ou o arquivo tiver sido modificado, a exportação será recusada. Não remova as verificações nem aceite um hash diferente para contornar a falha.

Opcionalmente, acrescente `--license-review C:\documentacao\revisao-pad.md` para registrar o hash de uma revisão existente. O script não interpreta esse documento como aprovação. Sua ausência fica explicitamente registrada como pendência; sua presença, como documento fornecido mas não validado automaticamente.

## O que é verificado

O script valida os três hashes antes de executar o código externo ou carregar os pesos, usa apenas `torch.load(weights_only=True)` em CPU e não tenta novamente com pickle irrestrito. O código executado é o buffer que teve o hash validado, não um caminho mutável importado do checkout.

A rede usa kernel final `5×5`, modo de avaliação e pesos estritamente compatíveis. A saída ONNX mantém **logits brutos** de três classes; o adaptador do serviço aplica softmax e lê a classe viva de índice `1`. Entrada fixa: `float32[1,3,80,80]`, canais BGR, valores `0..255`, sem dividir por 255. O recorte ampliado 2.7 pertence ao adaptador da aplicação e não ao grafo exportado.

Após a checagem estrutural ONNX, compara PyTorch e ONNX Runtime em seis entradas sintéticas (preto, branco, gradiente e três ruídos determinísticos), com `rtol=1e-4`/`atol=1e-5`. Forma incorreta, NaN ou divergência interrompe a operação. A saída somente é publicada após todos os testes; destino existente nunca é sobrescrito.

O diretório gerado contém o ONNX, cópia da licença e `export-manifest.json`: hashes de entrada/saída, versões, contrato de pré-processamento e diferenças numéricas. O manifesto permanece `candidate_not_calibrated` e `production_approved: false`.

## O que falta para ativar

Conversão numérica **não mede** falsos aceites, falsos rejeitos, resistência a fotos/telas/máscaras nem ataques de injeção. Também não demonstra equivalência do detector/recorte ao pipeline original. Não usar um limiar encontrado no README como homologação da aplicação.

Antes de configurar o serviço: resolver a revisão de direitos, avaliar o artefato exato com participantes autorizados e câmeras/cenários representativos, medir os ataques e erros definidos na política e produzir o relatório/manifesto de calibração exigido em `biometric_service/calibration.example.json`. O hash desse ONNX deve ser o mesmo avaliado e configurado. Não confundir `export-manifest.json` com o relatório de validação: são artefatos de finalidades diferentes.

O candidato pode ser usado em ambiente isolado para essa avaliação. Não ative a aprovação de entregas somente porque os testes sintéticos passaram; preserve a assinatura manual e o registro fotográfico explicitamente rotulado durante a homologação.

## Verificação executada nesta implementação

Em 13/10/2026, a exportação foi executada duas vezes em ambiente temporário separado, Windows/Python 3.12.14, PyTorch `2.14.1+cpu`, ONNX `1.23.2`, ONNX Runtime `1.24.2` e NumPy `2.4.6`. Ambas produziram SHA-256 `e9ef6c4b40838558cdd8375297128e9d7a55ee1eaa8536fcba2b5a030813ce84`. As seis comparações passaram; maior diferença absoluta de logits: `3.814697265625e-06`. Isso demonstra repetibilidade nesse ambiente, não identidade de bytes em todas as plataformas.

Os 15 testes de controle do exportador passaram, incluindo rejeição de arquivo/hash/versão alterados, bloqueio de pickle irrestrito, saída existente e resultados numéricos inválidos. O ONNX foi mantido apenas como candidato; nenhuma configuração de produção ou calibração foi ativada. A licença/revisão comercial e a validação antifraude real permanecem pendentes.
