#!/usr/bin/env bash
set -euo pipefail

cd /app/db
alembic upgrade head

cd /app
exec uvicorn lookout_agent.api:app --host 0.0.0.0 --port "${PORT:-8000}"
