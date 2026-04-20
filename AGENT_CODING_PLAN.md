# Lookout Booking Agent — Coding Plan

This document is the complete context for a coding agent to implement the four-phase upgrade plan. Read everything before writing a single line.

**Also read first:** `BOOKING_AGENT_EXECUTION_PLAN.md` (same directory). That document covers the foundational backend behavior: status transition rules, thread continuity hardening, multi-turn reply loop, and confirmation detection. The plan below assumes that work is complete or in progress and builds on top of it.

---

## Product context

Lookout Farm Brewing & Cider Co. books live music for their taproom. Laura Neville (Marketing Director) is the user. She should never need to open Gmail — this dashboard is her only tool for all band booking communication. The system is fully automated by default; Laura can manually compose and send emails from the dashboard when she wants to.

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

## File map — what everything does

```
book agent/
├── agent/
│   └── src/lookout_agent/
│       ├── main.py              # Entry point, polling loop
│       ├── pipeline.py          # Core ingestion: email → DB → auto-reply decision
│       ├── reply_engine.py      # LLM agent: stage detection + reply draft generation
│       ├── templates.py         # Fixed first-reply template (TO BE DELETED in Phase 2)
│       ├── classifier.py        # Classifies inbound emails (new_inquiry, pipeline_followup, etc.)
│       ├── config.py            # Settings (env vars, API keys)
│       ├── api.py               # FastAPI: /bands/{id}/thread, /bands/{id}/drafts, /drafts/{id}/send, /drafts/{id} PATCH
│       ├── db/
│       │   ├── models.py        # SQLAlchemy ORM models (see schema section below)
│       │   ├── enums.py         # All enums: BandStatus, ConversationStage, DraftStatus, etc.
│       │   └── session.py       # session_scope() context manager
│       └── email/
│           ├── provider.py      # Abstract EmailProvider + NormalizedMessage dataclass
│           └── gmail.py         # Gmail implementation
│
└── dashboard/
    ├── app/
    │   ├── kanban/page.tsx      # Main page, renders KanbanBoard
    │   └── api/
    │       ├── bands/route.ts              # GET /api/bands — fetches all non-archived bands with last message
    │       ├── bands/[id]/thread/route.ts  # GET /api/bands/[id]/thread — full thread + messages
    │       ├── bands/[id]/drafts/route.ts  # POST /api/bands/[id]/drafts — create draft
    │       ├── bands/[id]/status/route.ts  # PATCH /api/bands/[id]/status — move kanban column
    │       ├── drafts/[id]/route.ts        # PATCH /api/drafts/[id] — update draft body
    │       └── drafts/[id]/send/route.ts   # POST /api/drafts/[id]/send — send draft
    ├── components/
    │   ├── KanbanBoard.tsx      # Three-column board, polls /api/bands every 15s
    │   └── BandCard.tsx         # Individual band card, currently has NO onClick handler
    └── lib/
        ├── types.ts             # TypeScript types: BandRow, ThreadDetail, DraftRow, etc.
        ├── db.ts                # Postgres pool + query helper
        ├── agentApi.ts          # agentFetch() — proxies to FastAPI at localhost:8000
        └── format.ts            # timeAgo(), daysSince()
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
draft_ready bool           -- true when agent has a pending draft
needs_review bool          -- true when agent flags for human
conversation_stage         -- new_lead | collecting_details | negotiating_terms | pending_confirmation | confirmed
music_links jsonb          -- []
typical_fee_cents int
draw_notes text
first_contact_at timestamptz
last_activity_at timestamptz
```

### `email_threads`
```
id uuid PK
band_id uuid FK -> bands
provider text              -- 'gmail'
provider_thread_id text    -- Gmail thread ID
subject text
first_message_at timestamptz
last_message_at timestamptz
```

### `messages`
```
id uuid PK
thread_id uuid FK -> email_threads
provider_message_id text UNIQUE
direction message_direction  -- inbound | outbound
from_address citext
to_addresses jsonb           -- []
body_text text
body_html text
snippet text
sent_at timestamptz
classification               -- new_inquiry | pipeline_followup | roster_followup | other
auto_sent bool               -- true if the agent sent this, false if Laura sent it
```

### `drafts`
```
id uuid PK
band_id uuid FK
thread_id uuid FK
provider text
provider_draft_id text UNIQUE  -- Gmail draft ID
body_text text
status draft_status            -- pending | approved | sent | discarded
created_by draft_created_by    -- agent | human
created_at / updated_at / sent_at timestamptz
```

### `gigs`
```
id uuid PK
band_id uuid FK
gig_date date
fee_cents int
set_length_minutes int
notes text
```

---

## How the current auto-reply pipeline works

1. Polling loop in `main.py` calls `ingest_message()` in `pipeline.py` for each new Gmail message
2. `ingest_message()` classifies inbound, creates/updates Band + EmailThread + Message records
3. **Two separate paths** (this is the problem Phase 2 fixes):
   - **First contact** (`prior_outbound_count == 0` and `classification == new_inquiry`): calls `_send_first_reply()` → uses **fixed template** from `templates.py` (NOT AI)
   - **Active conversation** (`band.status == in_conversation`): calls `_run_reply_engine()` → uses **LLM** via `reply_engine.py`
4. `reply_engine.decide_next_action()` does two LLM calls: stage detection, then reply draft generation
5. If `action == reply_draft` and confidence ≥ 0.8, auto-sends immediately via `provider.send_message()`
6. If `action == approval_candidate` and confidence ≥ 0.85, moves band to `approved`

---

## FastAPI endpoints (agent, port 8000)

| Method | Path | What it does |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/bands/{band_id}/thread` | Returns full thread + messages for band |
| POST | `/bands/{band_id}/drafts` | Creates Gmail draft + Draft DB record. Body: `{body_text}` |
| PATCH | `/drafts/{draft_id}` | Updates draft body text. Body: `{body_text}` |
| POST | `/drafts/{draft_id}/send` | Sends the Gmail draft, marks sent in DB |

---

## Next.js API routes (dashboard, port 3000)

These proxy to the agent API or hit Postgres directly.

| Method | Path | Backend |
|---|---|---|
| GET | `/api/bands` | Direct Postgres — returns all active bands with last message |
| GET | `/api/bands/[id]/thread` | Direct Postgres — returns thread + messages |
| POST | `/api/bands/[id]/drafts` | Proxies to agent `POST /bands/{id}/drafts` |
| PATCH | `/api/drafts/[id]` | Proxies to agent `PATCH /drafts/{id}` |
| POST | `/api/drafts/[id]/send` | Proxies to agent `POST /drafts/{id}/send` |

---

## LLM context — reply_engine.py

The system prompt (`SYSTEM_PROMPT`) encodes Laura's voice and venue rules. It signs off as:
```
Laura Neville
Marketing Director
Belkin Family Lookout Farm
```

Key venue constraints the LLM knows:
- Taproom, music starts 6pm
- Sets are 2 or 3 hours
- Bands bring their own PA, mics, cables
- Bands help promote to their audience
- Volume in check; electronic drums preferred

The stage detection prompt classifies threads into: `new_lead | collecting_details | negotiating_terms | pending_confirmation | confirmed`

---

## What is NOT built yet (the four phases)

---

## Phase 1 — ThreadPanel (priority: build first)

**Goal:** Click a band card → right-side panel slides in showing full email thread + compose box + send button. Manual email sending from the dashboard.

### Changes required

**`dashboard/components/BandCard.tsx`**
- Add `onClick?: () => void` prop
- Make the card `cursor-pointer` and call `onClick` on click

**`dashboard/components/KanbanBoard.tsx`**
- Add `const [selectedBandId, setSelectedBandId] = useState<string | null>(null)`
- Pass `onClick={() => setSelectedBandId(b.id)}` to each `BandCard`
- Render `<ThreadPanel bandId={selectedBandId} onClose={() => setSelectedBandId(null)} />` when `selectedBandId` is set

**New file: `dashboard/components/ThreadPanel.tsx`**

This is the main new component. Behavior:
1. Fetches `GET /api/bands/[bandId]/thread` → renders message list
2. Each message shows: direction label (YOU / THEM), timestamp, full `body_text` (not just snippet). Scroll to bottom by default.
3. Below the thread: a `<textarea>` for composing
4. "Send" button flow:
   - POST `/api/bands/[bandId]/drafts` with `{ body_text }` → get back `{ id: draftId, ... }`
   - POST `/api/drafts/[draftId]/send`
   - On success: show 30-second undo toast (during undo window, call a cancel/discard endpoint if needed), refresh the board
5. Panel slides in from the right (fixed position, full height, ~480px wide)
6. Close button (X) in top-right corner

**Types needed in `lib/types.ts`** — already exist: `ThreadDetail`, `ThreadMessageRow`, `DraftRow`. No changes needed.

**No backend changes needed for Phase 1.** All APIs already exist.

### UX details
- Panel overlay: semi-transparent dark backdrop on the left side (click to close)
- Thread messages: outbound messages right-aligned with slightly different bg; inbound left-aligned
- Loading state while fetching thread
- Error state if thread fetch fails
- Disable send button while sending; show "Sending..." state
- After send: clear compose box, refetch thread to show new message

---

## Phase 2 — Unified agent (replace two-path with one)

**Goal:** Delete the fixed template first-reply path. Route all auto-replies (including first contact) through the LLM agent in `reply_engine.py`.

### Changes required

**`agent/src/lookout_agent/pipeline.py`**

Find the block (around line 113-143):
```python
should_reply = (
    classification == Classification.new_inquiry
    and confidence >= AUTO_REPLY_CONFIDENCE
    and prior_outbound_count == 0
    and _auto_reply_enabled()
)
# ...
if should_reply:
    _send_first_reply(...)
elif band_status_now == BandStatus.in_conversation:
    _run_reply_engine(...)
```

Replace with:
```python
should_run_engine = (
    (classification == Classification.new_inquiry and prior_outbound_count == 0)
    or band_status_now == BandStatus.in_conversation
) and _auto_reply_enabled()
# ...
if should_run_engine:
    _run_reply_engine(band_id=band_id, thread_id=thread_id, provider=provider)
```

Delete `_send_first_reply()` function entirely.

**`agent/src/lookout_agent/reply_engine.py`**

The `SYSTEM_PROMPT` already handles first contact well. Optionally add one line to the system prompt clarifying first-contact behavior:
```
If this is the very first reply to a new inquiry, ask for: set fee, available dates/months, and local draw (friends/fans who'd come to the show).
```

**`agent/src/lookout_agent/templates.py`**

Delete the file entirely. Remove its import from `pipeline.py`.

**`agent/src/lookout_agent/pipeline.py`** — remove this import line:
```python
from .templates import first_name_from, get_templates, render_first_reply, reply_subject
```

Keep `first_name_from` if it's used elsewhere, or inline it.

---

## Phase 3 — AI-extracted card info

**Goal:** Cards automatically show what the AI extracted from the thread. No manual data entry. Cards in earlier stages show enriched band info; Approved cards are compact.

### New backend endpoint

**`agent/src/lookout_agent/api.py`** — add:

```python
class BandInsights(BaseModel):
    genre: str | None = None
    fee_range: str | None = None          # e.g. "200-300"
    set_length_preference: str | None = None  # "2hr", "3hr", "flexible"
    availability_notes: str | None = None
    website: str | None = None
    social_links: list[str] = []
    key_facts: list[str] = []             # anything else notable from the thread

@app.get("/bands/{band_id}/insights", response_model=BandInsights)
def get_band_insights(band_id: str):
    # 1. Load thread context (reuse get_thread_context from reply_engine)
    # 2. Run one LLM call with a structured extraction prompt
    # 3. Parse response into BandInsights
    # 4. Cache result in bands.music_links or a new insights column (JSONB)
    #    Re-run only if last_activity_at changed since last extraction
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

**Option:** Cache insights in a new `band_insights` JSONB column on the `bands` table. Add a migration:
```sql
ALTER TABLE bands ADD COLUMN IF NOT EXISTS insights jsonb;
ALTER TABLE bands ADD COLUMN IF NOT EXISTS insights_updated_at timestamptz;
```

### New Next.js API route

**`dashboard/app/api/bands/[id]/insights/route.ts`** — proxies to agent `GET /bands/{id}/insights`

### Frontend changes

**`dashboard/components/BandCard.tsx`**
- Fetch insights lazily when card is expanded or ThreadPanel opens (not on board load)
- For `incoming` and `in_conversation` cards: show genre badge, fee range, key facts in a collapsible section
- For `approved` cards: compact view — just name + contact_name + primary_email. No stage badge, no snippet. Clean and minimal.

---

## Phase 4 — Command agent (floating chat)

**Goal:** A floating command bar at the bottom of the screen. Laura types natural language intent. The agent collects required parameters, shows a preview of what it will send, then auto-sends to all matched recipients.

### Required parameters for any email action

The command agent must collect these before executing:

| Parameter | Required | How to derive |
|---|---|---|
| `recipients` | Always | From command: "approved list", "in conversation", "all", band name |
| `intent` | Always | What to communicate: availability check, offer, follow-up, logistics, etc. |
| `event_date` | When making offer or checking availability | Must be specific date or range |
| `fee_offer` | When making an offer | Dollar amount or range |
| `set_length` | When booking | 2hr or 3hr |
| `start_time` | When booking | Default 6pm, confirm if different |
| `response_deadline` | Optional | "need to know by Friday" |

If any required parameter is missing, the agent asks for it in a single follow-up question (ask for all missing params at once, not one at a time).

### New backend endpoint

**`agent/src/lookout_agent/api.py`** — add:

```python
class CommandRequest(BaseModel):
    message: str
    context: dict = {}   # optional: prior turns, partial params collected so far

class CommandResponse(BaseModel):
    status: str          # "needs_info" | "preview" | "sent" | "error"
    reply: str           # Agent's text response to show in the chat
    preview_drafts: list[dict] = []  # [{band_id, band_name, draft_body}] when status=="preview"
    missing_params: list[str] = []   # when status=="needs_info"

@app.post("/command", response_model=CommandResponse)
def handle_command(payload: CommandRequest):
    # 1. Use LLM to parse intent + extract params from payload.message + payload.context
    # 2. Identify recipients (query DB for bands matching status filter)
    # 3. If params incomplete: return status="needs_info" with missing_params list
    # 4. If params complete: generate per-band drafts using reply_engine logic
    #    Return status="preview" with preview_drafts
    # Actual sending happens in a separate confirm endpoint
```

**`agent/src/lookout_agent/api.py`** — add confirm endpoint:

```python
class CommandConfirmRequest(BaseModel):
    drafts: list[dict]   # [{band_id, body_text}] — user may have edited

@app.post("/command/confirm")
def confirm_command(payload: CommandConfirmRequest):
    # For each draft: POST /bands/{id}/drafts then /drafts/{id}/send
    # Return {"sent": N, "errors": [...]}
```

### New Next.js API routes

- `dashboard/app/api/command/route.ts` — POST, proxies to agent `/command`
- `dashboard/app/api/command/confirm/route.ts` — POST, proxies to agent `/command/confirm`

### New frontend component: `dashboard/components/CommandBar.tsx`

UI behavior:
1. Floating bar anchored to bottom of screen, full width, above a slightly raised surface
2. Text input: "Tell Laura what to do..." placeholder
3. On submit → POST `/api/command` with `{ message, context }`
4. If `status == "needs_info"`: show agent's reply asking for more info, user responds, accumulate context
5. If `status == "preview"`: show expandable list of drafts per band. User can edit each draft inline. "Send all" button → POST `/api/command/confirm`
6. After send: show toast "Sent to N bands" with 30s undo option
7. Command history: show last 3 commands in the bar as chips

**`dashboard/components/KanbanBoard.tsx`** — render `<CommandBar />` at bottom of the screen layout.

---

## Build order

```
Phase 1  ThreadPanel          No backend changes needed. Start here.
Phase 2  Unified agent        Backend only. Small, surgical. Do alongside Phase 1.
Phase 3  Card enrichment      Needs new backend endpoint + Phase 1 panel to display in.
Phase 4  Command agent        Needs Phase 2's unified agent underneath it.
```

---

## Environment / running locally

```bash
# Backend agent (port 8000)
cd agent
uv run uvicorn lookout_agent.api:app --reload

# Dashboard (port 3000)
cd dashboard
npm run dev

# DB
# PostgreSQL on port 5434
# Connection: postgresql://lookout:lookout@localhost:5434/lookout
```

Environment variables needed:
- `agent/.env`: `ANTHROPIC_API_KEY`, `GMAIL_USER_EMAIL`, `DATABASE_URL`, `AUTO_REPLY_ENABLED`
- `dashboard/.env.local`: `DATABASE_URL`, `AGENT_API_URL=http://localhost:8000`

---

## Style conventions

**Python:**
- Type hints everywhere
- `session_scope()` context manager for all DB access
- Log with `logging.getLogger(__name__)`
- No bare `except:` — use `except Exception:  # noqa: BLE001` with `log.exception()`

**TypeScript/React:**
- `'use client'` directive only on components that use hooks/browser APIs
- SWR for data fetching with `mutate()` for refreshes
- Tailwind only — no custom CSS except `globals.css`
- Dark theme: `bg-surface`, `bg-surface-2`, `border-border`, `text-muted` are the design tokens already in use
- No `any` types — extend `lib/types.ts` for new shapes
