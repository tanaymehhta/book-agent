# Lookout Farm Booking Assistant

AI-powered band booking assistant for Lookout Farm Taproom. The system reads booking emails out of a Gmail inbox, classifies them, drafts replies in Laura's voice, and presents the whole pipeline as a Kanban board for one-click approval. Once a band is approved it lives on the Roster with a profile page Laura can edit.

This README is the source of truth for **what's built**, **how it's deployed**, and **how you work on it** — both for humans and for agents picking the project back up.

---

## Three pieces

- **`agent/`** — Python service. Two run modes from one Docker image:
  - **API** (FastAPI) — endpoints for the dashboard (`/bands/:id/thread`, `/bands/:id/profile`, `/bands/:id/drafts`, `/drafts/:id/send`, `/mailbox`, `/health`, etc.). Lazy-loads the email provider only when needed.
  - **Worker** — APScheduler poll loop (every 120s by default) that pulls new messages, classifies them, and either auto-replies once or saves a Gmail draft for Laura. Same image; `ROLE=worker` env var routes to `scripts/start_worker.sh` via `scripts/entrypoint.sh`.
- **`db/`** — Postgres schema + Alembic migrations (`db/alembic/versions/`). Migrations run automatically on every agent container start (`alembic upgrade head` in `scripts/start_api.sh` / `scripts/start_worker.sh`).
- **`dashboard/`** — Next.js (App Router) app. Server components read directly from Postgres for fast list/detail views; mutations that need email I/O (send a draft, create a Gmail draft) proxy through the agent API via `dashboard/lib/agentApi.ts`.

The email backend is a **swappable adapter**: agent code only depends on `EmailProvider` (`agent/src/lookout_agent/email/provider.py`). V1 is Gmail (`gmail.py`). V2 will be Microsoft Graph once IT approves — drop a `graph.py` next to `gmail.py` and wire it in `email/__init__.py:get_provider()`.

---

## Where it runs

There are **two Railway environments**, in one project (`lookout-booking`). Same code, same Dockerfiles, different env vars, different Postgres.

| | Production | Staging |
|---|---|---|
| Purpose | Laura's real inbox. The product. | Tanay's testing inbox. Validate before promoting. |
| Dashboard URL | https://dashboard-production-be76.up.railway.app | https://dashboard-staging-fcd8.up.railway.app |
| Agent API URL | https://agent-api-production-3a74.up.railway.app | https://agent-api-staging-df0f.up.railway.app |
| Postgres | Managed (separate instance) | Managed (separate instance) |
| Gmail user | Laura's booking inbox | `tanaymehta1705@gmail.com` |
| Dashboard password | (rotated at handoff) | `password` |
| `ANTHROPIC_API_KEY` | shared with staging | shared with prod |
| `GMAIL_CLIENT_JSON` | shared (same Google Cloud OAuth client) | shared |
| `GMAIL_TOKEN_JSON` | Laura's refresh token | Tanay's refresh token (minted with `make oauth` against the test Gmail) |

**Workflow:**

```
edit code locally
        │
        ▼
deploy to staging  (railway up against --environment staging)
        │
        ▼
test on staging dashboard
        │
   approve?
   ┌────┴────┐
   no        yes
   │          │
   fix code   deploy to production
              ↑
              same code, different env vars
```

**Promotion is just a second `railway up` to the production environment** — there is no separate image-promotion step. The build is identical; only env vars and DB differ.

---

## Deploying

`railway up --ci` from local. Both environments get the same three-service triplet.

```bash
# Deploy to staging
railway environment staging
railway up --service agent-api    --ci
railway up --service agent-worker --ci
railway up --service dashboard    --ci

# Deploy to production
railway environment production
railway up --service agent-api    --ci
railway up --service agent-worker --ci
railway up --service dashboard    --ci
```

**Always pass the environment explicitly.** The Railway CLI remembers your last-linked environment per project; do not trust it for prod deploys.

**Why three services every time:** agent-api and agent-worker share one Docker image but run different entrypoints, so any change inside `agent/` requires redeploying both. Dashboard is its own image and ships independently, but in practice we ship all three together to keep them in lockstep.

**Migrations** run automatically on container start. Add a migration to `db/alembic/versions/` and it applies the next time agent-api boots in that environment.

---

## Quick start — local dev

Prereqs: Docker, Python 3.11+, Node 20+.

```bash
# 1) Bring up local Postgres on :5434
make db.up

# 2) Install agent + run migrations
make agent.install
make db.migrate

# 3) One-time Gmail OAuth (opens a browser)
#    Drop your OAuth client JSON at agent/secrets/gmail_client.json first.
make oauth

# 4) Copy env files and fill in ANTHROPIC_API_KEY
cp .env.example .env
cp agent/.env.example agent/.env

# 5) Run the agent worker (polls every 2 min) OR the agent API
make agent.dev   # poll loop
make agent.api   # FastAPI on :8000

# 6) In another terminal, run the dashboard
cd dashboard
npm install
npm run dev      # localhost:3000
```

**Local dashboard env vars** (`dashboard/.env.local`):

```
DATABASE_URL=postgresql://lookout:lookout@localhost:5434/lookout
AGENT_API_URL=http://localhost:8000
DASHBOARD_PASSWORD=local
DASHBOARD_SESSION_SECRET=any-32-byte-hex-or-just-a-long-string
```

The dashboard's auth-cookie `secure` flag is gated on `NODE_ENV === 'production'` so local HTTP works.

**Local seed data:** `db/seed_fake_bands.sql` populates three approved bands with profile data + threads. Run with:

```bash
docker exec -i lookout_db psql -U lookout -d lookout < db/seed_fake_bands.sql
```

This is **local-only**. It is **never** run against production or staging.

---

## How the dashboard talks to the data

- **Reads** (list bands, fetch a thread, fetch a profile) go from dashboard route handlers straight to Postgres via `dashboard/lib/db.ts` (`pg` Pool). Fast, no extra hop.
- **Writes that touch email** (create a Gmail draft, send a draft) go to the agent API via `dashboard/lib/agentApi.ts`. The agent owns the Gmail side.
- **Profile edits** (`PATCH /api/bands/:id/profile`) are DB-only — they write directly from the dashboard route. No Gmail involvement.

This split is intentional: you can pop the dashboard open against any DB and the read-only surface works without the agent running. Only the email-mutating actions require the agent.

---

## Schema highlights

Migrations live in `db/alembic/versions/`. Current head: `0004`.

- `0001_initial.py` — bands, threads, messages, drafts, gigs, roster, templates, attachments.
- `0002_thread_continuity_and_stage.py` — thread continuity, conversation stage.
- `0003_band_insights.py` — `bands.insights` JSONB + `insights_updated_at` cache.
- `0004_band_profile.py` — `bands.w9_name`, `bands.bio`, `bands.social_links` JSONB. Powers the Profile tab on the roster.

**Profile data shape (`bands` columns):**

- `name` — band/stage name
- `contact_name` — primary contact person
- `primary_email` — booking email (unique, CITEXT)
- `w9_name` — legal payee name (often an LLC, sometimes a person)
- `bio` — short prose
- `social_links` — JSONB array of `{ label, url }`

---

## Key features

- **Kanban board**: Incoming / In Conversation / On the Roster. Cards auto-move as the agent classifies new inbound mail.
- **Thread panel**: opens on card click; shows the full email history and a compose box. Sending creates a Gmail draft via the agent, waits 30s for an Undo, then sends.
- **Reply threading**: replies set `In-Reply-To` + `References` headers (`agent/src/lookout_agent/email/gmail.py:_build_raw`) so recipients see them in the same thread, not a fresh one.
- **One auto-reply rule**: the agent only auto-sends the very first acknowledgment on a brand-new inquiry. Everything after that is saved as a Gmail draft for Laura to review.
- **Band Profile** (roster only): on an approved card the panel header sprouts a Thread/Profile pill switcher. The Profile view shows W-9 name, bio, social links, and an Edit pencil that flips fields into editable inputs with a sticky Save bar.
- **Insights cache**: AI-extracted metadata (genre, fee range, key facts) lives in `bands.insights` JSONB, refreshed on demand by `agent/src/lookout_agent/insights.py`.

---

## Environment variables reference

### Both agent services (`agent-api`, `agent-worker`)
| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Auto-linked from the env's Postgres. `postgresql://` is auto-rewritten to `postgresql+psycopg://` at startup. |
| `ANTHROPIC_API_KEY` | ✅ | Same key on both prod and staging is fine. |
| `GMAIL_CLIENT_JSON` | ✅ | Full client JSON, single string. |
| `GMAIL_TOKEN_JSON` | ✅ | Full refresh token JSON. Re-mint with `make oauth`. |
| `GMAIL_USER_EMAIL` | ✅ | Inbox the OAuth token belongs to. |
| `RAILWAY_DOCKERFILE_PATH` | ✅ | `agent/Dockerfile`. |
| `ROLE` | worker only | `worker` on agent-worker; defaults to `api`. |
| `EMAIL_PROVIDER` | optional | `gmail` (default). |
| `POLL_INTERVAL_SECONDS` | optional | `120` (worker only). |
| `STALE_CARD_DAYS` | optional | `14` (worker only). |
| `AUTO_REPLY_ENABLED` | optional | `true` by default. Set to `false` on staging if you want drafts only, never auto-sends. |

### `dashboard`
| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Auto-linked from the env's Postgres. Used directly by dashboard reads. |
| `AGENT_API_URL` | ✅ | Public URL of the agent-api in the same environment. |
| `RAILWAY_DOCKERFILE_PATH` | ✅ | `dashboard/Dockerfile`. |
| `DASHBOARD_PASSWORD` | ✅ | Single shared password. |
| `DASHBOARD_SESSION_SECRET` | ✅ | 32-byte hex. Signs the session cookie. Rotate to invalidate live sessions. |

---

## Common operations

```bash
# Stream live logs (per env)
railway environment staging
railway logs --service agent-worker
railway logs --service agent-api
railway logs --service dashboard

# Set an env var
railway variables --service agent-api --set "KEY=value"

# Set a long value (JSON token, etc.)
TOKEN=$(cat agent/secrets/gmail_token.json)
railway variables --service agent-api    --set "GMAIL_TOKEN_JSON=$TOKEN"
railway variables --service agent-worker --set "GMAIL_TOKEN_JSON=$TOKEN"

# Open a psql session against the current env's Postgres
docker run --rm -it postgres:18 psql "$(railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL | cut -d= -f2-)"

# Snapshot prod data into staging (rare; resets staging to look like prod)
PROD=$(railway environment production && railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL | cut -d= -f2-)
STG=$( railway environment staging    && railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL | cut -d= -f2-)
docker run --rm postgres:18 pg_dump --no-owner --no-acl --no-comments --clean --if-exists "$PROD" \
  | docker run --rm -i postgres:18 psql -v ON_ERROR_STOP=1 "$STG"
```

> Use Postgres **18** for `pg_dump` / `psql` — Railway is on Postgres 18 and older client versions abort with "server version mismatch."

---

## Rotating credentials

**Gmail OAuth token expired** (worker logs show auth errors): re-mint locally and reupload.

```bash
rm -f agent/secrets/gmail_token.json
make oauth                            # browser flow — log in as the right account for the target env
railway environment <production|staging>
TOKEN=$(cat agent/secrets/gmail_token.json)
railway variables --service agent-api    --set "GMAIL_TOKEN_JSON=$TOKEN"
railway variables --service agent-worker --set "GMAIL_TOKEN_JSON=$TOKEN"
```

Hot-reloads in ~30s. No redeploy.

**Dashboard password / session secret:**

```bash
railway variables --service dashboard --set "DASHBOARD_PASSWORD=<new>"
# Optional: also rotate the secret to invalidate live sessions
railway variables --service dashboard --set "DASHBOARD_SESSION_SECRET=$(openssl rand -hex 32)"
```

---

## Repo layout

```
agent/
  src/lookout_agent/
    api.py                  FastAPI routes (mailbox, bands/thread, bands/profile, drafts)
    main.py                 Worker poll loop entry point
    pipeline.py             Ingestion + classification + reply orchestration
    reply_engine.py         Decides next action (auto-reply / draft / approve)
    classifier.py           Is this email a band inquiry?
    insights.py             AI-extracted band metadata cache
    config.py               Pydantic Settings + URL normalizer
    email/
      provider.py           Abstract EmailProvider + dataclasses
      gmail.py              Gmail implementation
    db/
      models.py             SQLAlchemy models
      session.py            Session factory
      enums.py              BandStatus / ConversationStage / etc.
  scripts/
    entrypoint.sh           Branches on ROLE → start_api.sh or start_worker.sh
    start_api.sh            alembic upgrade head → uvicorn
    start_worker.sh         alembic upgrade head → python -m lookout_agent.main
    gmail_oauth.py          One-off browser OAuth flow
  Dockerfile

db/
  alembic/
    versions/               Migrations 0001 … 0004
    env.py                  Loads URL from env; rewrites driver
  seed_fake_bands.sql       LOCAL-ONLY seed for design preview

dashboard/
  app/
    api/
      bands/                GET /bands, GET/PATCH /bands/:id, /thread, /profile, /drafts, /insights, /status
      drafts/[id]/send/     POST → agent
      login/  logout/  mailbox/
    kanban/                 Main page (server component)
    login/                  Login page
    globals.css             Design tokens + animations
  components/
    KanbanBoard.tsx         Columns, card grid, panel open/close
    BandCard.tsx            Card on the kanban
    ThreadPanel.tsx         Side panel + Thread/Profile tab switcher
    BandProfile.tsx         Profile read + edit modes
  lib/
    db.ts                   pg Pool wrapper
    agentApi.ts             Fetch wrapper to the agent API
    auth.ts                 HMAC session cookie sign/verify
    types.ts                Shared TS types (BandRow, BandProfile, etc.)
  middleware.ts             Edge middleware — gates everything except /login & friends
  Dockerfile                Multi-stage Next build
```

---

## Working with the agent on this repo

When you tag a Claude Code session into this project, here's what the agent already knows from memory:

- The two-environment setup (production + staging) and the URLs of each.
- The "deploy" command translates to **the three-service triplet** for whichever env you name. Default to production if you say "ship it" / "deploy to the main site" without qualification. Say "deploy to staging" / "push to staging" to target the test env.
- Always pass `--environment` explicitly to `railway up`. Never rely on the CLI's remembered default for production.
- Staging dashboard password is `password`. Production password is whatever you set at handoff — not in this repo.
- The fake-data seed file (`db/seed_fake_bands.sql`) is local-only. Never run it against Railway.
- Migrations run automatically on agent container start — you do not need to invoke alembic manually after a deploy.
- The reply-threading fix (In-Reply-To / References) lives in `agent/src/lookout_agent/email/gmail.py:_build_raw`. Don't regress it.

If something here drifts from reality, **fix this README first**, then change the code. The README is the contract.
