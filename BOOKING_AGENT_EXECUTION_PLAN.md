# Booking Agent Execution Plan

## Objective

Make the email booking agent reliably continue conversations across long threads and automate Kanban status movement with the exact rule:

- Keep `incoming` unchanged on outbound sends.
- Move `incoming` -> `in_conversation` only when a new inbound message arrives on a thread that already has at least one prior outbound message.
- Move to `approved` based on confirmation intent (date is not required).

---

## Locked Business Rules

### 1) Status transitions

1. `incoming` + `outbound_sent` -> `incoming` (no movement)
2. `incoming` + `inbound_received` + no prior outbound on thread -> `incoming`
3. `incoming` + `inbound_received` + prior outbound exists on thread -> `in_conversation`
4. `in_conversation` + any inbound/outbound -> `in_conversation`
5. `in_conversation` + strong confirmation signal -> `approved`
6. `approved` remains `approved` for future thread chatter unless manually changed

### 2) Approval rule

Approval does not require date finalization.

Approve when conversation clearly indicates acceptance/green light to move forward, and no obvious blocking language is present.

### 3) Conversation stage model usage

Conversation stages are internal-only (agent decision logic), not Kanban columns.

Use stages to guide reply strategy:
- `new_lead`
- `collecting_details`
- `negotiating_terms`
- `pending_confirmation`
- `confirmed`

---

## Execution Phases

## Phase 0: Instrumentation and visibility (safe, first)

### Goals
- See exactly why thread continuity breaks.
- Track status transition reasons.

### Actions
- Add structured logging around each ingested message:
  - `provider_message_id`
  - `provider_thread_id`
  - direction
  - matched `band_id`
  - prior outbound count on thread
  - status before/after
- Add one "transition_reason" enum/string in logs and optional DB audit table.
- Add counters:
  - unlinked inbound messages
  - fallback-linked messages
  - auto status transitions
  - approval candidates vs approvals

### Acceptance
- Every processed message can be traced to a status decision.

---

## Phase 1: Correct status engine (your required behavior)

### Goals
- Implement the missing movement exactly as specified.

### Actions
- In ingestion path for inbound messages:
  - determine if thread currently has any prior outbound message.
  - if band status is `incoming` and prior outbound exists, set status to `in_conversation`.
- Ensure outbound handlers do **not** transition `incoming` to `in_conversation`.
- Keep manual status API route unchanged for overrides.

### Acceptance
- Sending first outbound does not move the card.
- First inbound reply after outbound moves card to `in_conversation` automatically.

---

## Phase 2: Thread continuity hardening

### Goals
- Continue conversation indefinitely with no dropped turns.

### Actions
- Keep primary linkage by `provider_thread_id`.
- Add fallback linking chain for edge cases:
  1. `In-Reply-To` -> existing message `internet_message_id`
  2. `References` chain matching (if available)
  3. sender email + active band/thread window heuristic
- Introduce an internal message-thread map for quick repair lookup.
- Add a reconciliation job:
  - scan for unlinked messages
  - relink where confidence is high
  - flag ambiguous cases for review

### Acceptance
- Long threads (8+ turns) stay attached to same band timeline.
- No silently dropped inbound replies.

---

## Phase 3: Multi-turn reply loop (beyond first auto-ack)

### Goals
- Agent keeps conversation moving until approval/handoff.

### Actions
- For every new inbound in active bands, run reply planner:
  1. intent detect (question/negotiation/acceptance/rejection/logistics)
  2. slot tracking (fees, format, constraints, optional date state)
  3. stage update (`collecting_details`, `negotiating_terms`, etc.)
  4. next action select:
     - draft reply
     - auto-send reply (if confidence/rules permit)
     - needs human review
- Ensure generated replies reference latest user ask and preserve tone.
- Add anti-repetition checks across prior assistant messages in thread.

### Acceptance
- Agent can carry conversation across multiple back-and-forth turns.
- Clear fallback to human review on uncertainty.

---

## Phase 4: Confirmation detection and approval automation

### Goals
- Move `in_conversation` -> `approved` with conservative confidence controls.

### Decision rubric
- Positive signals:
  - "approved", "book them", "move forward", "you are in", "let's proceed"
- Blocking signals:
  - "maybe", "need to check", unresolved concerns, explicit uncertainty

### Actions
- Build score-based detector (deterministic first).
- Thresholds:
  - high confidence: auto approve
  - medium confidence: keep `in_conversation`, mark `needs_review`
  - low confidence: no approval action
- Persist approval rationale for auditability.

### Acceptance
- Clear confirmations auto-approve.
- Ambiguous confirmations do not auto-approve.

---

## Phase 5: Board behavior and UX consistency

### Goals
- Board reflects backend decisions automatically.

### Actions
- Continue polling existing bands API.
- Add optional badges in card/detail views:
  - `needs_review`
  - `approval_candidate`
  - `awaiting_reply`
- Ensure column rendering is driven strictly by `bands.status`.

### Acceptance
- Status changes appear on board automatically without manual refresh issues.

---

## Implementation Order (File-level, high priority)

1. `agent/src/lookout_agent/pipeline.py`
   - status transition logic rewrite for inbound-triggered move only
   - outbound transition removal for `incoming -> in_conversation`
2. `agent/src/lookout_agent/email/gmail.py`
   - thread fallback support (`In-Reply-To`/`References`) extraction and helpers
3. `agent/src/lookout_agent/db/models.py` + migration(s)
   - optional audit/decision fields and review flags
4. `agent/src/lookout_agent/main.py`
   - metrics/logs and optional reconciliation hook
5. API + dashboard routes/components
   - expose review/approval metadata in board/thread views

---

## Test Plan

1. New lead inbound -> status `incoming`
2. Agent/human outbound -> still `incoming`
3. Lead inbound reply on same thread -> auto `in_conversation`
4. Continue thread 6-10 turns -> all messages linked, no drops
5. Strong approval message -> auto `approved`
6. Ambiguous approval-like message -> remains `in_conversation` + review flag

---

## Rollout Strategy

1. Ship Phase 1 with logs first (safe behavior fix).
2. Observe for 24-48 hours with real traffic.
3. Ship continuity hardening (Phase 2).
4. Enable multi-turn auto-reply in guarded mode (Phase 3).
5. Enable approval automation with conservative threshold (Phase 4).

---

## Definition of Done

- Status movement behavior matches locked rule exactly.
- Agent continues thread reliably across long email chains.
- Approval can happen without date requirement.
- Board updates automatically based on backend transitions.
- Logs/metrics explain every automated decision.
