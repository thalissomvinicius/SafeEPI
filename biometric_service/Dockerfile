FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip==26.2.1 \
  && pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY THIRD_PARTY_NOTICES.md ./
COPY licenses ./licenses
# Explicit build-time fetch of immutable public artifacts; never request-time.
RUN python scripts/install_models.py \
  && useradd --uid 10001 --create-home safeepi \
  && chown -R safeepi:safeepi /app

USER safeepi

EXPOSE 8001

CMD ["/bin/sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8001} --limit-concurrency ${SAFE_EPI_BIOMETRIC_LIMIT_CONCURRENCY:-8} --timeout-keep-alive 5 --no-access-log"]
