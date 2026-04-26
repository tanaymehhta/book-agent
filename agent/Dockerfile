FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY agent /app/agent
COPY db /app/db

RUN pip install --no-cache-dir -e /app/agent

COPY agent/scripts/start_api.sh /app/start_api.sh
COPY agent/scripts/start_worker.sh /app/start_worker.sh
COPY agent/scripts/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/start_api.sh /app/start_worker.sh /app/entrypoint.sh

ENV PYTHONUNBUFFERED=1
ENV ROLE=api

CMD ["/app/entrypoint.sh"]
