# Lookout Farm Booking Assistant

AI-powered band booking assistant for Lookout Farm Taproom. Three parts:

- `agent/` — Python agent (Claude Agent SDK) that polls Gmail, classifies inquiries, auto-sends only the first acknowledgment, drafts everything else into Gmail Drafts for one-click approval.
- `db/` — Postgres schema + Alembic migrations.
- `dashboard/` — Next.js app with Kanban (Incoming / In Conversation / Approved / Archive) and Roster.

The email backend is a swappable adapter. V1 is Gmail; V2 will be Microsoft Graph once IT approves. Agent code only talks to `EmailProvider`.

## Quick start (local dev)

Prereqs: Docker, Python 3.11+, Node 20+.

```bash
# 1) Bring up Postgres
make db.up

# 2) Install agent + run initial migration
make agent.install
make db.migrate

# 3) One-time Gmail OAuth (opens a browser)
#    Put your OAuth client JSON at agent/secrets/gmail_client.json first
make oauth

# 4) Copy env files and fill in ANTHROPIC_API_KEY
cp .env.example .env
cp agent/.env.example agent/.env

# 5) Run the agent (polls every 2 min)
make agent.dev
```

## Getting a Gmail OAuth client

1. Go to console.cloud.google.com → new project → enable **Gmail API**.
2. OAuth consent screen → External → add yourself as a test user.
3. Credentials → Create OAuth client ID → **Desktop app**.
4. Download JSON, save as `agent/secrets/gmail_client.json`.
5. Run `make oauth` — browser opens, you consent, a `token.json` is saved.
