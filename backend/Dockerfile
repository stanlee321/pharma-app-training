# TivaTrainer backend image. Build context = the REPO ROOT (the renderer needs the form clones +
# schemas from notebooks/forms/), filtered by the root .dockerignore:
#   docker compose build backend
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# Layout mirrors the repo so app/core/config.py resolves <root>/notebooks/forms/{out,schema}.
WORKDIR /srv/backend

COPY backend/requirements.txt .
RUN pip install -r requirements.txt

COPY backend/ .
# Only the blank form templates + field schemas the fill-pdf renderer reads (no source scans).
COPY notebooks/forms/schema/ /srv/notebooks/forms/schema/
COPY notebooks/forms/out/nota2_clone.pdf notebooks/forms/out/nota21_clone.pdf notebooks/forms/out/imss_recreated.pdf /srv/notebooks/forms/out/

RUN useradd --system --uid 10001 tiva \
    && mkdir -p /data/documents \
    && chown -R tiva /data
USER tiva

EXPOSE 8000
# Migrate, then serve. --proxy-headers: runs behind the web container's nginx.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]
