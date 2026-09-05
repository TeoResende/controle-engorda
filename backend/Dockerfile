FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Uma imagem por perfil: a API não carrega as bibliotecas de transcrição, que
# pesam ~350 MB e só o worker executa.
ARG PERFIL=api

COPY requirements.txt requirements-worker.txt requirements-dev.txt ./
RUN if [ "$PERFIL" = "dev" ]; then pip install --no-cache-dir -r requirements-dev.txt; \
    elif [ "$PERFIL" = "worker" ]; then pip install --no-cache-dir -r requirements-worker.txt; \
    else pip install --no-cache-dir -r requirements.txt; fi

COPY . .
RUN chmod +x entrada.sh

# O entrypoint aplica as migrations antes de iniciar o processo — ver entrada.sh.
ENTRYPOINT ["./entrada.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
