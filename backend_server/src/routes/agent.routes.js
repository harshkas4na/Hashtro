const express = require('express');
const agentController = require('../controllers/agent.controller');
const agentAuth = require('../middleware/agentAuth.middleware');
const {
    validateGenerateKey,
    validateRevokeKey,
    validateWalletParam,
    validateTradeAttempt,
    validateWebhookRegistration,
    validatePairInitiate,
    validatePairPoll,
    validatePairClaim,
} = require('../middleware/validation');
const { authLimiter, generalLimiter, agentSignalLimiter, agentWebhookLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// ─── Pairing flow (OAuth 2.0 Device Authorization Grant) ────────────────────
// Unauthenticated. The agent calls /pair/initiate → tells the user to visit
// /connect?code=XXXX → polls /pair/poll until the user approves → receives
// a freshly-minted API key exactly once.

/**
 * @swagger
 * /agent/pair/initiate:
 *   post:
 *     summary: Start an agent pairing session
 *     tags: [Agent]
 *     description: Returns a short userCode for the human to paste at /connect and a deviceCode the agent polls with.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               agentName: { type: string, example: "My Agent" }
 *     responses:
 *       201: { description: Pairing session created }
 */
router.post(
    '/pair/initiate',
    authLimiter,
    validatePairInitiate,
    agentController.pairInitiate,
);

/**
 * @swagger
 * /agent/pair/poll:
 *   post:
 *     summary: Poll a pairing session for status / api key
 *     tags: [Agent]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deviceCode]
 *             properties:
 *               deviceCode: { type: string }
 *     responses:
 *       200: { description: Pending or approved (with apiKey) }
 *       409: { description: Already consumed }
 *       410: { description: Expired }
 */
router.post(
    '/pair/poll',
    generalLimiter,
    validatePairPoll,
    agentController.pairPoll,
);

/**
 * @swagger
 * /agent/pair/claim:
 *   post:
 *     summary: Approve a pairing session from the /connect page
 *     description: Called by the frontend after the user authenticates with their Privy wallet and pastes the userCode. Does NOT return the api key — the agent receives it on its next poll.
 *     tags: [Agent]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [userCode, walletAddress]
 *             properties:
 *               userCode: { type: string, example: "HSTRO-A1B2-C3D4" }
 *               walletAddress: { type: string }
 *     responses:
 *       200: { description: Pairing approved }
 *       404: { description: Code not found or wallet not registered }
 */
router.post(
    '/pair/claim',
    authLimiter,
    validatePairClaim,
    agentController.pairClaim,
);

/**
 * @swagger
 * /agent/pair/lookup/{userCode}:
 *   get:
 *     summary: Look up pairing metadata (agent name, status) without approving
 *     tags: [Agent]
 *     parameters:
 *       - in: path
 *         name: userCode
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Metadata }
 *       404: { description: Not found }
 */
router.get(
    '/pair/lookup/:userCode',
    generalLimiter,
    agentController.pairLookup,
);

// ─── Signal ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /agent/signal:
 *   get:
 *     summary: Get today's trading signal
 *     description: |
 *       Returns a machine-readable trading signal for the authenticated wallet.
 *       If no horoscope exists for today it is auto-generated before returning.
 *
 *       **Field guide:**
 *       - `direction` — LONG or SHORT derived from `luck_score` (>50 = LONG)
 *       - `leverage_suggestion` — capped at 3× when `has_warning` is true, 5× otherwise
 *       - `should_trade` — false when already verified or no score available
 *       - `can_retry` — false once `trade_attempts_today` reaches `max_retries` (10)
 *     tags: [Agent]
 *     security:
 *       - AgentApiKey: []
 *     responses:
 *       200:
 *         description: Signal returned successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SignalResponse'
 *       401:
 *         description: Missing or invalid API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: User not found or birth details missing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       422:
 *         description: Birth details not set — user must complete profile first
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limit exceeded (60 req/hr per API key)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RateLimitError'
 *       503:
 *         description: AI server unavailable — retry later
 */
router.get(
    '/signal',
    agentSignalLimiter,
    agentAuth,
    agentController.getSignal
);

// ─── Autonomous trade execution ───────────────────────────────────────────────

/**
 * @swagger
 * /agent/execute-trade:
 *   post:
 *     summary: Execute a trade autonomously via Privy delegated actions
 *     description: |
 *       Builds a Flash Protocol perpetuals transaction server-side, signs it using
 *       the user's Privy embedded wallet (delegated actions), and broadcasts it on
 *       Solana — all without the user needing to be online.
 *
 *       **Prerequisites:**
 *       1. User must have a Privy embedded wallet linked (`privy_wallet_id` set)
 *       2. User must have enabled autonomous trading via the `/agent` page
 *          (`trading_delegated = true`)
 *       3. A horoscope must exist for today (call `GET /agent/signal` first)
 *
 *       The signal's `direction`, `ticker` (one of SOL/BTC/ETH/BNB/ZEC derived from luck_score),
 *       and `leverage_suggestion` are used automatically — you only supply the SOL collateral `amount`.
 *
 *       The position auto-closes after 30 seconds. The API records the trade attempt and fires
 *       a `trade_executed` webhook event immediately. After close, it fires `trade_verified`
 *       if the trade was profitable.
 *     tags: [Agent]
 *     security:
 *       - AgentApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount:
 *                 type: number
 *                 description: SOL collateral amount (e.g. 0.1 = 0.1 SOL). Min 0.04, max 10.
 *                 example: 0.1
 *                 minimum: 0.04
 *                 maximum: 10
 *     responses:
 *       200:
 *         description: Trade executed on-chain
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ExecuteTradeResponse'
 *       400:
 *         description: Invalid amount (must be 0.04–10 SOL)
 *       403:
 *         description: Autonomous trading not enabled
 *       404:
 *         description: No horoscope for today — call /signal first
 *       409:
 *         description: Already verified today
 *       422:
 *         description: Privy wallet not linked — user must re-register
 *       429:
 *         description: Max retries (10) reached
 *       502:
 *         description: Transaction build or Privy signing failed
 */
router.post(
    '/execute-trade',
    agentSignalLimiter,
    agentAuth,
    agentController.executeTrade
);

// ─── Trade attempt ────────────────────────────────────────────────────────────

/**
 * @swagger
 * /agent/trade-attempt:
 *   post:
 *     summary: Record a trade execution
 *     description: |
 *       Call this immediately after a trade is sent on-chain, before you know
 *       the P&L. Increments `trade_attempts_today` so the next `/signal` call
 *       returns an accurate `can_retry` value even if `/horoscope/verify` is
 *       never called.
 *
 *       After you know the result, call `POST /horoscope/verify` with the P&L.
 *     tags: [Agent]
 *     security:
 *       - AgentApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TradeAttemptRequest'
 *     responses:
 *       200:
 *         description: Attempt recorded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TradeAttemptResponse'
 *       401:
 *         description: Missing or invalid API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: No horoscope for today — call GET /agent/signal first
 *       409:
 *         description: Horoscope already verified, no further trades needed
 *       429:
 *         description: Max retries (10) reached for today
 */
router.post(
    '/trade-attempt',
    agentSignalLimiter,
    agentAuth,
    validateTradeAttempt,
    agentController.recordTradeAttempt
);

// ─── Webhooks ─────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /agent/webhook:
 *   post:
 *     summary: Register a webhook endpoint
 *     description: |
 *       Register a URL to receive push events instead of polling `/signal`.
 *
 *       The response includes a `secret` (shown **once**). Store it and use it
 *       to verify incoming payloads:
 *       ```
 *       expected = "sha256=" + HMAC_SHA256(secret, rawRequestBody)
 *       assert request.headers["X-Hastrology-Signature"] == expected
 *       ```
 *
 *       **Supported events:**
 *       - `horoscope_ready` — a new card was generated for this wallet
 *       - `trade_executed` — a trade was opened via `POST /agent/execute-trade`
 *       - `trade_verified` — a profitable trade marked the horoscope as verified
 *     tags: [Agent]
 *     security:
 *       - AgentApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WebhookRegisterRequest'
 *     responses:
 *       201:
 *         description: Webhook registered — save the secret now
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookRegisterResponse'
 *       401:
 *         description: Missing or invalid API key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Rate limit exceeded (30 req/hr per API key)
 */
router.post(
    '/webhook',
    agentWebhookLimiter,
    agentAuth,
    validateWebhookRegistration,
    agentController.registerWebhook
);

/**
 * @swagger
 * /agent/webhook/{webhookId}/test:
 *   post:
 *     summary: Send a test ping to a webhook
 *     description: Delivers a synthetic `test` event to the webhook URL so you can verify it's reachable and your signature verification works.
 *     tags: [Agent]
 *     security:
 *       - AgentApiKey: []
 *     parameters:
 *       - in: path
 *         name: webhookId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Test ping delivered
 *       404:
 *         description: Webhook not found or inactive
 *       502:
 *         description: Your endpoint returned an error or was unreachable
 */
router.post(
    '/webhook/:webhookId/test',
    agentWebhookLimiter,
    agentAuth,
    agentController.testWebhook
);

/**
 * @swagger
 * /agent/webhooks:
 *   get:
 *     summary: List registered webhooks
 *     description: Returns all webhooks for the authenticated wallet. The signing secret is never returned after registration.
 *     tags: [Agent]
 *     security:
 *       - AgentApiKey: []
 *     responses:
 *       200:
 *         description: List of webhooks
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 webhooks:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Webhook'
 *       401:
 *         description: Missing or invalid API key
 */
router.get(
    '/webhooks',
    agentWebhookLimiter,
    agentAuth,
    agentController.listWebhooks
);

/**
 * @swagger
 * /agent/webhook/{webhookId}:
 *   delete:
 *     summary: Deregister a webhook
 *     tags: [Agent]
 *     security:
 *       - AgentApiKey: []
 *     parameters:
 *       - in: path
 *         name: webhookId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Webhook deregistered
 *       401:
 *         description: Missing or invalid API key
 *       404:
 *         description: Webhook not found or belongs to a different wallet
 */
router.delete(
    '/webhook/:webhookId',
    agentWebhookLimiter,
    agentAuth,
    agentController.deleteWebhook
);

// ─── API key management ───────────────────────────────────────────────────────

/**
 * @swagger
 * /agent/keys:
 *   post:
 *     summary: Generate an agent API key
 *     description: |
 *       Creates a new API key for the given wallet. The raw key is returned **once**
 *       and cannot be retrieved again. The wallet must already be registered.
 *     tags: [Agent]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GenerateKeyRequest'
 *     responses:
 *       201:
 *         description: Key generated — save it now
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GenerateKeyResponse'
 *       404:
 *         description: Wallet not registered
 *       429:
 *         description: Too many key generation attempts
 */
router.post(
    '/keys',
    authLimiter,
    validateGenerateKey,
    agentController.generateKey
);

/**
 * @swagger
 * /agent/keys/{walletAddress}:
 *   get:
 *     summary: List API keys for a wallet
 *     description: Returns all keys (active and revoked). The key hash and raw value are never returned.
 *     tags: [Agent]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/WalletAddress'
 *     responses:
 *       200:
 *         description: Key list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 keys:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ApiKey'
 *       400:
 *         description: Invalid wallet address format
 */
router.get(
    '/keys/:walletAddress',
    generalLimiter,
    validateWalletParam,
    agentController.listKeys
);

/**
 * @swagger
 * /agent/keys/{keyId}:
 *   delete:
 *     summary: Revoke an API key
 *     description: Permanently revokes a key. Any agent using it will immediately receive 401 responses.
 *     tags: [Agent]
 *     parameters:
 *       - in: path
 *         name: keyId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress]
 *             properties:
 *               walletAddress:
 *                 $ref: '#/components/schemas/WalletAddress'
 *     responses:
 *       200:
 *         description: Key revoked
 *       404:
 *         description: Key not found or belongs to a different wallet
 */
router.delete(
    '/keys/:keyId',
    generalLimiter,
    validateRevokeKey,
    agentController.revokeKey
);

module.exports = router;
