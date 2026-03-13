# Hastrology Agent Quickstart

Build an AI agent that reads a user's astrological trading signal and recommends trades — no wallet access needed.

**Base URL:** `https://api.hashtro.fun/api`
**OpenAPI spec:** `GET /api/openapi.json` | **Swagger UI:** `GET /api/docs`

---

## Prerequisites

The user whose signal you want to read must:
1. Have a Hastrology account with birth details set (dob, birth time, birth place)
2. Generate an API key and give it to you

---

## Step 1 — User generates an API key

The user visits **hashtro.fun/agent** and clicks "Generate Key". They give the key a label (e.g. "MyBot") and copy the raw key shown in the modal — it looks like:

```
hstro_sk_V2f8kLm3nQpXwYzA9bCdEfGhJiK0oRsT1uVw2xYz
```

This key is shown exactly once. They paste it into your agent configuration. You're now authorized to act on their behalf.

---

## Step 2 — Get the trading signal

```bash
curl https://api.hashtro.fun/api/agent/signal \
  -H "Authorization: Bearer hstro_sk_V2f8kLm3nQpXwYzA9bCdEfGhJiK0oRsT1uVw2xYz"
```

**Response:**
```json
{
  "success": true,
  "wallet_address": "AbCdEf...1234",
  "date": "2026-02-28",
  "horoscope_ready": true,
  "should_trade": true,
  "already_verified": false,
  "direction": "LONG",
  "asset": "Solana",
  "ticker": "SOL-PERP",
  "leverage_suggestion": 5,
  "leverage_max": 10,
  "power_hour": "3–4 PM UTC",
  "luck_score": 78,
  "vibe_status": "Ascending",
  "zodiac_sign": "Aries",
  "time_lord": "Mars",
  "has_warning": false,
  "warning_text": null,
  "rationale": "Mars as Time Lord with Jupiter trine amplifies momentum trades...",
  "should_trade": true,
  "trade_attempts_today": 0,
  "max_retries": 2,
  "can_retry": true,
  "last_trade_attempt_at": null,
  "trade_url": "https://hashtro.fun/cards"
}
```

### Reading the signal

| Field | How to use it |
|---|---|
| `should_trade` | `false` → skip today. `true` → consider a trade. |
| `direction` | `"LONG"` or `"SHORT"` |
| `ticker` | Which perpetual to trade (e.g. `"SOL-PERP"`) |
| `leverage_suggestion` | Start here. Already capped at 5x (or 3x if `has_warning`) |
| `leverage_max` | Hard cap — never exceed this |
| `power_hour` | Best entry window (local to user's timezone) |
| `luck_score` | 0–100. >50 = bullish bias. Higher = stronger signal. |
| `has_warning` | `true` → use half position size or skip |
| `already_verified` | `true` → today's signal already confirmed profitable, no need to trade again |
| `can_retry` | `false` → max retries reached for today, stop |
| `trade_url` | Send this link to the user so they can execute the trade in the app |

### Common states

```
should_trade: false, already_verified: true  → won today, done
should_trade: false, luck_score: null        → horoscope not generated yet (call again)
should_trade: true,  can_retry: false        → max retries hit, stop for today
has_warning: true                            → trade with caution, reduce size
```

---

## Step 3 — Direct the user to execute

Your agent should **never sign trades** — the user signs in the app. Send them the `trade_url`:

```
📡 Your signal for today: LONG SOL-PERP @ 5x leverage
⚡ Power hour: 3–4 PM UTC
🔗 Execute here: https://hashtro.fun/cards
```

The user opens the link, reviews their horoscope card, and signs the trade with their wallet.

---

## Step 4 — Record the trade attempt

Call this immediately after the user confirms a trade has been sent on-chain (before knowing profit/loss). This keeps the signal state accurate for retry logic.

```bash
curl -X POST https://api.hashtro.fun/api/agent/trade-attempt \
  -H "Authorization: Bearer hstro_sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "txSig": "5KtGhJ...",
    "direction": "LONG",
    "leverage": 5,
    "asset": "SOL-PERP"
  }'
```

**Response:**
```json
{
  "success": true,
  "recorded": true,
  "trade_attempts_today": 1,
  "last_trade_attempt_at": "2026-02-28T15:03:22Z",
  "max_retries": 2,
  "can_retry": true,
  "message": "Trade attempt recorded. Call POST /api/horoscope/verify once you know the P&L."
}
```

---

## Step 5 — Verify a profitable trade (optional)

If the user's trade was profitable, verify it to "unlock" the horoscope. This is done by the user or app — agents don't need to call this directly.

```bash
curl -X POST https://api.hashtro.fun/api/horoscope/verify \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "AbCdEf...1234",
    "txSig": "5KtGhJ...",
    "pnlPercent": 4.8
  }'
```

---

## Webhooks (push instead of poll)

Instead of calling `/signal` repeatedly, register a webhook URL and receive push events.

### Register

```bash
curl -X POST https://api.hashtro.fun/api/agent/webhook \
  -H "Authorization: Bearer hstro_sk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-agent.com/hooks/hastrology",
    "events": ["horoscope_ready", "trade_verified"]
  }'
```

**Response:**
```json
{
  "success": true,
  "webhook_id": "uuid-...",
  "secret": "whsec_AbCdEf...",
  "message": "Save this secret — it will not be shown again."
}
```

Save the `secret`. You'll need it to verify incoming payloads.

### Verify incoming payloads

Every webhook POST includes an `X-Hastrology-Signature` header:

```
X-Hastrology-Signature: sha256=abc123...
```

Verify it in your handler:

```python
import hmac, hashlib

def verify_signature(payload_bytes: bytes, header: str, secret: str) -> bool:
    expected = "sha256=" + hmac.new(
        secret.encode(), payload_bytes, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, header)
```

```javascript
const crypto = require('crypto');

function verifySignature(payloadBuffer, header, secret) {
    const expected = 'sha256=' + crypto
        .createHmac('sha256', secret)
        .update(payloadBuffer)
        .digest('hex');
    return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(header)
    );
}
```

### Payload format

```json
{
  "event": "horoscope_ready",
  "timestamp": "2026-02-28T06:00:00Z",
  "wallet_address": "AbCdEf...1234",
  "data": {
    "date": "2026-02-28",
    "direction": "LONG",
    "ticker": "SOL-PERP",
    "luck_score": 78
  }
}
```

```json
{
  "event": "trade_verified",
  "timestamp": "2026-02-28T15:10:00Z",
  "wallet_address": "AbCdEf...1234",
  "data": {
    "verified": true,
    "pnl_percent": 4.8
  }
}
```

### List / delete webhooks

```bash
# List
curl https://api.hashtro.fun/api/agent/webhooks \
  -H "Authorization: Bearer hstro_sk_..."

# Delete
curl -X DELETE https://api.hashtro.fun/api/agent/webhook/WEBHOOK_ID \
  -H "Authorization: Bearer hstro_sk_..."
```

---

## Key management

```bash
# List your keys (masked — no raw key returned)
curl https://api.hashtro.fun/api/agent/keys/WALLET_ADDRESS

# Revoke a key
curl -X DELETE https://api.hashtro.fun/api/agent/keys/KEY_ID \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "WALLET_ADDRESS"}'
```

---

## Rate limits

| Endpoint | Limit |
|---|---|
| `GET /agent/signal` | 60 requests / hour / key |
| `POST /agent/trade-attempt` | 60 requests / hour / key |
| Webhook endpoints | 30 requests / hour / key |
| Key generation | 10 requests / hour |

When you hit a limit you get `429` with:
```json
{ "error": "rate_limit_exceeded", "retry_after": 3600 }
```

---

## Error reference

| Status | Meaning | Action |
|---|---|---|
| `401` | Invalid or revoked API key | Check key; ask user to generate a new one |
| `404` | User not found or no horoscope | Call `/signal` first to auto-generate |
| `409` | Already verified today | Skip — `already_verified: true` in `/signal` |
| `422` | Birth details not set | User must complete profile at hashtro.fun |
| `429` | Rate limit hit | Wait `retry_after` seconds |
| `503` | AI server unavailable | Retry in a few minutes |
| `504` | Horoscope generation timed out | Retry once |

---

## Full daily loop (Python)

```python
import httpx

API_BASE = "https://api.hashtro.fun/api"
KEY = "hstro_sk_..."
HEADERS = {"Authorization": f"Bearer {KEY}"}

def daily_loop():
    # 1. Get signal
    r = httpx.get(f"{API_BASE}/agent/signal", headers=HEADERS)
    r.raise_for_status()
    signal = r.json()

    if not signal["should_trade"]:
        print(f"Skip today: already_verified={signal['already_verified']}, can_retry={signal['can_retry']}")
        return

    if signal["has_warning"]:
        print(f"Warning: {signal['warning_text']} — reducing size")

    # 2. Send user the trade link
    print(f"Signal: {signal['direction']} {signal['ticker']} @ {signal['leverage_suggestion']}x")
    print(f"Execute: {signal['trade_url']}")

    # 3. After user confirms trade on-chain, record the attempt
    tx_sig = input("Enter txSig after trade is sent: ").strip()
    if tx_sig:
        r = httpx.post(
            f"{API_BASE}/agent/trade-attempt",
            headers=HEADERS,
            json={
                "txSig": tx_sig,
                "direction": signal["direction"],
                "leverage": signal["leverage_suggestion"],
                "asset": signal["ticker"],
            },
        )
        r.raise_for_status()
        result = r.json()
        print(f"Attempt {result['trade_attempts_today']}/{result['max_retries']} recorded")

if __name__ == "__main__":
    daily_loop()
```

---

## Webhook-driven loop (Node.js / Express)

```javascript
const express = require('express');
const crypto = require('crypto');
const app = express();

app.use(express.raw({ type: 'application/json' }));

const WEBHOOK_SECRET = 'whsec_AbCdEf...'; // saved from registration

app.post('/hooks/hastrology', (req, res) => {
    const sig = req.headers['x-hastrology-signature'];
    const expected = 'sha256=' + crypto
        .createHmac('sha256', WEBHOOK_SECRET)
        .update(req.body)
        .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return res.sendStatus(401);
    }

    const event = JSON.parse(req.body);

    if (event.event === 'horoscope_ready') {
        const { direction, ticker, luck_score } = event.data;
        console.log(`New signal: ${direction} ${ticker} (score ${luck_score})`);
        // notify user, post to Telegram, etc.
    }

    if (event.event === 'trade_verified') {
        const { pnl_percent } = event.data;
        console.log(`Trade verified! PnL: ${pnl_percent}%`);
    }

    res.sendStatus(200);
});

app.listen(3000);
```
