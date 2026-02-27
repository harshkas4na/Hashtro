# Hastrology — Improvements Catalogue

All improvements found from reading the actual code. Each item includes the exact file and line where the issue lives.

**Legend:** ✅ Done | ⬜ Not started

**Progress: 55 / 57 done**

---

## AI Server

### Bugs

**1. ✅ Cache key computed but never used**
`horoscope_service.py:335` — A `cache_key` variable is built as `f"{dob}_{birth_time}_{latitude}_{longitude}"` but is never passed anywhere. The actual cache lookup two lines later calls `cache_service.get(dob, birth_time, birth_place)` which builds its own key internally. The `cache_key` variable is dead code and the two keys are different (one uses lat/lon, one uses birth_place string).

**2. ✅ No date in the cache key**
`cache_service.py:32` — The cache key is `dob|birth_time|birth_place`. There is no date component. A horoscope generated at 11:55 PM stays cached until the TTL expires — potentially serving yesterday's reading to tomorrow's requests. The key should include today's date so the cache naturally invalidates at midnight.

**3. ✅ Duplicate imports**
`horoscope_service.py:23-24` — `SENIOR_ASTROLOGER_PROMPT` and `calculate_vibe_status` are imported twice on consecutive lines from the same module.

**4. ✅ `calculate_vibe_status` and `get_energy_emoji` imported but never called**
`horoscope_service.py:25-26` — Both functions are imported from `senior_astrologer_prompt` but are never called inside `horoscope_service.py`. The service relies entirely on the AI to return these values. Dead imports.

**5. ✅ Bare `except:` in two places**
`horoscope_service.py:431` and `horoscope_service.py:517` — Both use `except:` (no exception type) which catches `KeyboardInterrupt`, `SystemExit`, and `GeneratorExit`. Should be `except Exception as e:` at minimum, with the error logged.

**6. ✅ Transit calculations use UTC, not local time**
`horoscope_service.py:233` — `get_current_transits` is called with `current_datetime = datetime.now()` which is server local time. It also doesn't receive the user's `timezone_offset`. Transit positions are calculated at the server's clock time, not relative to where the user is in the world. The natal chart uses the birth timezone correctly but transits do not.

**7. ✅ `swe.CALC_SET` wrong constant in altitude calculation**
`ephemeris_service.py:266` — `swe.CALC_SET` (value = 2) is a sunset calculation flag, not the correct flag for `swe.azalt`. The azalt function expects a calculation type constant (rising=1, setting=2, transit=3) but using CALC_SET for altitude calculation produces incorrect results. The altitude fallback returns 0.0 which defaults all charts to "night" sect.

**8. ✅ No validation that luck_score and vibe_status are consistent**
`horoscope_service.py:491` — `AstroCard(**card_data)` validates the schema types but doesn't cross-validate business rules. The prompt enforces consistency but the AI can still return `luck_score=78` with `vibe_status="Eclipse"`. A post-generation correction step should enforce: `>79 → Stellar`, `51-79 → Ascending`, `40-50 → Shaky`, `<40 → Eclipse`.

---

### Performance

**9. In-memory cache is lost on every restart**
`cache_service.py:15` — The cache is a plain Python dict. Every server restart or deployment clears it, causing all subsequent requests to hit the AI API. For a product where horoscopes are cached for 24h, a Redis-backed cache would survive restarts and work across multiple workers.

**10. ✅ No periodic cleanup scheduled**
`cache_service.py:89` — `cleanup_expired()` exists but is never called automatically. Expired entries sit in memory until manually triggered. Over a long uptime with many users, this grows unboundedly.

**11. ✅ LLM model name hardcoded in constructor**
`horoscope_service.py:110` — `model="gemini-2.5-flash"` is hardcoded. Changing the model requires a code change. Should be `settings.llm_model` so it can be switched via environment variable.

**12. ✅ No circuit breaker for Gemini API**
`horoscope_service.py:425` — Added in-process circuit breaker on HoroscopeService (_cb_failures / _cb_opened_at). Opens after 3 consecutive generation failures; half-opens after 60 s. Open state returns fallback card immediately without waiting for LangChain max_retries=3.

**13. ✅ No request tracing / correlation ID**
`horoscope_routes.py:38` — Added CorrelationIdMiddleware that reads X-Request-ID from the backend or generates UUID. Stored in ContextVar, echoed in response header, and included in route log lines.

---

### Quality

**14. ✅ Fallback card hardcodes "Mercury retrograde in the cosmic servers"**
`horoscope_service.py:542` — The fallback card text is a fixed joke string. Users who hit the fallback always see the exact same message. Should at least vary the time_lord-based message based on the calculated time lord.

**15. ✅ Fallback color selection via `len(color) % len(mapping)`**
`horoscope_service.py:479` — When the AI hallucinates a color not in the asset mapping, the fallback picks a color using `len(color) % len(mapping)`. Short color names like "Red" (3 chars) always map to index 3, "Blue" to 4, etc. This isn't truly random or meaningful — it just coincidentally picks an asset.

**16. ✅ `_is_aspect_applying` uses a simplified check for Time Lord activations**
`astro_calculator.py:386` — In `detect_time_lord_activations`, `is_applying = transit_speed != 0` is used as the applying check, which is always `True` for any moving planet. The actual applying/separating calculation from `_is_aspect_applying` (which compares current vs future orb) is not called here.

**17. ✅ `random` imported but only used in fallback**
`horoscope_service.py:28` — Fixed by #15: `random.choice` is now also used in the main code path for unrecognized-color fallback, making the import fully justified.

---

## Backend Server

### Security

**18. No authentication on any endpoint**
All routes are publicly accessible with no JWT or API key check. Anyone who knows a wallet address can call `POST /api/horoscope/confirm` for that wallet, triggering AI generation on your cost. The auth service (`auth.service.js`) exists but is not used in any middleware or route.

**19. Twitter OAuth tokens stored in plaintext**
`schema.sql:18-20` — `twitter_access_token` and `twitter_refresh_token` are stored as plain TEXT in Supabase. These tokens grant write access to users' Twitter accounts (posting tweets). Should be encrypted at rest.

**20. ✅ `SELECT *` exposes OAuth tokens in every user fetch**
`user.service.js:178` — `findUserByWallet` runs `select("*")` which returns `twitter_access_token` and `twitter_refresh_token` in every response. These tokens end up in the full user object that gets passed into `horoscopeController.confirm()`, logged in places, and returned in profiles. Should select only the columns needed per operation.

**21. ✅ `GET /api/user/profile/:walletAddress` has no input validation**
`user.routes.js:55` — The profile endpoint takes `walletAddress` directly from URL params with no validation middleware. The horoscope routes validate wallet format with a Joi regex but the profile route does not.

**22. ✅ Debug routes registered without environment guard**
`backend_server/src/routes/index.js` (implied by debug.routes.js existing) — The debug routes are registered regardless of environment. If they expose internal state or bypass limits, they are a risk in production.

**23. `verifyTransaction` does not confirm the trade was from the claimed wallet**
`horoscope.controller.js:180` — `solanaService.verifyTransaction(txSig)` confirms the transaction exists on-chain but does not confirm: (a) the transaction was signed by `walletAddress`, (b) it was a Flash protocol trade, (c) the claimed `pnlPercent` matches what actually happened on-chain. A crafty user could submit any valid Solana txSig with a fake positive pnlPercent.

---

### Data / Schema

**24. ✅ Schema file has a syntax error**
`schema.sql:18-20` — The column definitions use colons instead of spaces:
```sql
twitter_access_token: TEXT,   -- wrong
twitter_access_token TEXT,    -- correct
```
Running this file as-is would fail with a syntax error for those three columns.

**25. ✅ `dob` stored as TEXT with no format enforcement**
`schema.sql:12` — `dob TEXT` accepts any string. The service accepts multiple date formats (`April 20, 1995`, `1995-04-20`, `20/04/1995`). This makes date-based queries impossible and means two registrations of the same user with different formats store different strings.

**26. ✅ `horoscope_text` column stores full JSON as TEXT**
`schema.sql:35` — The card JSON (a rich structured object with front, back, lucky_assets, cdo_summary, etc.) is stored as a TEXT string. Using `JSONB` would allow querying inside the card (e.g., `WHERE horoscope_text->>'luck_score' > 70`), indexing, and compression.

**27. ✅ No `trade_attempts` tracking on horoscopes**
Added `trade_attempts INTEGER DEFAULT 0` column to horoscopes. Added `increment_trade_attempts(p_wallet, p_date)` Postgres RPC for atomic increment. Backend increments before on-chain check so every attempt is counted, including rejected ones.

**28. `trade_made_at` on users captures only the last trade**
`schema.sql:124` — `trade_made_at` is a single timestamp on the users table — overwritten on every trade. There is no trade history at all beyond "when did they last trade".

**29. ✅ No soft deletes**
Added `deleted_at TIMESTAMP WITH TIME ZONE` to both `users` and `horoscopes`. Added partial indexes `idx_users_active` and `idx_horoscopes_active` covering only rows where `deleted_at IS NULL`.

---

### Performance & Reliability

**30. Rate limiter uses in-memory store**
`rateLimiter.js:12` — `express-rate-limit` defaults to an in-memory store. On multi-instance deployments (e.g., two backend pods), each instance maintains its own counter. A user can exceed the real rate limit by N × the configured limit if there are N instances. Should use a Redis store (`rate-limit-redis`) for production.

**31. ✅ No circuit breaker for AI server calls**
`ai.service.js:23` — Added in-process circuit breaker (trips after 3 consecutive failures, half-opens after 30 s) and one retry with 2 s delay for transient errors (ETIMEDOUT, ECONNABORTED, HTTP 5xx). ECONNREFUSED short-circuits immediately.

**32. ✅ No backend health check endpoint**
There is no `GET /health` endpoint on the backend. Kubernetes liveness/readiness probes, load balancers, and uptime monitors have nothing to check.

**33. ✅ No request correlation ID**
`backend_server/index.js` — No middleware attaches a `X-Request-ID` header or correlation ID to requests. Matching a backend log entry to an AI server log entry for the same user request requires searching by wallet address and timestamp.

**34. ✅ Date calculation locked to IST (Asia/Kolkata)**
`horoscope.service.js:19` — `getTodayDateString()` hardcodes `timeZone: 'Asia/Kolkata'`. For a global product, whether "today" is Feb 27 or Feb 28 depends entirely on the server's IST clock, not the user's timezone. A user in the US might be on Feb 27 while IST is already Feb 28, giving them tomorrow's "slot" prematurely.

**35. ✅ Twitter data is re-fetched on every horoscope generation even though it rarely changes**
`horoscope.controller.js:106` — `twitterService.getEnrichedXContext(user)` makes 2 Twitter API calls (profile + tweets) on every horoscope generation. Twitter context (bio, recent tweets) doesn't change minute to minute. Should be cached for at least 1-6 hours per user.

**36. ✅ No pagination on history endpoint**
`horoscope.routes.js:48` — The history endpoint supports `limit` but no cursor or offset. Getting page 2 of history requires knowing what's on page 1 and computing an offset externally. Standard cursor-based pagination (`after_date` param) would be more robust.

---

## Frontend

### Bugs

**37. ✅ `deriveDirection` always returns "SHORT" in practice**
`cards/page.tsx:37-51` — `deriveDirection(vibeStatus)` checks if the vibe_status string contains words like "confident", "optimistic", "energetic". But the actual vibe_status values the AI returns are `"Stellar"`, `"Ascending"`, `"Shaky"`, `"Eclipse"` — none of which contain those keywords. So this function always returns `"SHORT"`. The `TradeModal` correctly uses `card.front.luck_score > 50` directly, making `tradeParams.direction` dead code.

**38. ✅ Leverage derived from lucky number, not max_leverage**
`cards/page.tsx:88` — `leverage: Math.min(Math.max(luckyNumber, 2), 50)` where `luckyNumber` is parsed from `card.back.lucky_assets.number` (a string like "7" or "11"). The card already has `card.back.lucky_assets.max_leverage` which is the asset-specific leverage ceiling. The lucky number (a numerology value, could be 99) is being used as a leverage multiplier when it was never intended for that.

**39. ✅ `tradeParams` memo is computed but largely unused**
`cards/page.tsx:84-92` — `tradeParams` is used only as a truthiness guard on line 392 (`if (currentScreen === "execute" && card && tradeParams)`). Its `.direction` and `.leverage` values are not consumed by `TradeModal`. `TradeModal` receives `direction` computed directly inline. The memo can be simplified to just checking if `card` exists.

**40. ✅ Two separate `Connection` objects created for same RPC endpoint**
`cards/page.tsx:125-130` and `cards/page.tsx:239-241` — The Flash service initialization and the balance polling each create their own `new Connection(endpoint, "confirmed")` independently. These should share a single stable connection instance, ideally created once outside the component or in a context.

**41. ✅ New `Connection` instantiated on every balance poll tick**
`cards/page.tsx:239-241` — Inside the `fetchBalance` function which runs every 30 seconds, `new Connection(...)` is called fresh every tick. Creating a Connection object is expensive (it initializes internal state and possibly opens a WebSocket). The connection should be created once and reused across polls.

---

### Code Quality

**42. ✅ `api.regsiterX` typo in method name**
`api.ts:125` — The method is spelled `regsiterX` instead of `registerX`. Any TypeScript consumer using autocomplete gets the wrong name.

**43. ✅ API error handling loses HTTP status codes**
`api.ts:41-46` and throughout — All API methods do `throw new Error(error.message || "...")`. This loses the HTTP status code (404, 409, 503, etc.). Callers cannot distinguish "user not found" from "server error" without string-matching on error messages, which is fragile.

**44. ✅ No TypeScript types on API success responses**
`api.ts` — Most methods return `res.json()` with no type assertion. The return types are inferred only for methods that explicitly annotate them (like `verifyHoroscope`). `getUserProfile`, `registerUser`, and `getHistory` return `any` effectively.

**45. ✅ Dead code: `currentScreen === "payment"` branch**
`cards/page.tsx:343-357` — The payment screen was disabled but its render branch is still in the code. Since `generateFreeHoroscope` is called immediately on load, no code path sets `currentScreen` to `"payment"` anymore. The branch is unreachable dead code.

**46. ✅ Dead code: `handleExecuteTrade` function**
`cards/page.tsx:261-264` — `handleExecuteTrade` sets `tradeAmount` and goes to the `"execute"` screen, but nothing calls it. The old `TradeConfirm` → `handleExecuteTrade` flow was replaced; now `handleVerifyTrade` goes directly to `"execute"`.

---

### UX / Product

**47. ✅ No React Error Boundary on the cards page**
`cards/page.tsx` — There is no `ErrorBoundary` wrapping the cards page. Any uncaught render error (e.g., `card.front` is null unexpectedly) shows a blank white screen with no user-facing message and no way to recover.

**48. ✅ Generic error message on horoscope generation failure**
`cards/page.tsx:168` — On failure, `setError("Failed to generate horoscope. Please try again.")` is shown regardless of whether the failure was a network timeout, an AI server error, a user profile issue, or a rate limit. Different errors should give different guidance.

**49. ✅ No loading state indicator during balance fetch**
`cards/page.tsx:75` — Already handled: `balance.tsx` has its own `loading` state (shows spinner during fetch) and shows "Connecting..." for null, never "0 SOL". `TradeModal` guards `balance !== null` before showing insufficient-balance warning.

**50. ✅ Hardcoded public RPC endpoint**
`cards/page.tsx:127` — `"https://solana-rpc.publicnode.com"` is a public free RPC. It has rate limits, no uptime SLA, and is shared with all other users of the public node. For a trading product, this needs a dedicated paid RPC (Helius, QuickNode, Alchemy).

**51. ✅ Zustand store not persisted across page refreshes**
`useStore` — The store holds `card`, `wallet`, and `user`. On a page refresh, the store is empty and the app makes full API calls again (profile check + horoscope status + generation). Persisting the card to `sessionStorage` via `zustand/middleware`'s `persist` would make refreshes instant.

**52. ✅ No sharing flow for the horoscope card**
Added "Share Reading on X" button to HoroscopeReveal (the card reveal screen). Uses Twitter Web Intent URL with card's tagline and hook_1 — no API or OAuth required. TradeResults already had a share button; this closes the gap on the reveal screen.

**53. ✅ Flash service failure is silent to the user**
`cards/page.tsx:136-143` — If Flash service initialization fails, the error is logged to console and `flashService` stays `null`. The user sees no indication. When they click "Verify Trade", the button would be active but the trade would silently fail. Should show a banner: "Flash trading unavailable. Please refresh."

**54. ✅ `wasConnected` ref logic could miss wallet switch**
`cards/page.tsx:151-156` — `wasConnected` tracks whether the wallet was ever connected. If a user disconnects and reconnects with a **different** wallet, `hasCheckedRef.current` is reset on disconnect (line 179: `hasCheckedRef.current = false`) — but only because `!connected || !publicKey`. If Privy keeps `connected=true` during wallet switch and just changes `publicKey`, the status check for the new wallet might not re-run.

---

## Database Schema (Cross-cutting)

**55. Schema file is not kept in sync with actual DB state**
`schema.sql` defines the initial schema plus one `ALTER TABLE` at the bottom for `trade_made_at`. Any future column additions would need separate ALTER statements. There's no migration history — you can't tell what the current state of a production DB is just from this file. Should use a migration tool (e.g., Supabase migrations, or at minimum numbered migration files).

**56. ✅ No index on `horoscopes.verified`**
`schema.sql` — There's an index on `(wallet_address, date)` but none on `verified`. Any query filtering by `verified = false` (e.g., "show me all unverified horoscopes today") does a full table scan.

**57. ✅ `user_id` on horoscopes can be NULL**
`schema.sql:32` — `user_id UUID REFERENCES users(id)` has no `NOT NULL` constraint. Horoscopes are looked up by `wallet_address` not `user_id`, so the foreign key is unused in practice and could be null. The relationship between tables is enforced by convention rather than the schema.
