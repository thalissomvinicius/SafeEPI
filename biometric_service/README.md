# SafeEPI — serviço facial v2

Serviço privado FastAPI para cadastro e comparação 1:1 no servidor. Utiliza
YuNet + SFace CPU/OpenCV, sem InsightFace ou API facial comercial. Os modelos
oficiais são versionados e conferidos por SHA-256 em cada inicialização.

**Estado:** cadastro funcional; comparação com PAD possui um adaptador ONNX real,
mas fica `unavailable` até receber pesos revisados e uma calibração aprovada.
Nenhum modelo PAD validado, relatório empírico ou limiar de produção acompanha
este código. Não confundir um teste de contrato com comprovação antifraude.

## Contrato e responsabilidades

Todas as chamadas POST exigem `Authorization: Bearer <token>` server-to-server.
Não colocar esse token no navegador. CORS não autoriza origem de navegador.

- `POST /v2/enroll`: multipart `frame` (JPEG/PNG, até 2.000.000 bytes).
  Retorna `{embedding: number[128], model_id, model_sha256, quality}`. Exige um
  único rosto com qualidade aceitável. O Next deve criptografar o template e
  supervisionar o vínculo de identidade; não devolvê-lo ao navegador.
- `POST /v2/verify`: multipart `frame`, `reference_embedding` (JSON de 128 números
  normalizados), `reference_model_id=opencv-sface-2021dec`. Retorna `decision`
  (`approved`, `rejected`, `unavailable`), `reason`, `model_id`, `model_sha256`,
  `similarity`, `threshold`, `pad_score`, `pad_threshold`, `pad_model_id`,
  `calibration_id`, `quality`. Nunca retorna embedding. Campos não calculados são
  `null`. Só aprova se **ambos** limiares independentes forem satisfeitos.
- `GET /health`: processo vivo e disponibilidades distintas `enrollment_ready`
  e `verification_ready`, modelo e motivo seguro. HTTP 200 não significa PAD pronto.
- `/biometric/enroll`, `/biometric/session/start` e `/biometric/session/frame`:
  HTTP 410. O protocolo antigo não pode reaprovar templates 512d ou ignorar o v2.

O serviço é stateless e não armazena fotos/templates/sessões. A autenticação dos
usuários, tenant, cadastro supervisionado, prazo, vínculo com itens, consumo único
da aprovação e aceite explícito são responsabilidade das APIs Next/Postgres.
Este endpoint sozinho **não** protege contra replay ou câmera virtual.
PAD RGB de frame único também não autentica a origem do pixel: uma captura
genuína antiga, reencodada e injetada diretamente, pode parecer bona fide e ter
outro hash. Nonce/sessão impedem reutilizar a aprovação, não resolvem sozinhos
esse ataque de imagem. A homologação deve incluir reencode/injeção e não liberar
o remoto como antifraude validado se esse requisito não for atendido.
Templates antigos exigem recadastro: 512d InsightFace não equivale a 128d SFace.

## Executar e testar localmente (Python 3.12)

```powershell
cd biometric_service
python -m venv .venv
.venv/Scripts/python.exe -m pip install --upgrade pip==26.2.1
.venv/Scripts/python.exe -m pip install -r requirements-test.txt
.venv/Scripts/python.exe scripts/install_models.py
.venv/Scripts/python.exe -m unittest discover -s tests -v
.venv/Scripts/python.exe scripts/smoke_models.py
```

O instalador baixa somente dois modelos oficiais (~39 MB), nunca fotos/datasets,
e preserva as licenças. A inicialização não faz download de pesos. Arquivo
ausente/adulterado deixa o cadastro indisponível; não cria embedding fictício.
O smoke usa **somente pixels sintéticos**: carrega os modelos, verifica `no_face`
e executa o grafo SFace 128d. Não mede acurácia nem a eficácia do PAD.

Defina um segredo aleatório com ao menos 32 caracteres em
`SAFE_EPI_BIOMETRIC_SERVICE_TOKEN` no processo Python, então:

```powershell
.venv/Scripts/python.exe -m uvicorn app.main:app --port 8001 --limit-concurrency 32 --timeout-keep-alive 5 --no-access-log
```

No Next, configure `BIOMETRIC_SERVICE_URL` e `BIOMETRIC_SERVICE_TOKEN` (mesmo
segredo), somente no servidor. Localhost serve para desenvolvimento; no online
a URL deve apontar para o serviço hospedado, **não para seu computador pessoal**.

## Prova de vida: configuração que não burla a homologação

O adaptador suporta um export **revisado** MiniFASNetV2 `2.7_80x80`, ONNX float32,
entrada `[1,3,80,80]`, saída de logits `[1,3]`, classe real índice 1. A preparação
segue o código oficial: recorte 2.7, BGR, valores **0..255**, sem divisão por 255,
NCHW. Não usar outro modelo que apenas tenha dimensões iguais. Esta é uma versão
de modelo único, não a fusão de dois modelos da demonstração original.

Não foi encontrado um artefato ONNX oficial/homologado para baixar automaticamente.
Antes de instalar: verificar licença dos pesos, registrar commit/SHA original,
exportar em ambiente isolado, registrar ferramentas/versões e SHA final, comparar
numericamente PyTorch/ONNX, revisar dados/proveniência e medir o pipeline exato
YuNet/SFace/PAD com amostras consentidas e separadas para calibração/teste.
Nunca carregar pickle/PyTorch de fonte não confiável no serviço de produção.

O arquivo `calibration.example.json` é **propositalmente inválido**, sem limiares
prontos. Após validação, seu registro aprovado precisa incluir modelos/hashes,
limiares medidos, relatório e hash, revisão comercial, responsável e validade.
Testes de foto impressa, foto em tela e vídeo em tela são obrigatórios. O relatório
também deve documentar falsas aceitações/rejeições, dispositivos, iluminação,
câmera virtual/injeção e limites conhecidos; o arquivo não certifica o estudo.

Coloque a calibração, o ONNX revisado e o relatório numa pasta privada somente
leitura. Configure no serviço:

- `SAFE_EPI_BIOMETRIC_CALIBRATION_PATH`: caminho absoluto do JSON aprovado.
- `SAFE_EPI_BIOMETRIC_CALIBRATION_SHA256`: SHA-256 desse JSON, por implantação.

Reinicie o serviço. Hash inválido, relatório ausente, modelo incompatível,
calibração expirada ou falha do PAD bloqueiam a aprovação. Mudanças na resolução,
detector, pré-processamento, modelos ou domínio exigem nova avaliação. Não basta
editar `approved` para transformar um piloto em antifraude validado.

## Hospedagem e recursos

```sh
docker build -t safeepi-biometric .
docker run --read-only --tmpfs /tmp -p 127.0.0.1:8001:8001 --env-file /secure/biometric.env safeepi-biometric
```

O contêiner roda sem root, baixa artefatos fixados durante o build e não guarda
fotos. Exponha somente atrás de TLS e rede privada/proxy autenticado. Monte os
artefatos de calibração somente leitura se habilitar PAD. O token do serviço não
é a chave de criptografia dos templates; mantenha ambos separados.

Limites de corpo são aplicados antes de parse multipart; cabeçalhos de imagem são
inspecionados antes de decodificar. Máximo 8 MP/4096 px, redimensionamento para
960 px, concorrência de inferência 1 por processo por padrão, OpenCV protegido
por lock, CPU 2 threads. Capacidade excedida retorna 503/Retry-After, sem fila
ilimitada. Dimensione instâncias após medir memória/latência com dispositivos
reais. Desabilite captura de corpos nos logs/APM/reverse proxy.

Não é necessário deixar um PC pessoal ligado se o serviço estiver hospedado.
Software gratuito não cobre automaticamente servidor, memória, tráfego, TLS,
monitoramento e suporte. Deploy e domínio precisam estar ativos antes da integração
online; ainda não há confirmação de hospedagem neste repositório.

## Licenças e auditoria

Consulte `THIRD_PARTY_NOTICES.md` e `app/model_manifest.py`. A licença publicada
dos modelos não é garantia da cadeia completa de dados de treinamento.

```powershell
python -m pip_audit --path .venv/Lib/site-packages
```

Sem calibração/PAD, usar a alternativa manual explicitamente rotulada no SafeEPI.
O sistema não deve declarar no PDF uma identidade facial validada que não ocorreu.
