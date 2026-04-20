# Book Agent — Project Update Log

## What This System Does

An automated band booking assistant for Lookout Farm (testing with personal Gmail).

**Full flow:**
1. Someone sends a band booking email to the monitored inbox
2. Agent detects it, classifies it (keyword-based), creates a Band record in PostgreSQL
3. If confidence ≥ 80%, agent auto-sends a first-reply acknowledgment
4. A card appears on the Kanban board (3 columns: Incoming → In Conversation → Approved)
5. From the board, you can open the thread, draft a reply, send it, and advance the card

---

## What Was Built (Before This Conversation)

### Agent (Python)
- `agent/src/lookout_agent/pipeline.py` — ingestion loop, idempotent, classifies + auto-replies
- `agent/src/lookout_agent/classifier.py` — keyword-based classifier (2+ keywords = new_inquiry at 80%+ confidence)
- `agent/src/lookout_agent/email/gmail.py` — full Gmail OAuth2 provider (poll, send, draft, send_draft)
- `agent/src/lookout_agent/main.py` — poll loop, every 120s
- `agent/src/lookout_agent/api.py` — FastAPI HTTP server with endpoints:
  - `GET /bands/{id}/thread` — fetch full email thread
  - `POST /bands/{id}/drafts` — create Gmail draft
  - `PATCH /drafts/{id}` — edit draft
  - `POST /drafts/{id}/send` — send draft, moves band to in_conversation
- `agent/src/lookout_agent/templates.py` — first-reply template renderer
- `agent/src/lookout_agent/db/` — SQLAlchemy models, enums, session

### Database (PostgreSQL via Docker)
- Runs on `localhost:5434`
- Managed via Alembic migrations in `db/alembic/versions/0001_initial.py`
- Key tables: bands, band_emails, email_threads, messages, drafts, templates, provider_cursors
- Templates seeded in migration: `scoop` and `signature` rows

### Dashboard (Next.js)
- `dashboard/app/kanban/page.tsx` — Kanban page
- `dashboard/components/KanbanBoard.tsx` — 3-column board, polls /api/bands every 15s
- `dashboard/components/BandCard.tsx` — card showing band name, email, snippet, draft badge
- `dashboard/lib/types.ts` — BandRow, ThreadDetail, ThreadMessageRow, DraftRow types
- `dashboard/lib/agentApi.ts` — helper to proxy calls to agent API (default http://localhost:8000)
- API routes:
  - `GET /api/bands` — list all bands grouped by status
  - `GET /api/bands/[id]/thread` — fetch thread from DB
  - `PATCH /api/bands/[id]/status` — move card to new column
  - `POST /api/bands/[id]/drafts` — proxies to agent API
  - `POST /api/drafts/[id]/send` — proxies to agent API

---

## What We Did In This Conversation

### 1. Audit
- Confirmed ~70% of the system was already built
- Identified the main gap: cards appear on the board but are not clickable — no thread view, no reply UI, no way to advance cards from the board

### 2. Gmail OAuth Setup
- Created a Desktop app OAuth client in Google Cloud Console (project: book agent, owner: tanaymehta1705@gmail.com)
- Downloaded client secret, renamed to `gmail_client.json`, placed in `agent/secrets/`
- Enabled the Gmail API in Google Cloud Console
- Published the OAuth app (moved from Testing to Production to avoid test-user restrictions)
- Updated `GMAIL_USER_EMAIL` in `agent/.env` to `tanaymehta1705@gmail.com` (the inbox to be monitored)
- Ran `make oauth` → browser flow → saved `gmail_token.json` to `agent/secrets/`

### 3. Infrastructure Startup
- Started Docker Desktop → ran `make db.up && make db.migrate` (DB up on port 5434, schema applied)
- Started email poller: `make agent.dev` (polling Gmail every 120s, correctly ignoring non-band emails)
- Installed missing deps (`uvicorn`, `fastapi`) into `.venv`
- Started agent API: `python -m uvicorn lookout_agent.api:app --host 0.0.0.0 --port 8000`

---

## Current State (End of This Conversation)

| Component | Status |
|---|---|
| Gmail OAuth credentials | ✅ Done |
| DB running + migrated | ✅ Done |
| Email poller (agent.dev) | ✅ Running |
| Agent API (port 8000) | ✅ Running |
| Dashboard (npm run dev) | ⏳ Not started yet this session |
| Kanban board — cards appear | ✅ Works |
| Kanban board — click card → thread view | ❌ Not built |
| Reply / send from board | ❌ Not built |
| Move card between columns from board | ❌ Not built |

---

## What's Left To Build

One component: **ThreadPanel** (slide-over UI when you click a card).

Needs to:
- Fetch and display the full email thread (`GET /api/bands/[id]/thread`)
- Compose textarea for a reply
- "Save Draft" button → `POST /api/bands/[id]/drafts`
- "Send" button → `POST /api/drafts/[id]/send`
- "Move to Negotiation" / "Mark Approved" buttons → `PATCH /api/bands/[id]/status`

Also needs:
- `BandCard` to accept an `onSelect(id)` prop and be clickable
- `KanbanBoard` to hold `selectedBandId` state and render the panel

All backend routes for this already exist. It's purely a UI build.

---

## How To Start The System

```bash
# Terminal 1 — DB (only needed once per machine restart)
make db.up

# Terminal 2 — Email poller
make agent.dev

# Terminal 3 — Agent API
cd agent && python -m uvicorn lookout_agent.api:app --host 0.0.0.0 --port 8000

# Terminal 4 — Dashboard
cd dashboard && npm run dev
```

Then open: http://localhost:3000/kanban

---

## Key File Locations

| What | Where |
|---|---|
| Gmail credentials | `agent/secrets/gmail_client.json` + `gmail_token.json` |
| Agent env config | `agent/.env` |
| Dashboard env config | `dashboard/.env.local` |
| Email poller entry | `agent/src/lookout_agent/main.py` |
| Agent HTTP API | `agent/src/lookout_agent/api.py` |
| Kanban board | `dashboard/components/KanbanBoard.tsx` |
| Band card | `dashboard/components/BandCard.tsx` |

---

## Accounts

| Role | Account |
|---|---|
| Google Cloud project owner | tanaymehta1705@gmail.com |
| Monitored inbox (test) | tanaymehta1705@gmail.com |
| Production inbox (future) | lookoutfarm.bookings@gmail.com |

---

## Implementation Session (Apr 20, 2026)

### Phase 0+1: Status Engine Fix (DONE)
- Removed `incoming -> in_conversation` transition from outbound send paths (`_handle_outbound` in pipeline.py and `send_draft` in api.py)
- Added correct transition: only triggers when an inbound message arrives on a thread that already has at least one prior outbound
- Added structured `lookout.transitions` logger for all status changes

### Phase 2: Thread Continuity (DONE)
- Migration `0002`: added `messages.internet_message_id`, `messages.in_reply_to` (indexed), `bands.conversation_stage`, `bands.needs_review`
- `_upsert_thread` now uses 3-tier fallback: provider_thread_id -> In-Reply-To match -> same-band recent thread window
- `_insert_message` persists `internet_message_id` and `in_reply_to` for future linking

### Phase 3: Multi-Turn Reply Engine (DONE)
- New module: `agent/src/lookout_agent/reply_engine.py`
- Uses Anthropic Claude for stage detection + reply generation
- Integrated into pipeline: after any inbound on `in_conversation` bands, engine runs and produces draft/approval/review decision
- Graceful fallback when API key is missing (flags `needs_human`)

### Phase 4: Confirmation Detection (DONE)
- Built into reply engine: stage detector identifies approval signals
- Conservative threshold (>= 0.85 confidence) for auto-approval
- Below threshold: sets `needs_review` flag

### Phase 5: Board UX (DONE)
- Types updated: `needs_review`, `conversation_stage` exposed
- Bands API query returns new fields
- BandCard shows badges: `review`, `draft`, `awaiting`
- Conversation stage pill shown on card footer

### What You Need To Do
1. Add your Anthropic API key to `agent/.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
2. Restart the agent poller (`make agent.dev`) to pick up new code
3. Send a test email and verify the flow end-to-end
