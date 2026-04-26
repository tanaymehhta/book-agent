# Lookout Booking Agent — Future Ideas

Phase 1 (ThreadPanel), the status engine, thread continuity, multi-turn reply loop, and confirmation detection are all **done and deployed**. The ideas below are unbuilt features for future iterations.

---

## Product context

Lookout Farm Brewing & Cider Co. books live music for their taproom. Laura Neville (Marketing Director) is the user. She should never need to open Gmail — the dashboard is her only tool for all band booking communication. The system is fully automated by default; Laura can manually compose and send emails from the dashboard when she wants to.

---

## Tech stack

| Layer | Stack |
|---|---|
| Backend agent | Python 3.12, FastAPI, SQLAlchemy 2, PostgreSQL |
| AI | Anthropic Claude (`claude-sonnet-4-20250514`) |
| Email | Gmail API (OAuth, token at `agent/secrets/gmail_token.json`) |
| Dashboard | Next.js 14 (App Router), TypeScript, Tailwind CSS, SWR |
| DB connection | Dashboard connects directly to Postgres via `pg` pool |

---

## File map

```
book agent/
├── agent/
│   └── src/lookout_agent/
│       ├── main.py              # Entry point, polling loop
│       ├── pipeline.py          # Core ingestion: email → DB → auto-reply decision
│       ├── reply_engine.py      # LLM agent: stage detection + reply draft generation
│       ├── templates.py         # Fixed first-reply template (candidate for deletion — see Idea 1)
│       ├── classifier.py        # Classifies inbound emails (new_inquiry, pipeline_followup, etc.)
│       ├── config.py            # Settings (env vars, API keys)
│       ├── api.py               # FastAPI endpoints
│       ├── db/
│       │   ├── models.py        # SQLAlchemy ORM models
│       │   ├── enums.py         # BandStatus, ConversationStage, DraftStatus, etc.
│       │   └── session.py       # session_scope() context manager
│       └── email/
│           ├── provider.py      # Abstract EmailProvider + NormalizedMessage dataclass
│           └── gmail.py         # Gmail implementation
│
└── dashboard/
    ├── app/
    │   ├── kanban/page.tsx
    │   └── api/
    │       ├── bands/route.ts
    │       ├── bands/[id]/thread/route.ts
    │       ├── bands/[id]/drafts/route.ts
    │       ├── bands/[id]/status/route.ts
    │       ├── drafts/[id]/route.ts
    │       └── drafts/[id]/send/route.ts
    ├── components/
    │   ├── KanbanBoard.tsx
    │   ├── BandCard.tsx
    │   └── ThreadPanel.tsx
    └── lib/
        ├── types.ts
        ├── db.ts
        ├── agentApi.ts
        └── format.ts
```

---

## Database schema (key tables)

### `bands`
```
id uuid PK
name text
contact_name text
primary_email citext UNIQUE
status band_status         -- incoming | in_conversation | approved | archived
on_roster bool
draft_ready bool
needs_review bool
conversation_stage         -- new_lead | collecting_details | negotiating_terms | pending_confirmation | confirmed
music_links jsonb
typical_fee_cents int
draw_notes text
first_contact_at timestamptz
last_activity_at timestamptz
```

### `email_threads`
```
id uuid PK
band_id uuid FK -> bands
provider text
provider_thread_id text
subject text
first_message_at / last_message_at timestamptz
```

### `messages`
```
id uuid PK
thread_id uuid FK -> email_threads
provider_message_id text UNIQUE
direction message_direction  -- inbound | outbound
from_address citext
to_addresses jsonb
body_text / body_html / snippet text
sent_at timestamptz
classification               -- new_inquiry | pipeline_followup | roster_followup | other
auto_sent bool
```

### `drafts`
```
id uuid PK
band_id / thread_id uuid FK
provider_draft_id text UNIQUE
body_text text
status draft_status          -- pending | approved | sent | discarded
created_by draft_created_by  -- agent | human
created_at / updated_at / sent_at timestamptz
```

---

## How the current auto-reply pipeline works

1. Polling loop in `main.py` calls `ingest_message()` in `pipeline.py` for each new Gmail message.
2. `ingest_message()` classifies inbound, creates/updates Band + EmailThread + Message records.
3. **Two separate paths** (Idea 1 replaces this with one):
   - **First contact** (`prior_outbound_count == 0` and `classification == new_inquiry`): calls `_send_first_reply()` → uses **fixed template** from `templates.py` (NOT AI).
   - **Active conversation** (`band.status == in_conversation`): calls `_run_reply_engine()` → uses **LLM** via `reply_engine.py`.
4. `reply_engine.decide_next_action()` does two LLM calls: stage detection, then reply draft generation.
5. If `action == reply_draft` and confidence ≥ 0.8, auto-sends immediately.
6. If `action == approval_candidate` and confidence ≥ 0.85, moves band to `approved`.

---

## FastAPI endpoints (agent, port 8000)

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/bands/{band_id}/thread` | Full thread + messages |
| POST | `/bands/{band_id}/drafts` | Create Gmail draft + DB record |
| PATCH | `/drafts/{draft_id}` | Update draft body |
| POST | `/drafts/{draft_id}/send` | Send draft, mark sent in DB |

---

## LLM context — reply_engine.py

System prompt encodes Laura's voice and venue rules. Signs off as:
```
Laura Neville
Marketing Director
Belkin Family Lookout Farm
```

Key venue constraints:
- Taproom, music starts 6pm
- Sets are 2 or 3 hours
- Bands bring their own PA, mics, cables
- Bands help promote to their audience
- Volume in check; electronic drums preferred

Stage detection classifies threads into: `new_lead | collecting_details | negotiating_terms | pending_confirmation | confirmed`

---

## Idea 1 — Unified agent (replace two-path with one)

**Goal:** Delete the fixed template first-reply path. Route all auto-replies (including first contact) through the LLM in `reply_engine.py`. This makes the first reply AI-generated and contextual rather than a generic template.

**`agent/src/lookout_agent/pipeline.py`** — replace the two-path block (around line 113-143):

```python
# Current two-path logic:
if should_reply:
    _send_first_reply(...)
elif band_status_now == BandStatus.in_conversation:
    _run_reply_engine(...)

# Replace with:
should_run_engine = (
    (classification == Classification.new_inquiry and prior_outbound_count == 0)
    or band_status_now == BandStatus.in_conversation
) and _auto_reply_enabled()

if should_run_engine:
    _run_reply_engine(band_id=band_id, thread_id=thread_id, provider=provider)
```

**`agent/src/lookout_agent/reply_engine.py`** — optionally add to `SYSTEM_PROMPT`:
```
If this is the very first reply to a new inquiry, ask for: set fee, available dates/months, and local draw (friends/fans who'd come to the show).
```

**`agent/src/lookout_agent/templates.py`** — delete the file entirely. Remove its import from `pipeline.py`.

---

## Idea 2 — AI-extracted card info

**Goal:** Cards automatically show what the AI extracted from the thread. No manual data entry.

### New backend endpoint — `agent/src/lookout_agent/api.py`

```python
class BandInsights(BaseModel):
    genre: str | None = None
    fee_range: str | None = None          # e.g. "200-300"
    set_length_preference: str | None = None
    availability_notes: str | None = None
    website: str | None = None
    social_links: list[str] = []
    key_facts: list[str] = []

@app.get("/bands/{band_id}/insights", response_model=BandInsights)
def get_band_insights(band_id: str):
    # 1. Load thread context (reuse get_thread_context from reply_engine)
    # 2. One LLM call with extraction prompt below
    # 3. Cache in bands.insights JSONB column; re-run only if last_activity_at changed
```

Extraction prompt:
```
From this email thread, extract:
GENRE: (music genre/style, or null)
FEE_RANGE: (fee discussed, e.g. "200-300", or null)
SET_LENGTH: (2hr / 3hr / flexible, or null)
AVAILABILITY: (dates or months mentioned as available, or null)
WEBSITE: (any website URL mentioned, or null)
SOCIAL: (any Instagram/Facebook/Spotify URLs, comma-separated, or none)
KEY_FACTS: (2-3 bullet points of anything notable, or none)
```

Add migration:
```sql
ALTER TABLE bands ADD COLUMN IF NOT EXISTS insights jsonb;
ALTER TABLE bands ADD COLUMN IF NOT EXISTS insights_updated_at timestamptz;
```

### New Next.js route
`dashboard/app/api/bands/[id]/insights/route.ts` — proxies to agent `GET /bands/{id}/insights`

### Frontend changes — `dashboard/components/BandCard.tsx`
- Fetch insights lazily when ThreadPanel opens (not on board load)
- For `incoming` / `in_conversation` cards: show genre badge, fee range, key facts
- For `approved` cards: compact view — name + contact + email only

---

## Idea 3 — Command agent (floating chat)

**Goal:** A floating command bar at the bottom of the screen. Laura types natural language. The agent collects missing parameters, previews what it will send to each band, then sends on confirm.

### Required parameters

| Parameter | Required | Notes |
|---|---|---|
| `recipients` | Always | "approved list", "in conversation", "all", band name |
| `intent` | Always | availability check, offer, follow-up, logistics, etc. |
| `event_date` | When making offer | Specific date or range |
| `fee_offer` | When making offer | Dollar amount or range |
| `set_length` | When booking | 2hr or 3hr |
| `start_time` | When booking | Default 6pm |
| `response_deadline` | Optional | "need to know by Friday" |

If params are missing, ask for all of them in one follow-up (not one at a time).

### New backend endpoints — `agent/src/lookout_agent/api.py`

```python
class CommandRequest(BaseModel):
    message: str
    context: dict = {}   # prior turns + partial params

class CommandResponse(BaseModel):
    status: str          # "needs_info" | "preview" | "sent" | "error"
    reply: str
    preview_drafts: list[dict] = []  # [{band_id, band_name, draft_body}]
    missing_params: list[str] = []

@app.post("/command", response_model=CommandResponse)
def handle_command(payload: CommandRequest): ...

class CommandConfirmRequest(BaseModel):
    drafts: list[dict]   # [{band_id, body_text}]

@app.post("/command/confirm")
def confirm_command(payload: CommandConfirmRequest): ...
```

### New Next.js routes
- `dashboard/app/api/command/route.ts`
- `dashboard/app/api/command/confirm/route.ts`

### New component — `dashboard/components/CommandBar.tsx`
1. Floating bar anchored to bottom, full width
2. Placeholder: "Tell Laura what to do..."
3. On submit → POST `/api/command` with `{ message, context }`
4. `needs_info` → show agent question, user responds, accumulate context
5. `preview` → expandable list of per-band drafts, editable inline → "Send all" → POST `/api/command/confirm`
6. Toast: "Sent to N bands" with 30s undo
7. Last 3 commands shown as chips

Add `<CommandBar />` to `KanbanBoard.tsx`.

---

## Build order for ideas

```
Idea 1  Unified agent        Backend only. Small, surgical. Safe to do anytime.
Idea 2  Card enrichment      Needs new endpoint + ThreadPanel already open to display in.
Idea 3  Command agent        Needs Idea 1's unified agent underneath it.
```

---

## Style conventions

**Python:**
- Type hints everywhere
- `session_scope()` context manager for all DB access
- `logging.getLogger(__name__)`
- No bare `except:` — use `except Exception:  # noqa: BLE001` with `log.exception()`

**TypeScript/React:**
- `'use client'` only on components that use hooks/browser APIs
- SWR for data fetching with `mutate()` for refreshes
- Tailwind only — no custom CSS except `globals.css`
- Dark theme tokens: `bg-surface`, `bg-surface-2`, `border-border`, `text-muted`
- No `any` types — extend `lib/types.ts` for new shapes

---

## Running locally

```bash
# Backend agent (port 8000)
cd agent && uv run uvicorn lookout_agent.api:app --reload

# Dashboard (port 3000)
cd dashboard && npm run dev

# DB — PostgreSQL on port 5434
# Connection: postgresql://lookout:lookout@localhost:5434/lookout
```

Env vars needed:
- `agent/.env`: `ANTHROPIC_API_KEY`, `GMAIL_USER_EMAIL`, `DATABASE_URL`, `AUTO_REPLY_ENABLED`
- `dashboard/.env.local`: `DATABASE_URL`, `AGENT_API_URL=http://localhost:8000`
