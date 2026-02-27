const express = require('express');
const agentController = require('../controllers/agent.controller');
const agentAuth = require('../middleware/agentAuth.middleware');
const { validateGenerateKey, validateRevokeKey, validateWalletParam, validateTradeAttempt, validateWebhookRegistration } = require('../middleware/validation');
const { authLimiter, generalLimiter, agentSignalLimiter, agentWebhookLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

/**
 * @route   GET /api/agent/signal
 * @desc    Get today's machine-readable trading signal for the authenticated wallet.
 *          Auto-generates today's horoscope if one doesn't exist yet.
 * @access  Agent API key required (Authorization: Bearer hstro_sk_...)
 */
router.get(
    '/signal',
    agentSignalLimiter,
    agentAuth,
    agentController.getSignal
);

/**
 * @route   POST /api/agent/trade-attempt
 * @desc    Record a trade execution for today's horoscope (before knowing P&L).
 *          Increments retry counter so /signal stays accurate even if /verify is never called.
 * @access  Agent API key required
 */
router.post(
    '/trade-attempt',
    agentSignalLimiter,
    agentAuth,
    validateTradeAttempt,
    agentController.recordTradeAttempt
);

/**
 * @route   POST /api/agent/webhook
 * @desc    Register a webhook endpoint to receive push events (horoscope_ready, trade_verified, …)
 * @access  Agent API key required
 */
router.post(
    '/webhook',
    agentWebhookLimiter,
    agentAuth,
    validateWebhookRegistration,
    agentController.registerWebhook
);

/**
 * @route   GET /api/agent/webhooks
 * @desc    List all webhooks for the authenticated wallet
 * @access  Agent API key required
 */
router.get(
    '/webhooks',
    agentWebhookLimiter,
    agentAuth,
    agentController.listWebhooks
);

/**
 * @route   DELETE /api/agent/webhook/:webhookId
 * @desc    Deregister (deactivate) a webhook
 * @access  Agent API key required
 */
router.delete(
    '/webhook/:webhookId',
    agentWebhookLimiter,
    agentAuth,
    agentController.deleteWebhook
);

/**
 * @route   POST /api/agent/keys
 * @desc    Generate a new agent API key for a wallet
 * @access  Public (wallet ownership implied by knowing birth details)
 */
router.post(
    '/keys',
    authLimiter,
    validateGenerateKey,
    agentController.generateKey
);

/**
 * @route   GET /api/agent/keys/:walletAddress
 * @desc    List all API keys for a wallet (masked — no raw key)
 * @access  Public
 */
router.get(
    '/keys/:walletAddress',
    generalLimiter,
    validateWalletParam,
    agentController.listKeys
);

/**
 * @route   DELETE /api/agent/keys/:keyId
 * @desc    Revoke an API key by its UUID
 * @access  Public (wallet address in body must match key owner)
 */
router.delete(
    '/keys/:keyId',
    generalLimiter,
    validateRevokeKey,
    agentController.revokeKey
);

module.exports = router;
