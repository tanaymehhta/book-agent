#!/usr/bin/env bash
set -euo pipefail

ROLE="${ROLE:-api}"

case "$ROLE" in
  api)
    exec /app/start_api.sh
    ;;
  worker)
    exec /app/start_worker.sh
    ;;
  *)
    echo "Unknown ROLE='$ROLE'. Expected 'api' or 'worker'." >&2
    exit 1
    ;;
esac
