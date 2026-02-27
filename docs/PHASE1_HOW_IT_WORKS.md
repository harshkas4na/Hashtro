# Phase 1: Agent API Keys — How It Works

This document explains the agent API key system from first principles.
No prior knowledge of authentication systems is assumed.

---

## The Problem

An AI agent like OpenClaw needs to call Hastrology APIs to read your horoscope signal
(e.g., "trade SOL LONG with 3× leverage"). But the agent can't sign Solana transactions
on your behalf — and it shouldn't. We want the agent to **read** signals; you still
**approve** trades in the app. How does the agent prove it's acting for you?

---

## The Solution: API Keys

An API key is a long random string — think of it like a password generated for a specific
purpose. You generate one in the app, paste it into your agent platform once, and from
then on the agent sends that key with every request. The backend checks it and knows
which wallet the request belongs to.

**Key properties:**

| Property | Value |
|---|---|
| Format | `hstro_sk_` + 48 random base62 chars |
| Example | `hstro_sk_V2f8kLm3Qr9...` (57 chars total) |
| Entropy | ~285 bits — brute-force infeasible |
| Stored | SHA-256 hash only (never the raw key) |

The `hstro_sk_` prefix makes keys instantly recognizable (same idea as `sk_live_` in
Stripe or `ghp_` in GitHub Personal Access Tokens).

---

## Why SHA-256 Hashing?

If someone compromised our database, they should not be able to use the stolen data to
impersonate users. So we hash the key before storing it — exactly like we hash passwords.

SHA-256 is a one-way function:
- `SHA256("hstro_sk_V2f8...") → "a3f9b2c1..."` — easy to compute
- `"a3f9b2c1..." → "hstro_sk_V2f8..."` — computationally infeasible to reverse

When an agent sends a key, we compute `SHA256(key)` and look it up in the database.
The raw key never touches disk.

The key has 256+ bits of entropy, so even with a fast GPU, brute-forcing a single hash
would take longer than the age of the universe.

---

## What Was Built

### New database table: `agent_api_keys`

```
id             UUID     — unique row identifier
key_hash       TEXT     — SHA-256 of the raw key (indexed for fast lookups)
key_prefix     TEXT     — first 13 chars of the raw key for display ("hstro_sk_V2f8")
wallet_address TEXT     — which user owns this key
label          TEXT     — human name e.g. "OpenClaw" or "My Test Agent"
created_at     TIMESTAMPTZ
last_used_at   TIMESTAMPTZ — updated on each successful auth (fire-and-forget)
revoked        BOOLEAN  — set to true to permanently invalidate the key
```

### New files

| File | What it does |
|---|---|
| `src/services/apikey.service.js` | Generate, validate, list, and revoke keys |
| `src/middleware/agentAuth.middleware.js` | Express middleware — validates Bearer token |
| `src/controllers/agent.controller.js` | HTTP handlers for the three endpoints |
| `src/routes/agent.routes.js` | Route definitions with rate limiters |

### New API endpoints

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/agent/keys` | Generate a key (body: `walletAddress`, `label`) |
| `GET` | `/api/agent/keys/:walletAddress` | List keys for a wallet (masked) |
| `DELETE` | `/api/agent/keys/:keyId` | Revoke a key (body: `walletAddress`) |

---

## End-to-End Request Flow

```
1.  User opens app → clicks "Generate Agent Key"

2.  App → POST /api/agent/keys
          { walletAddress: "Abc123...", label: "OpenClaw" }

3.  Backend:
      random  = 48 random base62 chars
      rawKey  = "hstro_sk_" + random          ← shown to user ONCE
      hash    = SHA256(rawKey)                 ← stored in DB
      prefix  = rawKey.slice(0, 13)            ← stored for display

4.  User copies rawKey → pastes into OpenClaw settings

5.  OpenClaw → GET /api/agent/signal
               Authorization: Bearer hstro_sk_V2f8kLm3...

6.  agentAuth middleware:
      rawKey = header.slice("Bearer ".length)
      hash   = SHA256(rawKey)
      row    = DB.lookup(hash)
      if !row || row.revoked → 401
      req.agentWallet = row.wallet_address
      (async) DB.update last_used_at = NOW()

7.  Controller runs with req.agentWallet set → returns signal
```

---

## How to Test with curl

### 1. Generate a key

```bash
curl -X POST http://localhost:5001/api/agent/keys \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "YOUR_SOLANA_WALLET", "label": "Test Agent"}'
```

Response:
```json
{
  "success": true,
  "key": "hstro_sk_V2f8kLm3...",
  "keyPrefix": "hstro_sk_V2f8",
  "id": "uuid-here",
  "message": "Save this key — it will not be shown again."
}
```

### 2. List keys (masked — safe to display in UI)

```bash
curl http://localhost:5001/api/agent/keys/YOUR_SOLANA_WALLET
```

Response:
```json
{
  "success": true,
  "keys": [
    {
      "id": "uuid-here",
      "key_prefix": "hstro_sk_V2f8",
      "label": "Test Agent",
      "created_at": "2026-02-28T10:00:00Z",
      "last_used_at": null,
      "revoked": false
    }
  ]
}
```

### 3. Use a key in a request

```bash
curl -H "Authorization: Bearer hstro_sk_V2f8kLm3..." \
     http://localhost:5001/api/agent/signal
# → 404 (route not yet defined in Phase 2) — NOT 401 means auth passed ✓
```

### 4. Revoke a key

```bash
curl -X DELETE http://localhost:5001/api/agent/keys/uuid-here \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "YOUR_SOLANA_WALLET"}'
```

### 5. Confirm revoked key is rejected

```bash
curl -H "Authorization: Bearer hstro_sk_V2f8kLm3..." \
     http://localhost:5001/api/agent/signal
# → 401 Invalid or revoked API key ✓
```

---

## Security Notes

- The raw key is returned exactly once during generation. After that, it's gone — not
  even we can retrieve it.
- `last_used_at` is updated asynchronously (fire-and-forget). A failed update does not
  block the request.
- Revocation is permanent. To re-enable an agent, generate a new key.
- Rate limits: key generation uses `authLimiter` (20 req / 15 min); list and revoke
  use `generalLimiter` (100 req / 15 min).
- The `agentAuth` middleware never reveals whether a key exists vs. is revoked — both
  return the same 401 message to prevent enumeration.

---

## What's Next

- **Phase 2**: `/api/agent/signal` endpoint — returns today's horoscope trade signal
  in machine-readable JSON for the authenticated agent wallet.
- **Phase 8**: Frontend key management UI (generate / list / revoke from the app).
