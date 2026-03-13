# AI Agent Integration — Implementation Tracker

**Purpose:** This file tracks every piece of the AI agent integration plan. When working on this feature, check this file first to know what is done, what is in progress, and what comes next. After completing any task, mark it `[x]`.

**Last updated:** 2026-02-27
**Overall status:** Phase 0 complete → Phase 1 not started

---

## How to Use This File

- `[x]` = Done and verified
- `[ ]` = Not started
- `[~]` = In progress
- `[!]` = Blocked — reason noted inline

When you finish a task, change `[ ]` to `[x]` and add a brief note of what file/commit the work lives in.

---

## Current System State (What Already Exists)

These things work today and agents can already use them.

### Existing APIs

- [x] `GET /api/horoscope/status?walletAddress=X` — returns `{ status, card, verified, date }` — `horoscope.routes.js:13`
- [x] `POST /api/horoscope/confirm { walletAddress }` — generates card (currently free) — `horoscope.routes.js:24`
- [x] `POST /api/horoscope/verify { walletAddress, txSig, pnlPercent }` — marks horoscope verified on profit — `horoscope.routes.js:33`
- [x] `GET /api/horoscope/history/:walletAddress` — full horoscope history — `horoscope.routes.js:48`
- [x] `POST /api/user/register` — user registration with birth details — `user.routes.js:19`
- [x] `GET /api/user/profile/:walletAddress` — user profile — `user.routes.js:55`

### Trading Signal Already in Card (No Changes Needed)

- [x] `luck_score` (0-100) maps to direction: >50 = LONG, ≤50 = SHORT — `senior_astrologer_prompt.py:123`
- [x] `vibe_status` maps to confidence: Stellar/Ascending = bull, Shaky/Eclipse = bear — `response_models.py:29`
- [x] `lucky_assets.ticker` — which asset to trade — `response_models.py:16`
- [x] `lucky_assets.max_leverage` — leverage cap — `response_models.py:17`
- [x] `lucky_assets.power_hour` — best time window for entry — `response_models.py:18`
- [x] `back.remedy` — non-null means extra caution today — `response_models.py:52`

### Database Schema (What Exists in Supabase)

- [x] `horoscopes` table has `verified` boolean column — `horoscope.service.js:202`
- [x] `users` table has wallet_address, dob, birth_time, birth_place, lat/long, timezone — `CLAUDE.md`
- [ ] `agent_api_keys` table — does not exist yet
- [ ] `trade_attempts` column on `horoscopes` — does not exist yet
- [ ] `agent_webhooks` table — does not exist yet

---

## Phase 1: Agent Authentication (API Keys)

**Goal:** Any agent can authenticate as a specific user without knowing their private key or wallet.
**Blocking:** All other phases depend on this. Build first.

### 1.1 Database

- [ ] Create `agent_api_keys` table in Supabase with columns:
  - `id` (uuid, primary key)
  - `key_hash` (text, unique) — store bcrypt hash of the key, never plaintext
  - `key_prefix` (text) — first 8 chars for display (e.g. `hstro_sk_a1b2c3d4...`)
  - `wallet_address` (text, FK → users.wallet_address)
  - `label` (text) — user-given name e.g. "OpenClaw"
  - `created_at` (timestamptz)
  - `last_used_at` (timestamptz)
  - `revoked` (boolean, default false)
  - Add this SQL to `backend_server/src/database/schema.sql`

### 1.2 Backend: Key Generation

- [ ] Create `backend_server/src/services/apikey.service.js`
  - `generateKey(walletAddress, label)` — creates key, hashes it, stores in DB, returns plaintext key once
  - `validateKey(rawKey)` — looks up prefix, compares hash, returns walletAddress or null
  - `revokeKey(keyId, walletAddress)` — sets revoked = true if owned by wallet
  - `listKeys(walletAddress)` — returns all keys (prefix + label + created_at, never hash)

- [ ] Create `backend_server/src/routes/agent.routes.js`
  - `POST /api/agent/keys` — generate a new API key (body: `{ walletAddress, label }`)
  - `GET /api/agent/keys/:walletAddress` — list all keys for wallet
  - `DELETE /api/agent/keys/:keyId` — revoke a key

- [ ] Create `backend_server/src/middleware/agentAuth.middleware.js`
  - Reads `Authorization: Bearer hstro_sk_...` header
  - Validates key via `apikey.service.js`
  - Sets `req.agentWallet` for downstream handlers
  - Returns 401 with clear error if key is missing, invalid, or revoked

- [ ] Register agent routes in `backend_server/src/routes/index.js`

### 1.3 Frontend: Key Management UI

- [ ] Add "Agent Keys" section to user settings or profile page
  - [ ] "Generate New Key" button — shows key once with copy button, warns it will never be shown again
  - [ ] List of active keys (prefix + label + created date)
  - [ ] Revoke button per key

---

## Phase 2: Agent Signal Endpoint

**Goal:** Give agents a single endpoint that returns a clean, machine-readable trading decision. No parsing needed.
**Depends on:** Phase 1 (API key auth)

### 2.1 Endpoint Design

Response shape:
```json
{
  "wallet_address": "ABC123...",
  "date": "2026-02-27",
  "horoscope_ready": true,
  "already_verified": false,
  "should_trade": true,
  "direction": "LONG",
  "asset": "SOL",
  "ticker": "SOL",
  "leverage_suggestion": 5,
  "leverage_max": 10,
  "power_hour": "3-4 PM",
  "luck_score": 78,
  "vibe_status": "Ascending",
  "has_warning": false,
  "warning_text": null,
  "rationale": "Mercury in your 10th house profection year...",
  "trade_attempts_today": 0,
  "max_retries": 2
}
```

### 2.2 Implementation

- [ ] Add `GET /api/agent/signal` to `agent.routes.js`
  - Requires `agentAuth` middleware (Authorization header)
  - Internally calls `horoscopeService.getHoroscope(walletAddress)`
  - If no horoscope today → generates one automatically (calls `aiService.generateHoroscope`)
  - Maps card fields to signal fields (see field mapping in `AI_AGENT_INTEGRATION_GUIDE.md` Part 4)
  - Returns structured signal response

- [ ] Create `backend_server/src/controllers/agent.controller.js`
  - `getSignal(req, res)` — orchestrates signal generation
  - `listKeys(req, res)` — list API keys
  - `generateKey(req, res)` — create new key
  - `revokeKey(req, res)` — revoke a key

- [ ] Add signal mapping logic in `agentController.getSignal`:
  - `should_trade = !already_verified && luck_score !== null`
  - `direction = luck_score > 50 ? "LONG" : "SHORT"`
  - `has_warning = card.back.remedy !== null`
  - `leverage_suggestion = has_warning ? Math.min(3, max_leverage) : Math.min(5, max_leverage)`

### 2.3 Testing

- [ ] Test with curl: `curl -H "Authorization: Bearer hstro_sk_..." https://api.hastrology.xyz/api/agent/signal`
- [ ] Verify response when no horoscope exists (auto-generates)
- [ ] Verify response when horoscope already exists (returns existing)
- [ ] Verify response when already verified (should_trade = false)

---

## Phase 3: Retry Tracking

**Goal:** Track how many times an agent has tried to trade today, so we can enforce retry limits and give accurate state to agents.
**Depends on:** Phase 1

### 3.1 Database

- [ ] Add `trade_attempts` column to `horoscopes` table (integer, default 0)
- [ ] Add `last_trade_attempt_at` column to `horoscopes` table (timestamptz, nullable)
- [ ] Add migration SQL to `backend_server/src/database/schema.sql`

### 3.2 Backend

- [ ] Update `horoscopeService.verifyHoroscope()` to also increment `trade_attempts`
- [ ] Add `horoscopeService.recordTradeAttempt(walletAddress)` — increments `trade_attempts`, updates `last_trade_attempt_at`
- [ ] Add `POST /api/agent/trade-attempt` endpoint — agent calls this when a trade executes (before knowing profit/loss), to record the attempt
  - Body: `{ txSig, direction, leverage, asset }`
  - Records attempt so retry count is accurate even if verify call fails

- [ ] Update `/api/agent/signal` response to include:
  - `trade_attempts_today` — from `horoscopes.trade_attempts`
  - `max_retries` — config value (start with 2)
  - `can_retry` — boolean: `trade_attempts_today < max_retries && !already_verified`

### 3.3 Retry Policy Config

- [ ] Add to backend environment config:
  - `AGENT_MAX_RETRIES_PER_DAY=2`
  - `AGENT_MIN_POSITION_MULTIPLIER=0.5` — retry trades use half position size

---

## Phase 4: Delegated Trade Execution (Session Keys)

**Goal:** Backend can execute Flash trades on behalf of users without agents or users signing each transaction.
**Depends on:** Phases 1, 2
**Note:** This is the hardest phase. Start with Phase 5 (webhook) first if you want quicker wins.

### 4.1 Research / Decision

- [ ] Read Privy docs on server-side wallet actions and delegated signing
- [ ] Decide: Privy session keys vs managed sub-wallet vs hybrid (agent advises, user signs)
- [ ] Document the chosen approach in this file before starting implementation

### 4.2 Session Key Storage (if using Privy sessions)

- [ ] Add `session_token` and `session_expires_at` columns to `users` table
- [ ] Add `POST /api/agent/authorize` endpoint — user calls this from app to grant session key
  - Frontend signs authorization via Privy
  - Backend stores session token securely
  - Returns `{ authorized: true, expires_at: "..." }`

### 4.3 Backend Trade Execution

- [ ] Create `backend_server/src/services/trade.service.js`
  - `executeTrade({ walletAddress, direction, asset, leverage, amountSol })` — uses stored session key to sign + send Flash transaction
  - `closeTrade({ walletAddress, positionKey })` — closes an open position
  - Returns `{ txSig, pnlPercent, success: bool }`

- [ ] Add `POST /api/agent/trade` endpoint
  - Requires agentAuth middleware
  - Body: `{ direction, asset, leverage, amount_sol }`
  - Calls `tradeService.executeTrade()`
  - On success, calls `horoscopeService.recordTradeAttempt()`
  - Returns `{ txSig, direction, asset, pnlPercent }`

### 4.4 Auto-Verify After Trade

- [ ] In `tradeService.executeTrade()`, after getting result:
  - If `pnlPercent > 0` → call `horoscopeService.verifyHoroscope(walletAddress)`
  - If `pnlPercent < 0` → do not verify, just record attempt

---

## Phase 5: Webhook Notifications

**Goal:** Your server pushes results to agents instead of agents polling.
**Depends on:** Phase 1
**Priority:** Can be built in parallel with Phase 4.

### 5.1 Database

- [ ] Create `agent_webhooks` table:
  - `id` (uuid)
  - `api_key_id` (uuid, FK → agent_api_keys.id)
  - `wallet_address` (text)
  - `url` (text) — the agent's callback URL
  - `secret` (text) — used to sign webhook payloads so agent can verify authenticity
  - `events` (text[]) — which events to receive: `["horoscope_ready", "trade_verified", "trade_failed"]`
  - `created_at` (timestamptz)
  - `active` (boolean)

### 5.2 Webhook Registration

- [ ] Add `POST /api/agent/webhook` endpoint (requires agentAuth)
  - Body: `{ url, events: ["horoscope_ready", "trade_verified"] }`
  - Backend generates a webhook secret (random 32 bytes)
  - Stores webhook in DB
  - Returns `{ webhook_id, secret }` — user stores secret to verify incoming payloads

- [ ] Add `DELETE /api/agent/webhook/:webhookId` — deregisters webhook

### 5.3 Webhook Delivery

- [ ] Create `backend_server/src/services/webhook.service.js`
  - `deliver(walletAddress, event, payload)` — looks up registered webhooks for this wallet, sends HTTP POST to each URL
  - Signs payload with webhook secret: `X-Hastrology-Signature: sha256=...`
  - Retries up to 3 times with exponential backoff on failure
  - Logs delivery success/failure

- [ ] Add webhook delivery calls in:
  - `horoscopeController.confirm()` — emit `horoscope_ready` event after generating card
  - `horoscopeController.verify()` — emit `trade_verified` event when verified
  - `tradeService.executeTrade()` (Phase 4) — emit `trade_failed` when loss

### 5.4 Webhook Payload Format

```json
{
  "event": "trade_verified",
  "timestamp": "2026-02-27T15:42:00Z",
  "wallet_address": "ABC123...",
  "data": {
    "verified": true,
    "pnl_percent": 5.2,
    "direction": "LONG",
    "asset": "SOL",
    "tx_sig": "def456..."
  }
}
```

---

## Phase 6: OpenAPI Spec + Agent Documentation

**Goal:** Any agent platform (OpenClaw or others) can auto-discover and call Hastrology APIs.
**Depends on:** Phases 1, 2 complete

### 6.1 OpenAPI Spec

- [ ] Install `swagger-jsdoc` and `swagger-ui-express` in `backend_server`
- [ ] Add JSDoc OpenAPI annotations to all agent routes (`agent.routes.js`)
- [ ] Add JSDoc annotations to existing horoscope and user routes
- [ ] Serve Swagger UI at `GET /api/docs`
- [ ] Serve raw OpenAPI JSON at `GET /api/openapi.json`

### 6.2 Agent Quickstart Guide

- [ ] Create `docs/AGENT_QUICKSTART.md` — step by step: get API key → call signal → execute trade → verify
- [ ] Add curl examples for every endpoint
- [ ] Add example Python script showing full daily loop
- [ ] Add example for OpenClaw specifically (if they have an integration format)

---

## Phase 7: Rate Limiting for Agents

**Goal:** Prevent buggy or malicious agents from abusing the API.
**Depends on:** Phase 1 (need API keys to rate limit per-key)

- [ ] Add per-key rate limiting using `express-rate-limit` with Redis store (or in-memory for start)
  - Signal endpoint: 60 requests/hour per key
  - Horoscope generation: 1 per day per wallet (already enforced by DB unique constraint, but add explicit rate limit error message)
  - Trade endpoint: 5 per day per wallet
  - Key management: 10 per hour per wallet

- [ ] Add rate limit headers to all agent endpoint responses:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset` (Unix timestamp)

- [ ] Return `429 Too Many Requests` with body:
  ```json
  { "error": "rate_limit_exceeded", "retry_after": 3600, "message": "1 horoscope per day per wallet" }
  ```

---

## Phase 8: Frontend Agent Dashboard

**Goal:** Users can manage their agent connections from the Hastrology app.
**Depends on:** Phase 1 backend complete

- [ ] Create new route `/agent` in `frontend/app/`
- [ ] Component: API key generation and listing
  - [ ] "Generate Key" button with label input
  - [ ] One-time key reveal modal (shows full key once, copy button)
  - [ ] Active keys list (prefix, label, created date, last used)
  - [ ] Revoke button per key
- [ ] Component: Session key authorization
  - [ ] "Authorize Agent Trading" button
  - [ ] Shows what permissions are being granted (max spend, duration)
  - [ ] Calls `POST /api/agent/authorize` after Privy wallet sign
  - [ ] Shows active authorization status and expiry
- [ ] Component: Agent activity feed
  - [ ] Recent agent actions (horoscope fetched at 6:03 AM, trade executed at 3:14 PM)
  - [ ] Pulled from `GET /api/agent/activity`
- [ ] Component: Webhook management
  - [ ] Register webhook URL
  - [ ] List active webhooks
  - [ ] Test webhook button (sends a test ping)

---

## Build Order Recommendation

Build phases in this order. Each phase is independently testable:

```
Phase 1 (API Keys)       → FIRST. Everything else needs auth.
Phase 2 (Signal API)     → Quick win. Agents can already read + decide with this.
Phase 3 (Retry Tracking) → Small addition. Helps agents know their state.
Phase 5 (Webhooks)       → Can build in parallel with Phase 4. Lower complexity.
Phase 4 (Trade Execution)→ Hardest. Needs session key research first.
Phase 7 (Rate Limiting)  → Add after Phase 2 is working in production.
Phase 6 (OpenAPI)        → Documentation, add alongside Phase 2-3.
Phase 8 (Frontend)       → Build alongside each backend phase as it lands.
```

---

## Open Decisions (Not Yet Made)

| Decision | Options | Recommendation |
|---|---|---|
| How agents sign trades | Privy session keys / Hybrid (user signs) / Managed wallet | Start hybrid for v1; add Privy session keys in v2 |
| Max retries per day | 1 / 2 / 3 / unlimited | 2 retries, half position size each time |
| When to auto-generate horoscope | Agent calls signal → auto-generates | Auto-generate on first signal call of the day |
| Webhook retry on failure | 0 / 3 / 5 retries | 3 retries with exponential backoff |
| API key format | Random UUID / Prefixed `hstro_sk_...` | Prefixed for easy identification |
| Session key duration | 1h / 8h / 24h / 7d | 24h, renewed daily when user opens app |

---

## Files To Create (Summary)

| File | Phase | Status |
|---|---|---|
| `backend_server/src/database/schema.sql` (update) | 1, 3, 5 | [ ] |
| `backend_server/src/services/apikey.service.js` | 1 | [ ] |
| `backend_server/src/middleware/agentAuth.middleware.js` | 1 | [ ] |
| `backend_server/src/routes/agent.routes.js` | 1, 2, 5 | [ ] |
| `backend_server/src/controllers/agent.controller.js` | 2 | [ ] |
| `backend_server/src/services/webhook.service.js` | 5 | [ ] |
| `backend_server/src/services/trade.service.js` | 4 | [ ] |
| `frontend/app/agent/page.tsx` | 8 | [ ] |
| `docs/AGENT_QUICKSTART.md` | 6 | [ ] |

---

## Files To Modify (Summary)

| File | Change | Phase | Status |
|---|---|---|---|
| `backend_server/src/routes/index.js` | Register agent routes | 1 | [ ] |
| `backend_server/src/controllers/horoscope.controller.js` | Emit webhooks after generate/verify | 5 | [ ] |
| `backend_server/src/services/horoscope.service.js` | Add `recordTradeAttempt()`, `verifyHoroscope()` update | 3 | [ ] |
| `backend_server/src/middleware/rateLimiter.js` | Add per-key agent rate limits | 7 | [ ] |
| `frontend/app/layout.tsx` or nav | Add Agent link | 8 | [ ] |
