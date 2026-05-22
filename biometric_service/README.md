# SafeEPI Biometric Service

Servico FastAPI para verificacao de identidade facial server-side.

## Objetivo

- Remover IA facial pesada do navegador.
- Processar deteccao, qualidade, anti-spoof, embeddings e decisao no backend.
- Manter o frontend apenas como camera leve.
- Retornar decisoes explicaveis: `approved`, `retry`, `fallback`.

## Rodando localmente

```bash
cd biometric_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

No Next.js:

```env
BIOMETRIC_SERVICE_URL=http://localhost:8001
BIOMETRIC_SERVICE_TOKEN=dev-safeepi-biometric-token
```

## Producao

Use container separado para o FastAPI. O servico deve ficar privado, acessivel apenas
pelas API routes do Next.js ou rede interna.

```bash
docker build -t safeepi-biometric .
docker run -p 8001:8001 \
  -e SAFE_EPI_BIOMETRIC_SERVICE_TOKEN=troque-este-token \
  safeepi-biometric
```

No Vercel/Next.js, configure:

```env
BIOMETRIC_SERVICE_URL=https://url-privada-do-servico
BIOMETRIC_SERVICE_TOKEN=troque-este-token
```

> Atencao: valide licenciamento comercial dos modelos InsightFace/anti-spoof antes
> de operar em producao.
