# Autonomous Trading via Privy Delegated Actions

## Overview

This document tracks the full implementation of server-side autonomous trading.
The agent reads the daily horoscope signal and, with the user's one-time consent,
executes Flash Protocol perpetuals trades directly using their Privy embedded wallet —
no browser or manual approval needed per trade.

**Core mechanism**: Privy Delegated Actions — the backend builds the Solana
transaction, Privy signs it inside a secure enclave (server never sees the private
key), and broadcasts it to the network.

---

## Architecture

```
Agent CLI  ──►  POST /api/agent/execute-trade  (hstro_sk_* auth)
                        │
                        ▼
              agent.controller.executeTrade()
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
  flash-trade.service.js     privy.service.js
  (build tx server-side)     (@privy-io/node SDK)
              │                    │
              └─────────┬──────────┘
                        ▼
              Privy Enclave: signs with user's embedded wallet
                        │
                        ▼
              Solana RPC: broadcast + confirm
                        │
                        ▼
              Returns txSig → recorded + webhook fired
```

---

## Prerequisites

### 1. Privy Dashboard (one-time manual setup)
1. Go to **Privy Dashboard → Embedded Wallets → Advanced**
2. Toggle **"Delegated actions"** ON
3. Optionally enable **"Require signed requests"** for extra security
4. Copy `App ID` and `App Secret` into backend `.env`

### 2. New Environment Variables

**backend_server/.env**
```
PRIVY_APP_ID=your_privy_app_id
PRIVY_APP_SECRET=your_privy_app_secret
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_NETWORK=mainnet-beta
```

---

## Implementation Checklist

### Database (schema.sql)
- [x] `ALTER TABLE users ADD COLUMN privy_user_id TEXT`
- [x] `ALTER TABLE users ADD COLUMN privy_wallet_id TEXT`
- [x] `ALTER TABLE users ADD COLUMN trading_delegated BOOLEAN DEFAULT FALSE`
- [x] `CREATE INDEX idx_users_privy_wallet ON users(privy_wallet_id)`

### Backend — New Files
- [x] `backend_server/src/services/privy.service.js`
  - `signAndSendTransaction(privyWalletId, base64Tx, network)`
  - `isWalletDelegated(privyUserId, walletAddress)`
- [x] `backend_server/src/services/flash-trade.service.js`
  - `buildOpenPositionTx({ walletAddress, side, inputAmountUsd, leverage, symbol, network })`
  - Returns `{ base64Tx, blockhash, lastValidBlockHeight, estimatedPrice }`
  - Builds unsigned VersionedTransaction (partially signed by additionalSigners only)

### Backend — Modified Files
- [x] `backend_server/src/config/environment.js`
  - Add: `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `SOLANA_RPC_URL`, `SOLANA_NETWORK`
- [x] `backend_server/src/services/user.service.js`
  - `registerUser()` — add `privy_user_id`, `privy_wallet_id` fields
  - `setTradingDelegated(walletAddress, delegated)` — new method
- [x] `backend_server/src/controllers/user.controller.js`
  - `register()` — pass `privyUserId`, `privyWalletId` to service
  - `setTradingDelegated()` — new handler for PATCH /api/user/trading-delegated
- [x] `backend_server/src/routes/user.routes.js`
  - Add `PATCH /api/user/trading-delegated`
- [x] `backend_server/src/controllers/agent.controller.js`
  - `executeTrade()` — new method
- [x] `backend_server/src/routes/agent.routes.js`
  - Add `POST /api/agent/execute-trade`
- [x] `backend_server/package.json`
  - Add: `@privy-io/node`, `flash-sdk`, `@pythnetwork/hermes-client`, `@solana/spl-token`

### Frontend — Modified Files
- [x] `frontend/app/hooks/use-privy-wallet.ts`
  - Export `userId` (from `usePrivy().user.id`)
  - Export `walletId` (from `wallet.id` — Privy's internal wallet UUID)
- [x] `frontend/lib/api.ts`
  - `registerUser()` — add `privyUserId`, `privyWalletId` to payload
  - `setTradingDelegated(walletAddress, delegated)` — new
  - `executeTrade(apiKey, amount)` — new
- [x] `frontend/app/agent/page.tsx`
  - New "Autonomous Trading" section with delegation toggle
  - Uses `useHeadlessDelegatedActions` hook: `delegateWallet()` / `revokeWallets()`
  - Shows delegation status (delegated / not delegated)
  - Execute trade form with amount input

### CLI Agent
- [x] `agent/main.py`
  - `execute_trade(amount)` function calling `POST /api/agent/execute-trade`
  - `--auto` flag: skip prompts, execute trade immediately when `should_trade=true`
  - `--amount` flag: USDC collateral amount (default: 10)

---

## API Reference

### New Endpoint: Execute Trade
```
POST /api/agent/execute-trade
Authorization: Bearer hstro_sk_...
Content-Type: application/json

{
  "amount": 50    // USDC collateral amount
}

Response 200:
{
  "success": true,
  "data": {
    "executed": true,
    "txSig": "4xK9...",
    "direction": "LONG",
    "ticker": "SOL",
    "leverage": 3,
    "collateral_usd": 50,
    "estimated_price": 185.42,
    "explorer_url": "https://solscan.io/tx/4xK9..."
  }
}

Errors:
  403 — trading_delegated is false (user hasn't enabled autonomous trading)
  404 — no horoscope today (call /signal first)
  409 — already verified today
  422 — privy_wallet_id not set (user must re-register)
  429 — max retries reached
  502 — Privy signing failed
```

### New Endpoint: Set Trading Delegated
```
PATCH /api/user/trading-delegated
Content-Type: application/json

{
  "walletAddress": "...",
  "delegated": true | false
}

Response 200:
{
  "success": true,
  "data": { "trading_delegated": true }
}
```

---

## Security Model

| Layer | Protection |
|---|---|
| API key auth | Every agent request validates `hstro_sk_*` — 401 if invalid |
| User consent | `trading_delegated = true` only set after `delegateWallet()` in Privy modal |
| Privy enclave | Private key never leaves Privy infrastructure; server only sees txSig |
| Retry cap | Max 2 trade attempts per day per horoscope |
| Revoke anytime | User calls `revokeWallets()` → `PATCH /trading-delegated` sets false |
| Amount validation | `amount` must be positive number ≤ reasonable cap (configurable) |

---

## Flash Transaction Flow (Server-Side)

The `flash-trade.service.js` mirrors the frontend `flash-trade.ts` logic:

1. Initialize `PerpetualsClient` with a **read-only wallet** (user's pubkey, no signing)
2. Fetch Pyth oracle prices via `HermesClient`
3. Load pool config (`PoolConfig.fromIdsByName('Crypto.1', network)`)
4. Compute size, slippage, min amounts
5. Call `flashClient.swapAndOpen()` → returns `{ instructions, additionalSigners }`
6. Add compute budget instructions (800k units, 100k microlamports)
7. Fetch latest blockhash
8. Build `VersionedTransaction` with v0 message + address lookup tables
9. Sign with `additionalSigners` (Flash's ephemeral keypairs for new position accounts)
10. Serialize to **base64** (partially signed — user wallet sig missing)
11. Pass to Privy → Privy adds user wallet signature and broadcasts

---

## User Flow

### One-time setup (user does this once in /agent page):
1. User visits `/agent`
2. Sees "Autonomous Trading" section — status: "Not enabled"
3. Clicks "Enable Autonomous Trading"
4. Privy modal appears asking for consent
5. User approves → `delegateWallet()` completes
6. Frontend calls `PATCH /api/user/trading-delegated { delegated: true }`
7. Status changes to "Enabled — trades will execute automatically"

### Daily autonomous execution (agent does this):
```
morning cron / --loop flag
  → GET /api/agent/signal
  → if should_trade && !already_verified
      → POST /api/agent/execute-trade { amount: 10 }
      → receive txSig
      → log "Trade executed: LONG SOL 3x @ $185.42"
      → solscan.io link
  → wait for P&L → POST /api/horoscope/verify { pnlPercent: ... }
```

### Revoking (user can do anytime):
1. User visits `/agent`
2. Clicks "Disable Autonomous Trading"
3. Privy `revokeWallets()` runs
4. Frontend calls `PATCH /api/user/trading-delegated { delegated: false }`
5. Future `execute-trade` calls return 403
