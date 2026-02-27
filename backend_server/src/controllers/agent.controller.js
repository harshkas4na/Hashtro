const apiKeyService = require('../services/apikey.service');
const userService = require('../services/user.service');
const horoscopeService = require('../services/horoscope.service');
const aiService = require('../services/ai.service');
const twitterService = require('../services/twitter.service');
const webhookService = require('../services/webhook.service');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../config/logger');

const AGENT_MAX_RETRIES = 2;

/**
 * Map a horoscope card to a machine-readable trading signal.
 * @param {Object} card - The card object (front + back)
 * @param {boolean} alreadyVerified
 * @param {number} tradeAttemptsToday
 * @returns {Object} signal
 */
function buildSignal(card, alreadyVerified, tradeAttemptsToday) {
    const front = card.front || {};
    const back  = card.back  || {};
    const assets = back.lucky_assets || {};

    const luckScore   = front.luck_score  ?? null;
    const maxLeverage = assets.max_leverage ?? null;
    const hasWarning  = back.remedy != null;

    const direction = luckScore !== null ? (luckScore > 50 ? 'LONG' : 'SHORT') : null;
    const leverageSuggestion = maxLeverage === null ? null
        : hasWarning ? Math.min(3, maxLeverage)
        : Math.min(5, maxLeverage);

    const canRetry = tradeAttemptsToday < AGENT_MAX_RETRIES && !alreadyVerified;

    return {
        direction,
        asset:               assets.name    ?? null,
        ticker:              assets.ticker  ?? null,
        leverage_suggestion: leverageSuggestion,
        leverage_max:        maxLeverage,
        power_hour:          assets.power_hour ?? null,
        luck_score:          luckScore,
        vibe_status:         front.vibe_status ?? null,
        zodiac_sign:         front.zodiac_sign ?? null,
        time_lord:           front.time_lord   ?? null,
        has_warning:         hasWarning,
        warning_text:        back.remedy       ?? null,
        rationale:           back.detailed_reading ?? null,
        should_trade:        !alreadyVerified && luckScore !== null,
        already_verified:    alreadyVerified,
        trade_attempts_today: tradeAttemptsToday,
        max_retries:         AGENT_MAX_RETRIES,
        can_retry:           canRetry,
    };
}

/**
 * Agent Controller — manages agent API keys
 */
class AgentController {
    /**
     * Generate a new API key for a wallet address.
     * @route POST /api/agent/keys
     */
    async generateKey(req, res, next) {
        try {
            const { walletAddress, label } = req.body;

            // Verify the wallet exists in our system
            const user = await userService.findUserByWallet(walletAddress);
            if (!user) {
                return errorResponse(res, 'User not found. Please register first.', 404);
            }

            const { rawKey, keyPrefix, id } = await apiKeyService.generateKey(walletAddress, label);

            logger.info('API key generated via controller', { walletAddress, keyId: id });

            return successResponse(res, {
                key: rawKey,
                keyPrefix,
                id,
                message: 'Save this key — it will not be shown again.',
            }, 201);
        } catch (error) {
            logger.error('generateKey controller error:', error);
            next(error);
        }
    }

    /**
     * List all API keys for a wallet address (masked — no raw key or hash).
     * @route GET /api/agent/keys/:walletAddress
     */
    async listKeys(req, res, next) {
        try {
            const { walletAddress } = req.params;

            const keys = await apiKeyService.listKeys(walletAddress);

            return successResponse(res, { keys });
        } catch (error) {
            logger.error('listKeys controller error:', error);
            next(error);
        }
    }

    /**
     * Get today's trading signal for the authenticated agent wallet.
     * Auto-generates today's horoscope if one doesn't exist yet.
     * @route GET /api/agent/signal
     */
    async getSignal(req, res, next) {
        try {
            const walletAddress = req.agentWallet; // set by agentAuth middleware

            // Load user (needed for birth details if we must auto-generate)
            const user = await userService.findUserByWallet(walletAddress);
            if (!user) {
                return errorResponse(res, 'User not found. Please register first.', 404);
            }
            if (!user.dob) {
                return errorResponse(res, 'Birth details not set. Please complete your profile.', 422);
            }

            // Try to get today's existing horoscope
            let horoscope = await horoscopeService.getHoroscope(walletAddress);

            // Auto-generate if none exists for today
            if (!horoscope) {
                logger.info('Agent signal: no horoscope today — auto-generating', { walletAddress });

                let xContext = { available: false, handle: user.twitter_username };
                try {
                    xContext = await twitterService.getEnrichedXContext(user);
                } catch (err) {
                    logger.warn('Agent signal: X context fetch failed, continuing without it', err.message);
                }

                const card = await aiService.generateHoroscope({
                    dob:             user.dob,
                    birthTime:       user.birth_time,
                    birthPlace:      user.birth_place,
                    latitude:        user.latitude,
                    longitude:       user.longitude,
                    timezoneOffset:  user.timezone_offset,
                    xHandle:         xContext.handle || user.twitter_username,
                    xBio:            xContext.bio,
                    xRecentTweets:   xContext.recentTweets,
                    xPersona:        xContext.persona,
                });

                const saved = await horoscopeService.saveHoroscope({ walletAddress, cards: card });
                horoscope = { ...saved, cards: card };
            }

            const card            = horoscope.cards;
            const alreadyVerified = horoscope.verified || false;
            const tradeAttempts   = horoscope.trade_attempts ?? 0;

            const signal = buildSignal(card, alreadyVerified, tradeAttempts);

            logger.info('Agent signal served', { walletAddress, direction: signal.direction, luckScore: signal.luck_score });

            return successResponse(res, {
                wallet_address:          walletAddress,
                date:                    horoscope.date,
                horoscope_ready:         true,
                last_trade_attempt_at:   horoscope.last_trade_attempt_at ?? null,
                ...signal,
            });
        } catch (error) {
            if (error.message === 'AI_SERVER_UNAVAILABLE') {
                return errorResponse(res, 'AI server is currently unavailable. Please try again later.', 503);
            }
            if (error.message === 'AI_SERVER_TIMEOUT') {
                return errorResponse(res, 'Horoscope generation timed out. Please try again.', 504);
            }
            logger.error('getSignal controller error:', error);
            next(error);
        }
    }

    /**
     * Record that a trade was executed for today's horoscope.
     * Agent calls this immediately after a trade is sent, before knowing the result.
     * Increments trade_attempts and stamps last_trade_attempt_at so /signal stays accurate.
     * @route POST /api/agent/trade-attempt
     */
    async recordTradeAttempt(req, res, next) {
        try {
            const walletAddress = req.agentWallet;
            const { txSig, direction, leverage, asset } = req.body;

            // Ensure horoscope exists for today before recording an attempt
            const horoscope = await horoscopeService.getHoroscope(walletAddress);
            if (!horoscope) {
                return errorResponse(res, 'No horoscope for today. Call /api/agent/signal first.', 404);
            }

            if (horoscope.verified) {
                return errorResponse(res, 'Today\'s horoscope is already verified. No further trades needed.', 409);
            }

            const tradeAttempts = horoscope.trade_attempts ?? 0;
            if (tradeAttempts >= AGENT_MAX_RETRIES) {
                return errorResponse(res, `Max retries (${AGENT_MAX_RETRIES}) reached for today.`, 429);
            }

            const result = await horoscopeService.recordTradeAttempt(walletAddress);

            logger.info('Agent trade attempt recorded', { walletAddress, txSig, direction, leverage, asset });

            return successResponse(res, {
                recorded: true,
                trade_attempts_today: result.trade_attempts,
                last_trade_attempt_at: result.last_trade_attempt_at,
                max_retries: AGENT_MAX_RETRIES,
                can_retry: result.trade_attempts < AGENT_MAX_RETRIES,
                message: 'Trade attempt recorded. Call POST /api/horoscope/verify once you know the P&L.',
            });
        } catch (error) {
            logger.error('recordTradeAttempt controller error:', error);
            next(error);
        }
    }

    /**
     * Register a webhook endpoint.
     * The signing secret is returned ONCE — agent must store it to verify payloads.
     * @route POST /api/agent/webhook
     */
    async registerWebhook(req, res, next) {
        try {
            const walletAddress = req.agentWallet;
            const apiKeyId      = req.agentKeyId;
            const { url, events } = req.body;

            const { id, secret } = await webhookService.register(walletAddress, apiKeyId, url, events);

            logger.info('Webhook registered via controller', { walletAddress, webhookId: id, events });

            return successResponse(res, {
                webhook_id: id,
                secret,
                message: 'Save this secret — it will not be shown again. Use it to verify the X-Hastrology-Signature header on incoming payloads.',
            }, 201);
        } catch (error) {
            logger.error('registerWebhook controller error:', error);
            next(error);
        }
    }

    /**
     * Deregister (deactivate) a webhook.
     * @route DELETE /api/agent/webhook/:webhookId
     */
    async deleteWebhook(req, res, next) {
        try {
            const walletAddress = req.agentWallet;
            const { webhookId } = req.params;

            const ok = await webhookService.deregister(webhookId, walletAddress);

            if (!ok) {
                return errorResponse(res, 'Webhook not found or does not belong to this wallet', 404);
            }

            return successResponse(res, { message: 'Webhook deregistered successfully' });
        } catch (error) {
            logger.error('deleteWebhook controller error:', error);
            next(error);
        }
    }

    /**
     * List all webhooks for the authenticated wallet.
     * @route GET /api/agent/webhooks
     */
    async listWebhooks(req, res, next) {
        try {
            const walletAddress = req.agentWallet;
            const webhooks = await webhookService.list(walletAddress);
            return successResponse(res, { webhooks });
        } catch (error) {
            logger.error('listWebhooks controller error:', error);
            next(error);
        }
    }

    /**
     * Revoke an API key by its UUID.
     * @route DELETE /api/agent/keys/:keyId
     */
    async revokeKey(req, res, next) {
        try {
            const { keyId } = req.params;
            const { walletAddress } = req.body;

            const revoked = await apiKeyService.revokeKey(keyId, walletAddress);

            if (!revoked) {
                return errorResponse(res, 'Key not found or does not belong to this wallet', 404);
            }

            return successResponse(res, { message: 'API key revoked successfully' });
        } catch (error) {
            logger.error('revokeKey controller error:', error);
            next(error);
        }
    }
}

module.exports = new AgentController();
