# Build the shared API/migration/ingestion image; Compose selects the process command for each role.
# CPU PyTorch is installed explicitly; model weights are downloaded into a separate runtime cache volume.
# Compile/install dependencies in an isolated venv; compiler tooling is not copied into the final image.
FROM python:3.11-slim AS build
ENV PIP_NO_CACHE_DIR=1 PATH=/opt/venv/bin:$PATH
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential && rm -rf /var/lib/apt/lists/*
RUN python -m venv /opt/venv && pip install --upgrade pip==26.2.1
# Select the CPU wheel index deliberately so the local embedding stack does not pull GPU runtimes.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.14.0+cpu
# Production requirements exclude pytest/lint tools and are cached independently of application source.
COPY requirements.txt .
RUN pip install -r requirements.txt

# Runtime stage receives the venv plus application/migration/CLI sources, without host .env or persisted data.
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HOME=/home/appuser/.cache/huggingface PATH=/opt/venv/bin:$PATH
WORKDIR /app
COPY --from=build /opt/venv /opt/venv
COPY app ./app
COPY scripts ./scripts
COPY alembic ./alembic
COPY alembic.ini .
# Create writable mount targets before switching to the non-root service identity.
RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /home/appuser/.cache/huggingface /app/data/widget-assets \
    && chown -R appuser:appuser /app /home/appuser
USER appuser
# EXPOSE is image metadata; only Traefik publishes a host port through Compose.
EXPOSE 8000
# Proxy header trust is restricted separately by Compose's FORWARDED_ALLOW_IPS setting.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
