#!/usr/bin/env bash
set -euo pipefail

cd /app/db
alembic upgrade head

cd /app
exec python -m lookout_agent.main
