SHELL := /bin/bash

.PHONY: db.up db.down db.migrate db.reset db.psql agent.install agent.dev agent.api oauth

db.up:
	docker compose up -d db
	@echo "waiting for postgres to be ready..."
	@until docker exec lookout_db pg_isready -U lookout >/dev/null 2>&1; do sleep 1; done
	@echo "postgres up on localhost:5434"

db.down:
	docker compose down

db.reset:
	docker compose down -v
	$(MAKE) db.up
	$(MAKE) db.migrate

db.psql:
	docker exec -it lookout_db psql -U lookout -d lookout

db.migrate:
	cd db && DATABASE_URL=$${DATABASE_URL:-postgresql+psycopg://lookout:lookout@localhost:5434/lookout} alembic upgrade head

agent.install:
	cd agent && pip install -e '.[dev]'

agent.dev:
	cd agent && python -m lookout_agent.main

agent.api:
	cd agent && uvicorn lookout_agent.api:app --host 0.0.0.0 --port $${AGENT_API_PORT:-8000} --reload

oauth:
	cd agent && python scripts/gmail_oauth.py
