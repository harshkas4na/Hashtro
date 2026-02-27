# AI Agent Integration — Everything You Need to Know

This document is a complete learning resource for building AI agent support into Hastrology. It explains every concept from first principles so you can build and reason about the system yourself.

---

## Part 1: What Is an AI Agent?

An AI agent is a program that takes actions autonomously on behalf of a user — it doesn't just answer questions, it *does things*. Instead of a user opening the app, reading their horoscope, deciding to trade, signing the transaction, and checking the result, an agent does all of those steps with zero human involvement per step.

The user's role shifts from *doing* to *setting up and reviewing*. They connect the agent once, give it permission, and it runs the loop automatically every day.

### The Agent Loop

Every agent, regardless of what it does, runs the same basic pattern:

```
Observe → Decide → Act → Report
```

For Hastrology + OpenClaw, this looks like:

```
1. OBSERVE  → Check if today's horoscope exists
2. OBSERVE  → If not, generate it
3. DECIDE   → Read luck_score. >50 = LONG, ≤50 = SHORT
4. DECIDE   → Read power_hour. Wait until that time window
5. ACT      → Execute trade on Flash (SOL perp, correct direction, safe leverage)
6. REPORT   → Call /api/horoscope/verify with trade result
7. REPORT   → Notify user: "Verified ✓ (+12%)" or "Unverified ✗ (-3%). Retry?"
```

Every step in this loop maps directly to an API call on your backend.

---

## Part 2: How Agents Talk to APIs

### REST APIs (What Hastrology Uses)

Your backend is a standard REST API. Agents talk to it exactly like a browser does — HTTP requests with JSON. The only difference is the agent has no human waiting for a response; it handles the result in code.

An agent doing step 1 looks like this in pseudocode:

```python
response = GET "https://api.hastrology.xyz/api/horoscope/status?walletAddress=ABC123"
data = parse_json(response)

if data.status == "exists":
    horoscope = data.card
else:
    # generate it first
```

### Authentication: The API Key Problem

Your current API has **no authentication**. Any program can call any endpoint with any wallet address. That's fine during development but has two problems for agents:

1. **Security**: A bad actor can call `/api/horoscope/confirm` for anyone's wallet address and rack up AI generation costs on your server.
2. **Identity**: When OpenClaw calls your API, how do you know it's acting for a legitimate user and not just scraping?

**The solution is API keys.** Here's how they work:

```
User logs into Hastrology app
  → clicks "Connect Agent"
  → backend generates a random secret key: "hstro_sk_a1b2c3d4..."
  → stores it in the database linked to their wallet address
  → user copies the key and pastes it into OpenClaw

OpenClaw stores the key
  → every API call includes: Authorization: Bearer hstro_sk_a1b2c3d4...
  → your backend looks up which wallet owns that key
  → proceeds as if the user made the call
```

The agent never needs to know the wallet address — the key carries that identity.

**What an API key looks like in code:**

```
Header: Authorization: Bearer hstro_sk_a1b2c3d4e5f6...
```

On the backend, you add a middleware that:
1. Reads the `Authorization` header
2. Strips the `Bearer ` prefix
3. Looks up the key in a `agent_api_keys` table in Supabase
4. Sets `req.walletAddress = found_wallet` for the rest of the request

### Polling vs Webhooks

There are two ways an agent can know when something happens:

**Polling** — the agent repeatedly asks "is it done yet?":
```
every 30 seconds:
    GET /api/horoscope/status
    if status == "exists": proceed
```
Simple to build. Slightly wasteful on API calls.

**Webhooks** — your server calls the agent when something happens:
```
Agent registers: POST /api/agent/webhook { url: "https://openclaw.xyz/callback/user123" }

Later, when horoscope is generated:
    YOUR SERVER → POST https://openclaw.xyz/callback/user123 { event: "horoscope_ready", card: {...} }
```
More complex but more efficient. The agent doesn't need to poll at all.

For v1, polling is fine. Webhooks are a nice-to-have for v2.

---

## Part 3: The Signing Problem — The Hardest Part

This is the most important thing to understand about building agents on Solana.

### Why Signing Matters

Every Solana transaction must be signed with a private key. This is how the network knows "this wallet owner actually authorized this action." Without a signature, no trade can happen.

The problem: **a private key is a 64-byte secret that gives total control over a wallet.** If you give an agent your private key, it can drain your entire wallet. This is obviously unacceptable.

So how do agents trade on your behalf without holding your private key?

### Solution A: Session Keys (Recommended for Hastrology)

Session keys are temporary, limited-scope signing keys. Instead of giving the agent your real private key, you create a *child key* that can only do specific things for a limited time.

**How it works conceptually:**
```
User: "I authorize this session key to:
  - Open positions on Flash protocol only
  - Spend max 0.5 SOL total
  - Expire in 24 hours"

System generates a session key pair
User signs this authorization with their real wallet (one time, in the app)
Session key is handed to the agent

Agent uses session key to sign trades → network accepts them as authorized
After 24 hours, session key expires → agent can't do anything
```

**How to implement with Privy (which you already use):**

Privy has a feature called "server wallets" and "delegated actions" that handles exactly this. The flow:

1. User connects wallet via Privy (already done)
2. User clicks "Authorize Agent" in the app
3. Privy creates a session key scoped to specific program IDs and spending limits
4. Privy stores the session key securely on their servers
5. Your backend gets a `sessionToken` it can use to sign transactions on the user's behalf
6. You pass that `sessionToken` to the agent (via your API, not directly to the user)

The agent calls your backend: "execute trade for wallet ABC"
Your backend uses the stored session key to sign the Flash transaction
Trade executes on-chain
Agent gets the `txSig` back

**The key insight:** The agent never touches the signing key. Only your backend does. The agent just calls your API.

### Solution B: Hybrid Flow (Works Today, No Code Changes)

The agent reads the horoscope and tells the user what to do. The user approves and signs in the app. The agent polls for the trade result.

```
Agent → reads horoscope signal
Agent → sends push notification to user: "Today: LONG SOL, leverage 5x, window 3-4 PM"
User  → opens app, sees pre-filled trade form
User  → taps "Execute" (signs with their wallet)
Trade → executes on-chain
Agent → polls /api/horoscope/status, sees trade result
Agent → reports back to user
```

This is less autonomous but ships in days, not weeks. Good for v1.

### Solution C: Managed Sub-Wallet (Avoid Unless Necessary)

User deposits funds into a Hastrology-controlled wallet. Hastrology holds the private key and trades on behalf of users. This makes you a custodian, which brings regulatory complexity and a central security risk. Avoid this unless Solutions A or B are impossible.

---

## Part 4: Understanding the Horoscope Card as a Trading Signal

The card the AI generates already has everything an agent needs to make a trading decision. Here's the exact field mapping:

```
Card Field              →  Agent Uses It As
────────────────────────────────────────────────────────
luck_score (0-100)      →  trade direction threshold
                             >50  = LONG
                             ≤50  = SHORT
                             Very low (<20) or very high (>90) = strong signal
                             Around 50 (45-55) = weak signal, smaller size

vibe_status             →  confidence level
  "Stellar" (80-100)    →  high confidence LONG
  "Ascending" (51-79)   →  moderate confidence LONG
  "Shaky" (40-50)       →  moderate confidence SHORT
  "Eclipse" (0-39)      →  high confidence SHORT

lucky_assets.ticker     →  which token to trade (e.g. "SOL", "BTC", "ETH")
lucky_assets.max_leverage → cap leverage here, never exceed this
lucky_assets.power_hour →  best time window ("3-4 PM" = enter between 3-4 PM IST)

back.shadow_warning     →  risk flag — agent should read this and be more conservative
back.remedy             →  if not null, cosmic warning is active — consider skipping
```

**Example agent decision logic:**

```python
card = get_horoscope(wallet)

luck = card["front"]["luck_score"]
ticker = card["back"]["lucky_assets"]["ticker"]
max_lev = card["back"]["lucky_assets"]["max_leverage"]
has_warning = card["back"]["remedy"] is not None

# Direction
direction = "LONG" if luck > 50 else "SHORT"

# Position size (scale with luck score distance from 50)
confidence = abs(luck - 50) / 50  # 0.0 to 1.0
base_amount = 0.1  # SOL
trade_amount = base_amount * (0.5 + confidence * 0.5)  # 0.05 to 0.1 SOL

# Leverage (conservative if warning exists)
leverage = min(max_lev, 3 if has_warning else 5)

# Execute
execute_flash_trade(ticker, direction, trade_amount, leverage)
```

---

## Part 5: The Verify/Unverify Loop

This is the core mechanic that makes Hastrology meaningful. A horoscope is a *prediction* — "the stars say LONG today." If the trade is profitable, the prediction was correct → **verified**. If it loses money → **unverified**.

### The Verification Flow

```
Trade executes → get txSig + pnlPercent from Flash SDK

if pnlPercent > 0:
    POST /api/horoscope/verify { walletAddress, txSig, pnlPercent: 5.2 }
    → horoscope.verified = true
    → tell user: "✓ Horoscope Verified! +5.2% on SOL"

if pnlPercent < 0:
    (don't call verify — the endpoint rejects negative pnl anyway)
    → horoscope.verified = false (stays false)
    → tell user: "✗ Horoscope Unverified. Trade lost 2.1%. Try again?"
```

### The Retry Question

When a trade loses, should the agent retry? This requires a policy decision:

**Option 1 — No retry:** One trade per horoscope per day. If it loses, that's the horoscope's prediction for the day. User is informed, no action taken.

**Option 2 — User-prompted retry:** Agent asks the user. "The first trade lost. Your luck score is 73 — the stars still say LONG. Want me to try again with a smaller position?" User approves or declines.

**Option 3 — Automatic retry with degraded parameters:** If trade 1 fails, agent retries automatically with half the position size and reduced leverage. Max 2-3 retries per day.

The tracking for this requires a new field on the horoscope row: `trade_attempts` (int). The agent increments this each time it tries. If `trade_attempts >= max_retries`, agent stops and reports final unverified status.

---

## Part 6: OpenAPI / Agent Discovery

For agents like OpenClaw to integrate with Hastrology automatically (without a human writing custom code), your API needs to be **machine-discoverable**. This means publishing an OpenAPI spec.

An OpenAPI spec is a JSON/YAML file that describes every endpoint, every field, every error code. Tools like OpenClaw can read it and automatically know how to call your API.

**What it looks like (simplified):**

```yaml
openapi: 3.0.0
info:
  title: Hastrology Agent API
  version: 1.0.0
paths:
  /api/agent/signal:
    get:
      summary: Get today's trading signal for a user
      parameters:
        - name: Authorization
          in: header
          required: true
      responses:
        200:
          content:
            application/json:
              schema:
                properties:
                  should_trade: { type: boolean }
                  direction: { type: string, enum: [LONG, SHORT] }
                  asset: { type: string }
                  leverage: { type: integer }
```

Tools like Swagger UI auto-generate interactive documentation from this spec.

---

## Part 7: Rate Limiting for Agents

Agents run code in loops. Without limits, a buggy agent could call your API thousands of times per minute, crashing your server or racking up AI costs.

Your backend already has rate limiting (`generalLimiter`, `strictLimiter`). For agent keys specifically, you want:

- **Per-key rate limiting**: Each API key gets its own quota (e.g., 100 requests/hour)
- **Endpoint-specific limits**: Signal endpoint can be called often; horoscope generation is expensive and should be limited to 1/day per user
- **Limit headers in response**: Tell the agent how many requests it has left:
  ```
  X-RateLimit-Limit: 100
  X-RateLimit-Remaining: 87
  X-RateLimit-Reset: 1709123456
  ```
  A well-behaved agent reads these and backs off automatically.

---

## Part 8: Idempotency — Handling Failures Safely

Networks fail. An agent might send a trade request, the response times out, and the agent doesn't know if the trade executed or not. If it retries, it might execute two trades when only one was intended.

**Idempotency** is the solution: if you call an endpoint twice with the same request, the result is the same as calling it once.

For horoscope generation, it's already idempotent — if today's horoscope exists, `/api/horoscope/confirm` returns the existing one instead of generating a new one. Good.

For trading, you need the `txSig` (transaction signature) as the idempotency key. Each transaction on Solana has a unique signature. Your `/api/horoscope/verify` endpoint already uses `txSig` — so calling verify twice with the same sig is safe.

---

## Part 9: Notification Delivery

When the agent finishes (verified or not), it needs to notify the user. Options:

**Telegram Bot** — Most common for crypto agents. User connects their Telegram to the service; agent sends a message via Telegram Bot API when done.

**Discord Webhook** — Same idea, for Discord servers.

**Push Notification** — If the user has the Hastrology mobile app, a push notification (via Firebase/APNs).

**In-app notification** — User opens the app and sees the result. Polling or WebSocket connection.

**Email** — Least real-time but simplest to implement.

For OpenClaw, the agent platform handles notification delivery — your job is just to give OpenClaw the result data (verified: true/false, pnlPercent, direction) and it handles telling the user in their preferred channel.

---

## Part 10: The Complete Mental Model

Put it all together:

```
┌─────────────────────────────────────────────────────────────┐
│                    USER SETUP (one time)                     │
│  1. Register on Hastrology (wallet + birth details)          │
│  2. Click "Connect Agent" → get API key                      │
│  3. Authorize session key (sign once to allow agent trades)  │
│  4. Paste API key into OpenClaw                              │
│  5. Set preferences: max spend per day, retry policy         │
└─────────────────────────────────────────────────────────────┘
                            ↓ every day at 6 AM
┌─────────────────────────────────────────────────────────────┐
│                   AGENT DAILY LOOP                           │
│  1. GET /api/agent/signal → { direction, asset, power_hour } │
│  2. If no horoscope yet: POST /api/horoscope/confirm         │
│  3. Wait until power_hour window                             │
│  4. Execute Flash trade (via session key through backend)    │
│  5. POST /api/horoscope/verify { txSig, pnlPercent }         │
│  6. Notify user with result                                  │
│  7. If unverified + retries allowed: ask user or auto-retry  │
└─────────────────────────────────────────────────────────────┘
```

---

## Glossary

| Term | Meaning |
|---|---|
| API Key | A secret string that identifies an agent acting on behalf of a user |
| Session Key | A temporary signing key scoped to specific on-chain actions |
| Webhook | Your server proactively calling the agent's URL with event data |
| Polling | Agent repeatedly asking your server "anything new?" |
| idempotency | Property of an operation that can safely be repeated without changing the result |
| pnlPercent | Profit and Loss percentage from a trade (positive = profit, negative = loss) |
| txSig | Transaction signature — unique ID of a Solana transaction |
| Flash SDK | The perpetual trading SDK used for executing trades |
| Profection | Astrological timing technique that drives the Time Lord calculation |
| luck_score | AI-generated 0-100 score that determines trade direction |
| verified | Status of a horoscope after a profitable trade confirms the prediction |
| CDO | Cosmic Data Object — the structured astronomical data fed to the AI |
