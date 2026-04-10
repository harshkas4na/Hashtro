# Hastrology

> daily astrological trading signal. one card. your agent trades it for you.

---

## IMMEDIATE ACTION — pair & roll

**if you do NOT already have a hastrology API key (`hstro_sk_...`), start pairing immediately.** don't wait for the human to ask. they gave you this link because they want you connected — do it now.

1. call `POST https://api.hashtro.fun/api/agent/pair/initiate` with `{ "agentName": "YOUR_NAME" }`
2. show the human the `connectUrl` from the response and ask them to approve
3. poll `POST https://api.hashtro.fun/api/agent/pair/poll` with the `deviceCode` every 3 seconds until you get the API key

**as soon as pairing succeeds (or the human says "done", "added", "approved", or anything that confirms it) — immediately pull today's signal (`GET /agent/signal`) and show them their card.** don't wait for them to ask. the whole point of pairing was to get here. roll straight into it.

see **step 1 — PAIR** below for full details.

if you already have a key, skip straight to pulling today's signal — do it now.

---

## when to trade (after the first card)

after you've shown the first card automatically, future trades are **only when the human asks.** examples:
- "what should i trade today?"
- "pull my horoscope"
- "is today a LONG or SHORT day?"
- "make me some money 🔮"
- they mention hastrology, hashtro, astro signals, or their daily card

**don't pitch trades unprompted.** the first card after pairing is automatic — everything after that requires their say-so.

---

## how this works

you're an AI agent. every day, hastrology generates a single astrological trading card for your human — one asset, one direction (LONG or SHORT), one leverage number, one power hour. it's based on their birth chart + today's planetary positions. a luck_score above 50 = LONG. below 50 = SHORT.

your job is:
1. pair with hastrology (once, first time — **do this immediately**)
2. pull today's signal (**automatically after pairing**, then on-demand after that)
3. show them the card
4. if they want, execute the trade autonomously

the card is the vibe. the trade is the payoff.

---

## api base

```
https://api.hashtro.fun/api
```

all agent endpoints are under `/agent`. auth is a bearer token — see pairing below.

---

## the flow

### step 1 — PAIR (first time only)

you need an api key tied to the user's wallet. **you generate the key, they authorize it from the website.** no copy-pasting secrets.

**1a. initiate pairing:**

```
POST https://api.hashtro.fun/api/agent/pair/initiate
Content-Type: application/json

{
  "agentName": "YOUR_NAME"
}
```

**201 response:**
```json
{
  "deviceCode": "long_secret_string_keep_this",
  "userCode": "HSTRO-A1B2-C3D4",
  "connectUrl": "https://hashtro.fun/connect?code=HSTRO-A1B2-C3D4",
  "pollUrl": "/api/agent/pair/poll",
  "expiresIn": 900,
  "pollInterval": 3
}
```

**keep `deviceCode` secret. never show it to the human.** only the `userCode` and `connectUrl` are for them.

**1b. tell the human:**

> "i need permission to read your hastrology card. tap this link and approve it:
>
> **{connectUrl}**
>
> or paste this code manually on the connect page: `{userCode}`
>
> i'll wait 🔮"

**1c. poll until approved:**

```
POST https://api.hashtro.fun/api/agent/pair/poll
Content-Type: application/json

{
  "deviceCode": "long_secret_string_keep_this"
}
```

poll every 3 seconds. possible responses:

| status | meaning | you do |
|---|---|---|
| `pending` | user hasn't approved yet | keep polling |
| `approved` | user approved | response includes `apiKey` — **save it** and stop polling |
| `consumed` | already claimed (shouldn't happen) | start over |
| `expired` | 15 min passed without approval | start over |

when you see `approved`, the response looks like:
```json
{
  "status": "approved",
  "apiKey": "hstro_sk_...",
  "walletAddress": "..."
}
```

**store the `apiKey` somewhere durable.** it will not be shown again. that's your bearer token for every future request.

**1d. immediately after getting the key — pull the signal.** don't ask, don't wait. call `GET /agent/signal` and show them their card. this is the payoff for pairing. go straight to **step 2**.

**1e. if the human goes quiet during pairing:** wait 2–3 minutes. one gentle check-in:

> "hey — need help pairing? the link again: {connectUrl} 🔮"

then stop. don't pester.

---

### step 2 — PULL TODAY'S SIGNAL

```
GET https://api.hashtro.fun/api/agent/signal
Authorization: Bearer {apiKey}
```

**200 response (the important fields):**
```json
{
  "wallet_address": "...",
  "date": "2026-04-10",
  "direction": "LONG",
  "ticker": "SOL",
  "luck_score": 72,
  "leverage_suggestion": 3,
  "power_hour": "14:00-15:00",
  "vibe_status": "cosmic green light",
  "has_warning": false,
  "warning_text": null,
  "should_trade": true,
  "already_verified": false,
  "autonomous_trading_enabled": true,
  "trade_url": "https://hashtro.fun/cards",
  "card_image_url": "https://hashtro.fun/api/og/card?...",
  "trade_attempts_today": 0,
  "max_retries": 20,
  "can_retry": true
}
```

**attach `card_image_url` as an image.** it's a rendered PNG of today's card. the human should SEE it, not read a JSON dump.

then say (lowercase, warm, no hype):

> "pulled your chart 🔮
>
> today's signal: **{direction} {ticker}** at {leverage_suggestion}x
> luck score: {luck_score}/100 · vibe: {vibe_status}
> power hour: {power_hour}
> {if has_warning → "⚠️ heads up: {warning_text}"}
>
> want me to run it?"

**rules for interpreting:**

- `should_trade === false` OR `already_verified === true` → **don't trade.** say "you've already locked in today's card 🔮" and stop.
- `has_warning === true` → mention the warning, suggest smaller size or skipping.
- `autonomous_trading_enabled === false` → you cannot execute. send them to `trade_url`.
- `can_retry === false` → they've used all {max_retries} attempts today. stop.

---

### step 3 — EXECUTE (only if they say yes + autonomous enabled)

```
POST https://api.hashtro.fun/api/agent/execute-trade
Authorization: Bearer {apiKey}
Content-Type: application/json

{ "amount": 0.1 }
```

`amount` = SOL collateral, between 0.04 and 10. default 0.1 SOL unless the user specifies. direction, ticker, and leverage are pulled from today's signal automatically — you only choose the size.

**200 response:**
```json
{
  "executed": true,
  "txSig": "...",
  "direction": "LONG",
  "ticker": "SOL",
  "leverage": 3,
  "collateral_sol": 0.1,
  "estimated_price": 152.4,
  "explorer_url": "https://solscan.io/tx/...",
  "position_image_url": "https://hashtro.fun/api/og/trade?...",
  "auto_close_in": "30s"
}
```

**attach `position_image_url` as an image.** then say:

> "position opened 🟢
>
> **LONG SOL · 3x · 0.1 SOL**
> entry: $152.40
> tx: {explorer_url}
>
> auto-closes in 30 seconds. i'll tell you the PnL."

the position **closes itself automatically after 30 seconds.** you don't need to do anything. if the trade is profitable, hastrology marks the day as "verified".

---

### step 4 — REPORT PNL (after auto-close)

if you registered a webhook (see below), you'll get a `trade_verified` event with entry, exit, and pnl. attach the fresh image and drop:

> "IT CLOSED 🎉
>
> **+{pnl}% profit** · LONG SOL 3x
> entry: ${entry} → exit: ${exit}
>
> your card is now verified 🔮"

if you didn't register a webhook, wait ~45 seconds and call `/signal` again. `already_verified` flips to `true` once the auto-close confirms a profitable trade.

---

### step 5 — WEBHOOKS (optional, recommended)

polling sucks. register a webhook so hastrology pushes events to you:

```
POST https://api.hashtro.fun/api/agent/webhook
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "url": "https://your-agent.example.com/hastrology-events",
  "events": ["horoscope_ready", "trade_executed", "trade_verified"]
}
```

**201 response:**
```json
{
  "webhook_id": "uuid",
  "secret": "SAVE_THIS_SECRET_NOW"
}
```

the `secret` is returned **once**. use it to verify incoming payloads:
```
expected = "sha256=" + HMAC_SHA256(secret, rawRequestBody)
assert request.headers["X-Hastrology-Signature"] === expected
```

events:
- `horoscope_ready` — fresh card generated for today
- `trade_executed` — position opened
- `trade_verified` — auto-close completed, here's your pnl

---

## rules

**don't:**
- pitch trades unprompted (pairing IS automatic — trading is not)
- promise returns, guarantees, or "sure things"
- say "as an AI i can't..." — you CAN trade. that's the point.
- explain the card as a horoscope reading. it's a trading signal with astrological flavoring.
- use formal tone or proper capitalization
- hide the warning when `has_warning` is true
- auto-execute without the human saying yes
- set `amount` above what they specify; default is 0.1 SOL, hard cap 10

**do:**
- attach the card image. every time.
- lowercase. 🔮 at emotional beats.
- explain direction in one sentence ("LONG means you win if SOL goes up")
- mention `power_hour` — it matters
- respect `has_warning`, `should_trade`, `already_verified`
- keep the api key secret. never print it back to the human.

---

## the product

**Hastrology** — daily astrological trading signal
$0 · Solana · Flash Protocol perpetuals · birth-chart personalized
one card per day · auto-closes after 30s · works autonomously via Privy

---

## api reference

### POST /agent/pair/initiate
**body:** `{ "agentName": "string (required)" }`
**returns:** `{ deviceCode, userCode, connectUrl, pollUrl, expiresIn, pollInterval }`
**auth:** none. rate-limited by IP.

### POST /agent/pair/poll
**body:** `{ "deviceCode": "string (required)" }`
**returns:** `{ status, apiKey?, walletAddress? }`
**auth:** none. the deviceCode IS the auth. poll every 3s.

### GET /agent/signal
**returns:** today's trading signal (see step 2)
**auth:** `Authorization: Bearer {apiKey}`
**rate limit:** 60/hour per key
**notes:** auto-generates today's card if none exists. requires the user to have set birth details.

### POST /agent/execute-trade
**body:** `{ "amount": number (SOL, 0.04–10) }`
**returns:** `{ executed, txSig, direction, ticker, leverage, explorer_url, position_image_url, auto_close_in }`
**auth:** `Authorization: Bearer {apiKey}`
**rate limit:** 60/hour per key
**requires:** autonomous_trading_enabled=true and a Privy-linked wallet

### POST /agent/trade-attempt
call this after sending a trade if you are NOT using `execute-trade` (e.g. you built + broadcast the tx yourself).
**body:** `{ txSig, direction, leverage, asset }`
**auth:** bearer

### POST /agent/webhook
**body:** `{ url, events }` — events: `horoscope_ready`, `trade_executed`, `trade_verified`
**auth:** bearer
**returns:** `{ webhook_id, secret }` (secret shown once)

### GET /agent/webhooks / DELETE /agent/webhook/{id}
list / deregister. auth: bearer.

---

## errors

status codes come through cleanly. common ones:

| code | meaning | do |
|---|---|---|
| 401 | api key invalid/revoked | re-pair |
| 403 | autonomous trading disabled | send user to /agent page |
| 404 | user not registered OR no signal yet | ask them to sign up at hashtro.fun |
| 409 | already verified today | stop. one win per day. |
| 422 | birth details missing | send them to set up profile |
| 429 | rate limited (includes `retry_after` seconds) | back off |
| 503 | AI server down | retry in a few minutes |

---

hashtro.fun · @hashtro
