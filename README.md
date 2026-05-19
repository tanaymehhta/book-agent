# Lookout Farm Booking Assistant

AI-powered band booking pipeline for **Belkin Family Lookout Farm** (Natick, MA). The system watches a Gmail inbox, decides which messages are real band inquiries, drafts replies in Laura's voice, and presents the whole pipeline as a kanban board where Laura can review, edit, and send with one click.

This README is the source of truth for **what's built**, **how it runs**, **how data flows through it**, and **how you work on it** — both for humans and for agents picking the project back up.

---

## Table of contents

1. [What the system does](#1-what-the-system-does)
2. [Environments — staging vs production](#2-environments--staging-vs-production)
3. [Architecture at a glance](#3-architecture-at-a-glance)
4. [End-to-end data flow](#4-end-to-end-data-flow)
5. [The agent — module by module](#5-the-agent--module-by-module)
6. [The database](#6-the-database)
7. [The dashboard](#7-the-dashboard)
8. [HTTP API reference](#8-http-api-reference)
9. [Local dev quick start](#9-local-dev-quick-start)
10. [Deploying](#10-deploying)
11. [Environment variables](#11-environment-variables)
12. [Common operations](#12-common-operations)
13. [Rotating credentials](#13-rotating-credentials)
14. [Repo layout](#14-repo-layout)
15. [Working with Claude Code on this repo](#15-working-with-claude-code-on-this-repo)

---

## 1. What the system does

Laura is the Marketing Director at Lookout Farm. Bands constantly cold-email her booking inbox asking to play the Taproom. Today most of those emails sit unread for days; the rest get a copy-pasted reply. The booking assistant turns that into a one-screen workflow:

- A **worker** polls the Gmail inbox every 120 seconds for new messages.
- A **classifier** (rule-based fast path + Claude Sonnet 4) decides whether each inbound is a real band inquiry or junk (vendor pitches, recruiters, marketing, customer questions). Junk is silently dropped into an `ignored_messages` table — never shown on the board.
- For the very first inquiry on a new sender, the agent **auto-sends one templated reply** that asks for fee, genre, music links, availability, and draw. This is the agent's only auto-send; everything after that is human-in-the-loop.
- For every follow-up on an active band, the agent runs the **reply engine** (Claude Haiku) to detect the conversation stage (`new_lead → collecting_details → negotiating_terms → pending_confirmation → confirmed`) and draft a suggested next reply, which appears pre-filled in the dashboard compose box marked "AI suggestion — edit before sending."
- A **kanban board** organizes every band into three columns: `Incoming`, `In Conversation`, `On the Roster`. Cards move automatically as the agent classifies new mail; Laura can also drag them. Approved bands get a **Profile** tab with W-9 name, bio, and social links that Laura can edit inline.
- A **summarizer** (Claude Haiku) generates a clean one-line preview for every message, replacing Gmail's HTML-littered, mid-sentence snippets on the band cards.
- An **insights extractor** runs a single LLM pass over each thread and caches structured fields (genre, fee range, set length, availability, social links, key facts) on the band so the card surfaces them at a glance. It also **backfills profile fields** (`band_name`, `contact_name`, `w9_name`) when they're empty — never overwriting Laura's manual edits.
- Sending a reply from the dashboard ships through the agent API, sets proper `In-Reply-To`/`References` headers so recipients see it in the original Gmail thread (not a new one), and waits **30 seconds** for an Undo before actually leaving the outbox.

---

## 2. Environments — staging vs production

There are **two Railway environments**, in one Railway project (`lookout-booking`). Same code, same Dockerfiles, same image build — different env vars, different Postgres, different Gmail account.

|  | **Production** | **Staging** |
|---|---|---|
| Purpose | Laura's real inbox. The product. | Tanay's testing inbox. Validate before promoting. |
| Gmail mailbox | `lookoutfarm.bookings@gmail.com` — the live Lookout Farm booking inbox | `tanaymehta1705@gmail.com` — Tanay's test mailbox |
| Dashboard URL | https://dashboard-production-be76.up.railway.app | https://dashboard-staging-fcd8.up.railway.app |
| Agent API URL | https://agent-api-production-3a74.up.railway.app | https://agent-api-staging-df0f.up.railway.app |
| Postgres | Managed (separate instance) | Managed (separate instance) |
| Dashboard password | rotated at handoff (not in repo) | `password` |
| `ANTHROPIC_API_KEY` | shared with staging | shared with prod |
| `GMAIL_CLIENT_JSON` | shared OAuth client (same Google Cloud project) | shared OAuth client |
| `GMAIL_TOKEN_JSON` | Laura's refresh token, scoped to `lookoutfarm.bookings@gmail.com` | Tanay's refresh token, scoped to `tanaymehta1705@gmail.com` (minted with `make oauth`) |

**Workflow:** anything that touches the agent or dashboard ships to staging first, gets exercised against Tanay's inbox, and only then gets promoted to production. There is no automatic promotion — promotion is just a second `railway up` against the production environment with the same code.

```
edit code locally
        │
        ▼
deploy to staging  (railway up --environment staging)
        │
        ▼
test on staging dashboard against tanaymehta1705@gmail.com
        │
   approve?
   ┌────┴────┐
   no        yes
   │          │
   fix code   deploy to production (railway up --environment production)
              ↑
              same code, different env vars, different Gmail
```

> **Always pass the environment explicitly.** The Railway CLI remembers your last-linked environment per project; do not trust it for production deploys.

---

## 3. Architecture at a glance

Three deployable units, one repo:

```
┌──────────────┐     polls every 120s      ┌──────────────────┐
│   Gmail API  │ ◀──────────────────────── │  agent-worker    │
│  (per env)   │                           │  (APScheduler)   │
└──────┬───────┘                           └────────┬─────────┘
       │ send_message                               │ INSERT messages, drafts,
       │ (In-Reply-To, References)                  │ status transitions
       │                                            ▼
       │                                  ┌──────────────────┐
       │                                  │   Postgres       │
       │                                  │   (per env)      │
       │                                  └────────┬─────────┘
       │ POST /drafts/:id/send                     │ direct reads
       │ ┌──────────────────┐                     │
       └─│   agent-api      │ ◀──────────────────│ ┌──────────────────┐
         │   (FastAPI)      │   AGENT_API_URL    │ │   dashboard      │
         └──────────────────┘                    └─│   (Next.js 14)   │
                                                   │   App Router     │
                                                   └──────────────────┘
                                                            ▲
                                                            │ Laura
                                                            │ (kanban + thread + profile)
                                                            │
                                                       browser
```

- **`agent/`** — Python service. Two run modes from **one Docker image**:
  - **API** (FastAPI) — endpoints consumed by the dashboard. Lazy-loads the email provider only when an endpoint actually needs it.
  - **Worker** — APScheduler loop. Same image; `ROLE=worker` env var routes through `scripts/entrypoint.sh` → `scripts/start_worker.sh`.
- **`db/`** — Postgres schema + Alembic migrations. Migrations run automatically on every container start (`alembic upgrade head` inside `start_api.sh` / `start_worker.sh`).
- **`dashboard/`** — Next.js 14 (App Router). Server components read **directly** from Postgres via `dashboard/lib/db.ts` (`pg.Pool`). Mutations that need Gmail I/O (send a reply, update a draft, get current mailbox identity) proxy through the agent API via `dashboard/lib/agentApi.ts`.

The email backend is a **swappable adapter**: agent code only depends on the `EmailProvider` interface (`agent/src/lookout_agent/email/provider.py`). V1 is Gmail (`gmail.py`). V2 will be Microsoft Graph once Lookout Farm IT approves — drop a `graph.py` next to `gmail.py` and wire it in `email/__init__.py:get_provider()`.

---

## 4. End-to-end data flow

This section traces a single email all the way from arriving in Gmail to being on Laura's screen, then back through a reply being sent.

### 4.1 Ingestion (worker, every 120s)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ agent-worker tick                                                       │
└─────────────────────────────────────────────────────────────────────────┘
  1. provider.fetch_new_messages(cursor)
       └─ Gmail History API, paginated. Cursor stored in provider_cursors.
       └─ Each message is normalized into NormalizedMessage:
          { provider_message_id, internet_message_id, in_reply_to,
            from_address, to_addresses, cc_addresses, subject,
            body_text, body_html, snippet, headers, sent_at,
            provider_thread_id, direction }
  2. For each NormalizedMessage → pipeline.ingest_message(msg, provider)
```

### 4.2 Pipeline (`agent/src/lookout_agent/pipeline.py`)

```
ingest_message(msg)
│
├── 1. Idempotency: skip if provider_message_id already exists in
│       `messages` or `ignored_messages`.
│
├── 2. Direction split:
│       outbound  ─► _handle_outbound: attach to known thread, dedupe by
│                     provider_message_id, do NOT change band status.
│       inbound   ─► continue.
│
├── 3. Self-message guard: if From == GMAIL_USER_EMAIL, skip.
│
├── 4. Sender lookup in `band_emails`:
│       known   ─► classify_inbound(known_sender=True) returns
│                  Classification.roster_followup or pipeline_followup.
│       unknown ─► classify_inbound (3-tier; see §5.3).
│                   If Classification.other → log to `ignored_messages`,
│                   stop. Never shown on the kanban.
│                   Otherwise → create `bands` row + `band_emails` row
│                   with status=incoming.
│
├── 5. Thread upsert in `email_threads`:
│       primary:    (provider, provider_thread_id) unique key
│       fallback 1: In-Reply-To header → known message's
│                   internet_message_id → its thread
│       fallback 2: same-band recent thread (last 14 days)
│       else create a new EmailThread.
│
├── 6. Count prior outbound messages on this thread. This drives the
│      "is this first contact?" decision later.
│
├── 7. summarizer.summarize_message → Haiku one-line summary (≤90 chars,
│      sender perspective, no quotes/preamble). Stored on
│      messages.summary. Falls back to messages.snippet if Haiku
│      unavailable or body empty.
│
├── 8. INSERT messages row with summary, classification, headers, etc.
│      Update band.last_activity_at and thread.last_message_at.
│
├── 9. Status transition: incoming → in_conversation
│      Trigger: inbound arrives AND prior_outbound_count > 0.
│      (Outbound never changes status. Inbound on a brand-new band
│      stays "incoming" until we've sent something.)
│
├── 10. Engine mode decision:
│       is_first_contact = (classification == new_inquiry AND
│                            confidence >= 0.8 AND
│                            prior_outbound_count == 0)
│       is_active_band   = (status in [in_conversation, approved])
│
│       not AUTO_REPLY_ENABLED ─► engine_mode = None
│       is_first_contact       ─► engine_mode = "send"
│       is_active_band         ─► engine_mode = "detect_only"
│       else                    ─► engine_mode = None
│
│       Commit transaction.
│
└── 11. Post-commit side effects (network I/O):
        engine_mode == "send"        ─► _send_first_reply
        engine_mode == "detect_only" ─► _run_reply_engine(send_reply=False)
```

### 4.3 First reply (`_send_first_reply`)

- **No LLM call.** The first reply is a fixed template (`reply_engine.render_first_reply`) with the band's name spliced in.
- Body asks for fee, genre, music links, availability, draw — the five fields Laura needs to evaluate every band.
- Sent immediately via `provider.send_message` with `reply_to_thread_id` (Gmail thread ID) and `in_reply_to_message_id` (last inbound `internet_message_id`) so the recipient sees it in the same thread.
- The sent message is persisted as a `messages` row with `auto_sent=True`, `direction=outbound`.
- `band.draft_ready` is cleared.

### 4.4 Reply engine (`_run_reply_engine`, follow-ups on active bands)

- Reads the last ≤20 messages on the thread, strips quoted replies, builds a `[US]`/`[THEM]` transcript.
- Runs **two LLM calls** (Claude Haiku, `claude-haiku-4-5-20251001`):
  1. **Stage detection.** Returns `STAGE`, `APPROVAL_SIGNAL`, `APPROVAL_CONFIDENCE`, `REASONING`. If `APPROVAL_SIGNAL=yes` with confidence ≥ 0.75, **or** stage is `confirmed`, the engine returns an `approval_candidate` decision (skipping reply generation).
  2. **Draft generation.** Generates the next reply in Laura's voice, signed off as "Laura Neville / Marketing Director / Belkin Family Lookout Farm."
- On approval: promote the band to `approved` if confidence ≥ 0.85; otherwise mark `needs_review=True`.
- On stage `confirmed` via any path: also promote to `approved` (safety net so the kanban transitions even when the engine took the `reply_draft` branch).
- The generated draft is stored as a **dashboard-only `drafts` row** (`provider_draft_id = "local:<uuid>"`, `created_by = "agent"`). It is **not** written to Gmail's Drafts folder — long threads would clog Gmail. Any earlier pending agent draft on the same thread is superseded (`status → discarded`).
- `band.draft_ready` is set so the band card shows a yellow "draft" pill.
- After the engine runs, `insights.get_or_refresh_insights` is called to re-extract structured fields and **backfill** `band.name`, `band.contact_name`, `band.w9_name` if those are still empty.

### 4.5 Dashboard render

- The kanban page (`dashboard/app/kanban/page.tsx`) is a server component that fetches `/api/bands` once, then hydrates `KanbanBoard.tsx` with the rows.
- `KanbanBoard.tsx` revalidates with SWR every few seconds. New cards/status changes appear without a refresh.
- Cards in the `Approved` column with `name` blank get an amber **"incomplete profile — add a band name"** pill, prompting Laura to fill in W-9-relevant info before a contract gets sent.
- Cards whose latest message is inbound get a red **"needs reply"** pill.
- Drag-and-drop (`@dnd-kit/core`) moves a card across columns by updating `band.status` via `PATCH /api/bands/:id/status`.

### 4.6 Reply from the dashboard

```
Laura clicks a card
    │
    ▼
ThreadPanel opens. GET /api/bands/:id/thread (dashboard reads Postgres).
    │
    │ If a pending agent-authored draft exists for this thread, its body
    │ is pre-filled into the compose box and an "AI suggestion — edit
    │ before sending" pill appears.
    ▼
Laura edits / clicks Send.
    │
    │   if AI draft existed:  PATCH /api/drafts/:id (update body in place)
    │   else:                 POST /api/bands/:id/drafts (creates a local draft)
    ▼
30-second Undo banner.
    │
    │   undo  ─►  DELETE /api/drafts/:id (planned; current build clears
    │             the timer and keeps the draft pending)
    │   send now ─►  fires immediately
    │   timer expires ─►  POST /api/drafts/:id/send
    ▼
Dashboard proxies to agent-api:
    POST {AGENT_API_URL}/drafts/:id/send
    │
    └─► agent loads draft, finds latest inbound internet_message_id,
        calls provider.send_message with reply_to_thread_id +
        in_reply_to_message_id. Persists a new outbound `messages`
        row, marks draft `status=sent`, updates thread.last_message_at.
```

### 4.7 Status state machine

```
   ┌────────────┐  inbound after outbound  ┌────────────────┐
   │  incoming  │ ───────────────────────► │ in_conversation│
   └────────────┘                          └──────┬─────────┘
        ▲                                         │ stage=confirmed
        │                                         │ or approval_signal≥0.85
        │ manual drag                             ▼
        │                                  ┌────────────────┐
        └──── manual drag ─────────────────│   approved     │
                                           │  (on roster)   │
                                           └────────────────┘
                                                  │ manual drag
                                                  ▼
                                           ┌────────────────┐
                                           │   archived     │
                                           └────────────────┘
```

Outbound messages **never** change band status. Status is only touched by inbound events and by manual drags.

---

## 5. The agent — module by module

All paths below are relative to `agent/src/lookout_agent/`.

### 5.1 `email/provider.py` + `email/gmail.py`

- `EmailProvider` is an `abc.ABC` with five methods: `fetch_new_messages`, `send_message`, `provider_name`, `mailbox_identity_email`, `create_gmail_draft` (Gmail-only; other providers can no-op).
- `NormalizedMessage` is the cross-provider envelope. Includes `internet_message_id` and `in_reply_to` headers, which the pipeline uses for thread fallback matching.
- `gmail.py` is the only implementation today. Key behaviors:
  - Uses Google's official `google-api-python-client` with OAuth refresh tokens.
  - `_build_raw` constructs the MIME message and **sets `In-Reply-To` and `References` headers** on every outbound reply. This is what makes recipients see the reply in the same Gmail thread, not a fresh one. Do not regress this.
  - History API cursor stored in `provider_cursors`.

### 5.2 `pipeline.py`

The orchestrator. See §4.2. Notable details:
- Uses `session_scope()` (`db/session.py`) for transactional boundaries; side effects (sending mail, calling LLMs) happen **after** commit.
- `transition_log` is a dedicated logger (`lookout.transitions`) so all status changes are auditable in Railway logs.
- `AUTO_REPLY_ENABLED=false` disables both the first-reply auto-send and the follow-up draft generation. Useful on staging when you want pure read-only ingestion.

### 5.3 `classifier.py`

Three-tier classification of inbound mail:

**Tier 1 — rule-based fast path.** Zero LLM cost. Catches the obvious noise:
- Sender local-parts like `noreply@`, `marketing@`, `info@`, `sales@`, etc.
- Body phrases like `"unsubscribe"`, `"limited time offer"`, `"linen service"`, `"schedule a demo"`, `"calendly"`, etc. (full list in `LIKELY_NOT_BAND_PHRASES`).
- Any hit returns `Classification.other` with confidence ≤ 0.1.

**Tier 2 — strong band-keyword skip.** If the subject+body contains 3 or more of `STRONG_BAND_KEYWORDS` (`band`, `gig`, `epk`, `bandcamp`, `spotify`, `set list`, etc.), classify as `new_inquiry` with confidence 0.95 — no LLM needed.

**Tier 3 — LLM classifier.** For the ambiguous middle:
- Model: `claude-sonnet-4-20250514`
- Few-shot prompt with 5 worked examples covering band / maybe / other.
- Returns structured JSON: `{ classification: "band" | "maybe" | "other", confidence, reason }`.
- "band" gets clamped to `[0.85, 0.99]` so it lands in the auto-reply bucket. "maybe" gets clamped to `[0.55, 0.75]` so a card is created but no auto-reply fires.
- If the LLM is unavailable, falls back to `_keyword_fallback` (≥2 strong hits → new_inquiry @ 0.7).

**Confidence thresholds in the pipeline:**
- ≥ 0.85 → "definitely a band" → card created + auto-reply if first contact
- 0.55–0.80 → "maybe a band" → card created, no auto-reply
- `Classification.other` → ignored entirely (lands in `ignored_messages`)

Known senders (already in `band_emails`) **skip classification** and are tagged as `roster_followup` or `pipeline_followup` based on whether they're on the roster.

### 5.4 `summarizer.py`  ✨ NEW

Generates the one-line preview shown on every band card and (via `dashboard/app/api/bands/route.ts`) the `last_snippet` field of the kanban list.

- Model: `claude-haiku-4-5-20251001`
- Max 80 output tokens, body trimmed to 4000 characters.
- Prompt: `"Summarize the email below in one short sentence (max 90 characters). Write from the sender's perspective. No quotes, no preamble, no trailing period."`
- Strips quotes, trailing periods, and anything past the first line of the response.
- Falls back to `fallback` (i.e. `messages.snippet`) if the Anthropic key is missing or the call fails.

**Why this exists:** Gmail's raw `snippet` field is HTML-entity-encoded (`&#39;` for `'`, `&amp;` for `&`), often cuts mid-sentence, and looks ugly on the kanban. The summarizer produces clean prose like "Acoustic duo from Boston asking about Saturday slots in June" instead of `"Hi! We&#39;re a 4-piece indie rock band from Bost…"`.

Persisted on `messages.summary` (added in migration 0005). The dashboard reads `COALESCE(m.summary, m.snippet)` so it gracefully falls back for old rows without a summary.

### 5.5 `insights.py`

Extracts structured fields from the thread and caches them on the band.

- One LLM call (Haiku) per refresh.
- Returns `BandInsights`: `genre`, `fee_range`, `set_length_preference`, `availability_notes`, `website`, `social_links[]`, `key_facts[]`, plus three **profile** fields (`band_name`, `contact_name`, `w9_name`) used for backfill.
- Cache is **fresh** when `insights_updated_at >= last_activity_at`. New messages invalidate it.
- `backfill_band_profile` fills empty profile fields from the extracted insights:
  - `band.name` is overwritten only if it still looks like the raw email local-part (e.g. `"jamie.doe"` derived from `jamie.doe@example.com`).
  - `contact_name` and `w9_name` only fill when currently null/empty.
  - Never overwrites Laura's manual edits.
- W-9 extraction is **conservative**: the LLM is told *not* to infer the W-9 name from the band name or contact name — only fill when the sender explicitly calls it out (`"my W-9 name is …"`, `"make checks payable to …"`).

### 5.6 `reply_engine.py`

Two responsibilities:

**`render_first_reply(band) → str`** — deterministic template, no LLM. Greets by `band.contact_name` or `band.name` first token, falls back to `"there"`. Asks for the five fields Laura needs.

**`decide_next_action(s, band, thread) → ReplyDecision`** — the LLM-driven follow-up engine. Two Haiku calls:
1. **Stage detection** with `STAGE_DETECT_PROMPT`. Five stages: `new_lead`, `collecting_details`, `negotiating_terms`, `pending_confirmation`, `confirmed`. Returns approval signal yes/no with confidence.
2. **Draft generation** with `SYSTEM_PROMPT` (venue rules: 2-3hr sets, BYO PA, electronic drums preferred, etc.) plus the full thread context. Generates ≤500 tokens of Laura-voiced reply.

**Approval guard:** approval signals are only meaningful once we've actually sent the band something. On the very first inbound (no prior outbound on the thread), `approval_allowed=False` and the engine forces a reply rather than jumping straight to "approved."

### 5.7 `api.py`

The FastAPI app. See §8.1 for the endpoint reference. The API is lazy about loading the email provider — endpoints that don't touch Gmail (everything under `/bands/:id/thread`, `/profile`, draft CRUD up to `send`) work fine even if `GMAIL_TOKEN_JSON` is missing.

### 5.8 `main.py` + `scripts/`

- `main.py` is the worker entry point. APScheduler runs `pipeline.ingest_message` over the provider's `fetch_new_messages` output every `POLL_INTERVAL_SECONDS` (default 120).
- `scripts/entrypoint.sh` branches on `ROLE` (`api` default, `worker` for the worker service).
- `scripts/start_api.sh` runs `alembic upgrade head` then `uvicorn`.
- `scripts/start_worker.sh` runs `alembic upgrade head` then `python -m lookout_agent.main`.
- `scripts/gmail_oauth.py` is the one-off browser OAuth flow (run via `make oauth`).

---

## 6. The database

Postgres 18 (Railway's current version). All schema lives in `db/alembic/versions/`. Migrations run automatically on agent container start; you do not need to invoke alembic manually after a deploy.

### 6.1 Migrations

| Rev | File | Adds |
|---|---|---|
| 0001 | `0001_initial.py` | `bands`, `band_emails`, `email_threads`, `messages`, `drafts`, `gigs`, `roster_entries`, `notes`, `templates`, `attachments`, `ignored_messages`, `agent_runs`, `provider_cursors`. Enums: `band_status`, `archive_reason`, `conversation_stage`, `classification`, `draft_status`, `draft_created_by`, `message_direction`, `note_author`, `agent_run_trigger`. |
| 0002 | `0002_thread_continuity_and_stage.py` | Thread continuity columns + initial `conversation_stage` wiring. |
| 0003 | `0003_band_insights.py` | `bands.insights` JSONB, `bands.insights_updated_at`. |
| 0004 | `0004_band_profile.py` | `bands.w9_name`, `bands.bio`, `bands.social_links` JSONB. Powers the roster Profile tab. |
| **0005** | **`0005_message_summary.py`** ✨ | **`messages.summary` text. One-line LLM summary used for the card preview; falls back to `messages.snippet` when null.** |

### 6.2 Key tables (most-used columns)

**`bands`**
- `id` UUID PK, `name`, `contact_name`, `primary_email` CITEXT unique
- `status` (`incoming`/`in_conversation`/`approved`/`archived`), `on_roster` bool
- `conversation_stage` (`new_lead`/`collecting_details`/`negotiating_terms`/`pending_confirmation`/`confirmed`)
- `draft_ready` bool, `needs_review` bool
- `w9_name`, `bio`, `social_links` JSONB array of `{label, url}`
- `insights` JSONB cache, `insights_updated_at` (tied to last message time for cache validity)
- `first_contact_at`, `last_activity_at`

**`band_emails`** — many-to-one with `bands`. Lets one band have multiple sender addresses without duplicating rows. CITEXT email unique.

**`email_threads`** — one row per `(provider, provider_thread_id)`. `first_message_at`/`last_message_at` drive recency.

**`messages`** — every inbound and outbound message. `provider_message_id` unique. `internet_message_id` + `in_reply_to` headers used for thread fallback matching. `summary` (NEW), `snippet`, `body_text`, `body_html`. `auto_sent` flags messages the agent sent itself (the first-reply auto-send).

**`drafts`** — pending replies. `provider_draft_id` is `"local:<uuid>"` for dashboard-only drafts (the common case — long Gmail Drafts folders are bad UX). `created_by` distinguishes `agent` vs `human` drafts (the dashboard uses this to decide whether to show the "AI suggestion" pill).

**`ignored_messages`** — non-band inbound that we logged but never showed Laura. Keeps the classifier auditable and prevents re-classification.

**`provider_cursors`** — one row per provider; stores the Gmail History API cursor between worker ticks.

### 6.3 Local seed data

`db/seed_fake_bands.sql` populates three approved bands with full profile data + threads. **Local only** — never run against Railway.

```bash
docker exec -i lookout_db psql -U lookout -d lookout < db/seed_fake_bands.sql
```

---

## 7. The dashboard

Next.js 14 (App Router) + React 18 + Tailwind + `@dnd-kit/core`. Single password gate on a middleware.

### 7.1 Pages

- `/login` — single-password form. Sets an HMAC-signed session cookie (`dashboard/lib/auth.ts`). Cookie `secure` flag is gated on `NODE_ENV === 'production'` so local HTTP works.
- `/kanban` — the main board. Server component fetches `/api/bands`; client-side `KanbanBoard.tsx` does the rendering + drag-and-drop + thread panel.
- Middleware (`dashboard/middleware.ts`) gates everything except `/login` and its API friends.

### 7.2 Components

**`KanbanBoard.tsx`** — three columns, each a `useDroppable` zone. Cards are `useDraggable`. Drag highlights the target column with a soft accent ring. Drop fires `PATCH /api/bands/:id/status`. Stale cards (no activity in 14+ days) get reduced opacity. SWR polls `/api/bands` every few seconds for live updates.

**`BandCard.tsx`** — two render modes:
- `ApprovedCard` for `status=approved`: shows roster pill, "needs reply" pill if last message is inbound, and (NEW) an amber **"incomplete profile — add a band name"** banner when `band.name` is blank.
- `FullCard` for other statuses: shows stage pill, `draft`/`review`/`needs reply` pills, expandable insights panel, last-message preview using `summary` if present (via `decodeSnippet` which strips HTML entities like `&#39;`).

Both cards have a unified `CardActions` overlay (top-right): forward-arrow to move to the next status, trash icon to delete. Clicking the body opens the thread panel.

**`ThreadPanel.tsx`** — slide-in side panel, two tabs (`Thread` and `Profile`, the latter only on approved bands).

Thread tab features:
- Message bubbles with **quoted-text collapse**: `splitBody` finds the first `On ... wrote:` attribution or `>`-prefixed line and tucks the historical quote behind a "show quoted text" toggle. Less visual noise on long threads.
- **AI suggestion prefill**: if a pending agent-authored draft exists, the compose box auto-fills with its body and an amber "AI suggestion — edit before sending" pill appears. The first manual edit clears the pill.
- **30-second Undo banner** with a "Send now" button to short-circuit the wait. The undo control sits inside the word-count line, not on a separate banner.
- Draft routing: if an AI draft existed, send issues `PATCH /api/drafts/:id` to update its body and then `POST /drafts/:id/send`. Otherwise it issues `POST /api/bands/:id/drafts` then `POST /drafts/:id/send`. Either way, no orphan or duplicate Gmail draft is created.

Profile tab features (approved bands only):
- Read view: name, contact, email, W-9 name, bio, social links (icons inferred from hostname).
- Edit mode: click pencil → fields become inputs, sticky Save bar at the bottom of the panel. PATCHes `/api/bands/:id/profile`.

### 7.3 The dashboard ↔ data split

- **Reads** (list bands, fetch a thread, fetch a profile) go from Next.js route handlers straight to Postgres via `dashboard/lib/db.ts` (`pg.Pool`). Fast, no extra hop.
- **Writes that touch email** (send a draft, fetch current mailbox identity) go to the agent API via `dashboard/lib/agentApi.ts`. The agent owns the Gmail side.
- **Profile edits** and **status drags** are DB-only — they write directly from the dashboard route. No Gmail involvement.
- **Draft body updates and creation** are DB-only as well (drafts are local-only in our schema until `/send` actually fires).

This split is intentional: you can pop the dashboard open against any Postgres and the read-only surface works without the agent running. Only email-mutating actions require agent-api to be up.

---

## 8. HTTP API reference

### 8.1 Agent API (FastAPI, `agent/src/lookout_agent/api.py`)

Base URL is `AGENT_API_URL` for the dashboard, or the Railway URLs in §2.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness probe. Always `{"ok": true}` if the process is up. Does not touch DB or Gmail. |
| `GET` | `/mailbox` | Returns `{email, provider}` for the mailbox the OAuth token resolves to. Used by the dashboard to confirm "you're looking at the staging/production inbox." 503 if Gmail unavailable. |
| `GET` | `/bands/:id/thread` | Full thread (subject + messages array, ordered ASC by `sent_at`). |
| `GET` | `/bands/:id/insights` | Cached `BandInsights` JSON (genre, fee_range, social_links, key_facts, etc.). Triggers a refresh if cache is stale. |
| `GET` | `/bands/:id/profile` | Full profile (name, contact_name, primary_email, w9_name, bio, social_links, on_roster, status, updated_at). |
| `PATCH` | `/bands/:id/profile` | Update any subset of `{name, contact_name, w9_name, bio, social_links}`. Returns the new profile. |
| `POST` | `/bands/:id/drafts` | Create a new dashboard-only draft (Laura started from scratch). Body: `{body_text}`. Returns the `DraftOut`. **Never writes to Gmail's Drafts folder.** |
| `PATCH` | `/drafts/:id` | Update a pending draft's body in place. Body: `{body_text}`. Used when Laura edits an AI suggestion before sending. 400 if `status != pending`. |
| `POST` | `/drafts/:id/send` | Send a pending draft as a real outbound message. Sets `In-Reply-To`/`References` to the last inbound. Persists a new outbound `messages` row, flips draft `status` to `sent`, clears `band.draft_ready`. |

### 8.2 Dashboard API (Next.js route handlers, `dashboard/app/api/`)

| Method | Path | Backed by |
|---|---|---|
| `POST` | `/api/login` | HMAC cookie issuance against `DASHBOARD_PASSWORD`. |
| `POST` | `/api/logout` | Clears the session cookie. |
| `GET` | `/api/mailbox` | Proxies agent's `/mailbox`. |
| `GET` | `/api/bands` | Direct DB read: every band + lateral-join its latest message (`COALESCE(m.summary, m.snippet)` as `last_snippet`). |
| `GET` | `/api/bands/:id` | Direct DB read: single band row. |
| `PATCH` | `/api/bands/:id` | Direct DB write: arbitrary band field updates (rarely used; profile uses the dedicated route). |
| `PATCH` | `/api/bands/:id/status` | Direct DB write: drag-and-drop and the next-step button hit this. |
| `GET` | `/api/bands/:id/thread` | Direct DB read: thread + messages + `pending_draft` (latest pending draft for the thread, if any). |
| `GET` | `/api/bands/:id/profile` | Proxies agent's profile GET. |
| `PATCH` | `/api/bands/:id/profile` | Proxies agent's profile PATCH. |
| `GET` | `/api/bands/:id/insights` | Proxies agent's insights GET. |
| `POST` | `/api/bands/:id/drafts` | Proxies agent's `POST /bands/:id/drafts`. |
| `PATCH` | `/api/drafts/:id` | Proxies agent's `PATCH /drafts/:id`. |
| `POST` | `/api/drafts/:id/send` | Proxies agent's `POST /drafts/:id/send`. |

---

## 9. Local dev quick start

Prereqs: Docker, Python 3.11+, Node 20+.

```bash
# 1) Bring up local Postgres on :5434
make db.up

# 2) Install agent + run migrations
make agent.install
make db.migrate

# 3) One-time Gmail OAuth (opens a browser)
#    Drop your OAuth client JSON at agent/secrets/gmail_client.json first.
#    Log in as the Gmail account you want this dev shell to read/send from
#    (typically tanaymehta1705@gmail.com — your test inbox).
make oauth

# 4) Copy env files and fill in ANTHROPIC_API_KEY
cp .env.example .env
cp agent/.env.example agent/.env

# 5) Run the worker (polls every 2 min) OR the API
make agent.dev   # worker (poll loop)
make agent.api   # FastAPI on :8000

# 6) In another terminal, run the dashboard
cd dashboard
npm install
npm run dev      # localhost:3000
```

`dashboard/.env.local`:

```
DATABASE_URL=postgresql://lookout:lookout@localhost:5434/lookout
AGENT_API_URL=http://localhost:8000
DASHBOARD_PASSWORD=local
DASHBOARD_SESSION_SECRET=any-32-byte-hex-or-just-a-long-string
```

Optional local seed:

```bash
docker exec -i lookout_db psql -U lookout -d lookout < db/seed_fake_bands.sql
```

---

## 10. Deploying

Both environments use the same `railway up --ci` flow against the same three services. Always pass `--environment` explicitly.

```bash
# Deploy to staging (your test inbox: tanaymehta1705@gmail.com)
railway environment staging
railway up --service agent-api    --ci
railway up --service agent-worker --ci
railway up --service dashboard    --ci

# Deploy to production (the live booking inbox: lookoutfarm.bookings@gmail.com)
railway environment production
railway up --service agent-api    --ci
railway up --service agent-worker --ci
railway up --service dashboard    --ci
```

**Why three services every time:** `agent-api` and `agent-worker` share one Docker image but run different entrypoints, so any change inside `agent/` requires redeploying both. Dashboard is its own image and ships independently, but in practice we ship all three together to keep them in lockstep.

**Migrations** run automatically on container start. Add a migration to `db/alembic/versions/` and it applies the next time `agent-api` boots in that environment.

**Promotion is just a second `railway up`** to the production environment — there is no image-promotion step. The build is identical; only env vars and Postgres differ.

---

## 11. Environment variables

### 11.1 Both agent services (`agent-api`, `agent-worker`)

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Auto-linked from the env's Postgres. `postgresql://` is auto-rewritten to `postgresql+psycopg://` by `config._normalize_db_url`. |
| `ANTHROPIC_API_KEY` | ✅ | Same key on prod and staging is fine. Used by classifier, summarizer, insights, reply engine. |
| `GMAIL_CLIENT_JSON` | ✅ | Full OAuth client JSON as a single string (overrides `gmail_client_secrets` file path when set). |
| `GMAIL_TOKEN_JSON` | ✅ | Full refresh-token JSON as a single string (overrides `gmail_token_path`). Re-mint with `make oauth`. |
| `GMAIL_USER_EMAIL` | ✅ | The inbox the token belongs to. `lookoutfarm.bookings@gmail.com` for production, `tanaymehta1705@gmail.com` for staging. |
| `RAILWAY_DOCKERFILE_PATH` | ✅ | `agent/Dockerfile`. |
| `ROLE` | worker only | Set to `worker` on `agent-worker`; defaults to `api`. |
| `EMAIL_PROVIDER` | optional | `gmail` (default). Reserved for the future `graph` value. |
| `POLL_INTERVAL_SECONDS` | optional | `120` (worker only). |
| `STALE_CARD_DAYS` | optional | `14` (worker only). |
| `AUTO_REPLY_ENABLED` | optional | `true` by default. Set to `false` on staging if you want pure read-only ingestion (no auto-send, no AI drafts). |

### 11.2 `dashboard`

| Var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Auto-linked from the env's Postgres. Used directly by dashboard reads. |
| `AGENT_API_URL` | ✅ | Public URL of the `agent-api` in the same environment (one of the two Railway URLs in §2). |
| `RAILWAY_DOCKERFILE_PATH` | ✅ | `dashboard/Dockerfile`. |
| `DASHBOARD_PASSWORD` | ✅ | Single shared password. `password` on staging; rotated value on production. |
| `DASHBOARD_SESSION_SECRET` | ✅ | 32-byte hex. Signs the session cookie. Rotate to invalidate live sessions. |

---

## 12. Common operations

```bash
# Stream live logs (per env)
railway environment staging
railway logs --service agent-worker
railway logs --service agent-api
railway logs --service dashboard

# Set an env var
railway variables --service agent-api --set "KEY=value"

# Set a long value (JSON token, etc.) on both agent services in one go
TOKEN=$(cat agent/secrets/gmail_token.json)
railway variables --service agent-api    --set "GMAIL_TOKEN_JSON=$TOKEN"
railway variables --service agent-worker --set "GMAIL_TOKEN_JSON=$TOKEN"

# Open a psql session against the current env's Postgres
docker run --rm -it postgres:18 \
  psql "$(railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL | cut -d= -f2-)"

# Snapshot prod data into staging (rare; resets staging to look like prod)
PROD=$(railway environment production && railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL | cut -d= -f2-)
STG=$( railway environment staging    && railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL | cut -d= -f2-)
docker run --rm postgres:18 pg_dump --no-owner --no-acl --no-comments --clean --if-exists "$PROD" \
  | docker run --rm -i postgres:18 psql -v ON_ERROR_STOP=1 "$STG"

# Tail the transition log only (great for debugging status changes)
railway logs --service agent-worker | grep -E "STATUS|REPLY_ENGINE|AUTO_SENT|PROFILE_BACKFILL"
```

> Use Postgres **18** for `pg_dump` / `psql` — Railway is on Postgres 18 and older client versions abort with "server version mismatch."

---

## 13. Rotating credentials

**Gmail OAuth token expired** (worker logs show auth errors): re-mint locally and reupload.

```bash
rm -f agent/secrets/gmail_token.json
# IMPORTANT: log in as the right account for the target environment.
#   production → lookoutfarm.bookings@gmail.com
#   staging    → tanaymehta1705@gmail.com
make oauth

railway environment <production|staging>
TOKEN=$(cat agent/secrets/gmail_token.json)
railway variables --service agent-api    --set "GMAIL_TOKEN_JSON=$TOKEN"
railway variables --service agent-worker --set "GMAIL_TOKEN_JSON=$TOKEN"
```

Hot-reloads in ~30s. No redeploy needed.

**Dashboard password / session secret:**

```bash
railway variables --service dashboard --set "DASHBOARD_PASSWORD=<new>"
# Optional: also rotate the secret to invalidate live sessions
railway variables --service dashboard --set "DASHBOARD_SESSION_SECRET=$(openssl rand -hex 32)"
```

---

## 14. Repo layout

```
agent/
  src/lookout_agent/
    api.py                  FastAPI routes (mailbox, bands/thread, profile,
                            insights, drafts, drafts/:id/send)
    main.py                 Worker poll loop entry point
    pipeline.py             Ingestion + classification + reply orchestration
    classifier.py           3-tier inbound classifier (rules → keywords → LLM)
    summarizer.py           ✨ One-line LLM message summaries for card previews
    insights.py             AI-extracted band metadata cache + profile backfill
    reply_engine.py         First-reply template + multi-turn LLM follow-up engine
    config.py               Pydantic Settings + URL normalizer
    email/
      __init__.py           get_provider() factory
      provider.py           Abstract EmailProvider + NormalizedMessage
      gmail.py              Gmail implementation (sets In-Reply-To / References)
    db/
      models.py             SQLAlchemy models (Band, Message, Draft, …)
      session.py            Session factory + session_scope context manager
      enums.py              BandStatus, ConversationStage, Classification, …
  scripts/
    entrypoint.sh           Branches on ROLE → start_api.sh or start_worker.sh
    start_api.sh            alembic upgrade head → uvicorn
    start_worker.sh         alembic upgrade head → python -m lookout_agent.main
    gmail_oauth.py          One-off browser OAuth flow
  Dockerfile

db/
  alembic/
    versions/               Migrations 0001 … 0005
    env.py                  Loads URL from env; rewrites driver
  seed_fake_bands.sql       LOCAL-ONLY seed for design preview

dashboard/
  app/
    api/
      bands/                GET /bands, /bands/:id, PATCH /bands/:id,
                            PATCH /bands/:id/status, GET /bands/:id/thread,
                            GET+PATCH /bands/:id/profile,
                            GET /bands/:id/insights,
                            POST /bands/:id/drafts
      drafts/[id]/          PATCH /drafts/:id (update body)
      drafts/[id]/send/     POST /drafts/:id/send → agent
      login/  logout/  mailbox/
    kanban/                 Main board (server component)
    login/                  Login page
    globals.css             Design tokens + animations
  components/
    KanbanBoard.tsx         Columns, drag-and-drop (@dnd-kit), card grid,
                            thread panel mount, SWR refresh
    BandCard.tsx            Card body — ApprovedCard + FullCard variants,
                            CardActions overlay, incomplete-profile pill,
                            HTML-entity decoded preview
    ThreadPanel.tsx         Side panel, Thread/Profile tabs, quoted-text
                            collapse, AI-suggestion prefill, Undo+Send-now
    BandProfile.tsx         Profile read + edit modes
  lib/
    db.ts                   pg Pool wrapper
    agentApi.ts             Fetch wrapper to the agent API
    auth.ts                 HMAC session cookie sign/verify
    types.ts                Shared TS types (BandRow, BandProfile, DraftRow…)
  middleware.ts             Edge middleware — gates everything except /login & friends
  Dockerfile                Multi-stage Next build
```

---

## 15. Working with Claude Code on this repo

When you tag a Claude Code session into this project, here's what the agent already knows from memory:

- The two-environment setup (production + staging) and the URLs and Gmail accounts of each (see §2).
- The "deploy" command translates to **the three-service triplet** for whichever env you name. Default to production if you say "ship it" / "deploy to the main site" without qualification. Say "deploy to staging" / "push to staging" to target the test env.
- Always pass `--environment` explicitly to `railway up`. Never rely on the CLI's remembered default for production.
- Staging dashboard password is `password`. Production password is whatever you set at handoff — not in this repo.
- The fake-data seed file (`db/seed_fake_bands.sql`) is local-only. Never run it against Railway.
- Migrations run automatically on agent container start — do not invoke alembic manually after a deploy.
- The reply-threading fix (`In-Reply-To` / `References`) lives in `agent/src/lookout_agent/email/gmail.py:_build_raw`. Don't regress it.
- Drafts in this system are **dashboard-only** by default (`provider_draft_id = "local:<uuid>"`). Don't push every draft into Gmail's Drafts folder — long threads would clog Laura's inbox.
- The summarizer model is Haiku (`claude-haiku-4-5-20251001`). Classifier is Sonnet (`claude-sonnet-4-20250514`). Reply engine + insights extractor are Haiku. Don't swap models without a reason.

If something here drifts from reality, **fix this README first**, then change the code. The README is the contract.
