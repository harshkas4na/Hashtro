const apiKeyService = require('../services/apikey.service');
const userService = require('../services/user.service');
const horoscopeService = require('../services/horoscope.service');
const aiService = require('../services/ai.service');
const twitterService = require('../services/twitter.service');
const webhookService = require('../services/webhook.service');
const privyService = require('../services/privy.service');
const { buildOpenPositionTx, buildClosePositionTx, getTokenPrice } = require('../services/flash-trade.service');
const { getConfig } = require('../config/environment');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../config/logger');

// Maximum USDC collateral per autonomous trade (safety cap)
const MAX_TRADE_AMOUNT_USD = 1000;

const AGENT_MAX_RETRIES = 10;

// ─── Asset mapping (lucky_color → ticker) ─────────────────────────────────────
// Mirrors the same mapping used by the AI server and the frontend.
// Applied here as a fallback so ticker/max_leverage are always populated even
// when the AI server returns a cached card that was generated before enrichment.
const COLORS_TO_TICKERS = (() => {
    try {
        return require('../knowledge/asset_mappings.json').colors_to_tickers || {};
    } catch {
        return {};
    }
})();

/**
 * Look up asset info from a lucky_color string.
 * Tries exact match first, then case-insensitive, then returns null.
 */
function lookupAssetByColor(color) {
    if (!color) return null;
    if (COLORS_TO_TICKERS[color]) return COLORS_TO_TICKERS[color];
    const lower = color.toLowerCase();
    for (const [k, v] of Object.entries(COLORS_TO_TICKERS)) {
        if (k.toLowerCase() === lower) return v;
    }
    return null;
}

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

    const luckScore   = front.luck_score ?? null;
    const hasWarning  = back.remedy != null;
    const luckyNumber = assets.number ? parseInt(assets.number, 10) : null;

    // Resolve ticker + max_leverage from lucky_color if the AI server didn't enrich them.
    // This handles stale cached cards returned by the AI server.
    const colorInfo   = (!assets.ticker || !assets.max_leverage)
        ? lookupAssetByColor(assets.color)
        : null;

    const ticker     = assets.ticker      ?? colorInfo?.ticker      ?? null;
    const assetName  = assets.name        ?? colorInfo?.name        ?? null;
    const assetEmoji = assets.emoji       ?? colorInfo?.emoji       ?? null;
    const maxLeverage = assets.max_leverage ?? colorInfo?.max_leverage ?? null;

    const direction = luckScore !== null ? (luckScore > 50 ? 'LONG' : 'SHORT') : null;

    // lucky_number is the suggested leverage for today (same as frontend).
    // Cap it at 3 when there is a warning, and never exceed the asset's max_leverage ceiling.
    const baseLev = luckyNumber ?? maxLeverage;
    const leverageSuggestion = baseLev === null ? null
        : hasWarning ? Math.min(3, baseLev)
        : maxLeverage !== null ? Math.min(baseLev, maxLeverage)
        : baseLev;

    const canRetry = tradeAttemptsToday < AGENT_MAX_RETRIES && !alreadyVerified;

    return {
        direction,
        asset:               assetName,
        ticker,
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

const { Connection } = require('@solana/web3.js');

const CLOSE_DELAY_MS      = 30_000;  // wait after open before closing
const CLOSE_MAX_ATTEMPTS  = 4;       // retry close up to 4 times
const CLOSE_RETRY_DELAY   = 15_000;  // 15s between close retries

/**
 * Auto-close a position after a delay, calculate P&L, and verify the horoscope.
 * Runs fire-and-forget after executeTrade() responds to the client.
 */
async function autoCloseAndVerify({ walletAddress, side, symbol, entryPrice, leverage, privyWalletId, network, openTxSig }) {
    const { solana } = getConfig();
    const connection = new Connection(solana.rpcUrl, 'confirmed');

    logger.info('Agent auto-close: scheduled', { walletAddress, symbol, side, entryPrice, openTxSig });

    // ── Step 1: confirm the open transaction is on-chain ─────────────────────
    try {
        logger.info('Agent auto-close: waiting for open tx confirmation', { openTxSig });
        const result = await connection.confirmTransaction(openTxSig, 'confirmed');
        if (result?.value?.err) {
            logger.error('Agent auto-close: open tx failed on-chain — aborting close', {
                walletAddress, openTxSig, err: result.value.err,
            });
            return;
        }
        logger.info('Agent auto-close: open tx confirmed', { openTxSig });
    } catch (err) {
        logger.warn('Agent auto-close: could not confirm open tx, proceeding anyway', { openTxSig, error: err?.message });
    }

    // ── Step 2: wait 30s for position to fully settle ─────────────────────────
    logger.info(`Agent auto-close: waiting ${CLOSE_DELAY_MS / 1000}s before closing`, { walletAddress });
    await new Promise((resolve) => setTimeout(resolve, CLOSE_DELAY_MS));

    // ── Step 3: build + sign close tx (with retries) ─────────────────────────
    let closeTxSig;
    let closeExitPrice;

    for (let attempt = 1; attempt <= CLOSE_MAX_ATTEMPTS; attempt++) {
        logger.info(`Agent auto-close: close attempt ${attempt}/${CLOSE_MAX_ATTEMPTS}`, { walletAddress });

        try {
            const closeResult = await buildClosePositionTx({ walletAddress, side, symbol, network });
            closeExitPrice    = closeResult.exitPrice;

            closeTxSig = await privyService.signAndSendTransaction(
                privyWalletId,
                closeResult.base64Tx,
                network,
            );

            logger.info('Agent auto-close: close tx broadcast', { walletAddress, closeTxSig, exitPrice: closeExitPrice });
            break; // success — exit retry loop

        } catch (err) {
            const detail = err?.message ?? JSON.stringify(err);
            logger.error(`Agent auto-close: attempt ${attempt} failed`, { walletAddress, error: detail });

            if (attempt < CLOSE_MAX_ATTEMPTS) {
                logger.info(`Agent auto-close: retrying in ${CLOSE_RETRY_DELAY / 1000}s`, { walletAddress });
                await new Promise((resolve) => setTimeout(resolve, CLOSE_RETRY_DELAY));
            }
        }
    }

    if (!closeTxSig) {
        logger.error('Agent auto-close: all close attempts failed — giving up', { walletAddress });
        return;
    }

    // ── Step 4: calculate P&L % from entry vs exit price ─────────────────────
    const priceDelta = closeExitPrice - entryPrice;
    const pnlRaw     = side === 'long'
        ? (priceDelta / entryPrice) * leverage * 100
        : (-priceDelta / entryPrice) * leverage * 100;
    const pnlPercent = Math.round(pnlRaw * 100) / 100;

    logger.info('Agent auto-close: P&L calculated', {
        walletAddress, entryPrice, exitPrice: closeExitPrice, pnlPercent, side, leverage,
    });

    // ── Step 5: verify horoscope ──────────────────────────────────────────────
    try {
        const horoscopeService = require('../services/horoscope.service');
        const verified = await horoscopeService.verifyHoroscope(walletAddress, closeTxSig, pnlPercent);

        logger.info('Agent auto-close: horoscope verification result', { walletAddress, pnlPercent, verified });

        // ── Step 6: fire webhook ──────────────────────────────────────────────
        webhookService.deliver(walletAddress, 'trade_verified', {
            closeTxSig,
            entryPrice,
            exitPrice: closeExitPrice,
            pnlPercent,
            verified,
        }).catch(() => {});

    } catch (err) {
        logger.error('Agent auto-close: horoscope verification failed', { walletAddress, error: err?.message });
    }
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

            const { frontend } = getConfig();
            return successResponse(res, {
                wallet_address:          walletAddress,
                date:                    horoscope.date,
                horoscope_ready:         true,
                last_trade_attempt_at:   horoscope.last_trade_attempt_at ?? null,
                trade_url:               `${frontend.url}/cards`,
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
     * Send a test ping to a webhook so the owner can verify it's reachable.
     * @route POST /api/agent/webhook/:webhookId/test
     */
    async testWebhook(req, res, next) {
        try {
            const walletAddress = req.agentWallet;
            const { webhookId } = req.params;

            const result = await webhookService.sendTest(webhookId, walletAddress);

            if (!result.ok) {
                return errorResponse(res, result.error || 'Test delivery failed', result.status === undefined ? 404 : 502);
            }

            return successResponse(res, {
                delivered: true,
                http_status: result.status,
                message: 'Test ping delivered successfully.',
            });
        } catch (error) {
            logger.error('testWebhook controller error:', error);
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
     * Execute a Flash Protocol trade autonomously using Privy delegated actions.
     * Builds the transaction server-side, signs via Privy enclave, broadcasts on Solana.
     * @route POST /api/agent/execute-trade
     */
    async executeTrade(req, res, next) {
        try {
            const walletAddress = req.agentWallet;
            const { amount } = req.body;

            // ── Collateral (hardcoded) ────────────────────────────────────────
            const collateralUsd = 2; // hardcoded to $2 USDC

            // ── Load user + check delegation ──────────────────────────────────
            const user = await userService.findUserByWallet(walletAddress);
            if (!user) {
                return errorResponse(res, 'User not found. Please register first.', 404);
            }
            if (!user.privy_wallet_id) {
                return errorResponse(
                    res,
                    'Privy wallet not linked. Please re-register via the frontend to enable autonomous trading.',
                    422,
                );
            }
            if (!user.trading_delegated) {
                return errorResponse(
                    res,
                    'Autonomous trading is not enabled. Visit /agent in the app and click "Enable Autonomous Trading".',
                    403,
                );
            }

            // ── Check today's horoscope ───────────────────────────────────────
            const horoscope = await horoscopeService.getHoroscope(walletAddress);
            if (!horoscope) {
                return errorResponse(res, 'No horoscope for today. Call GET /api/agent/signal first.', 404);
            }
            if (horoscope.verified) {
                return errorResponse(res, 'Today\'s horoscope is already verified. No further trades needed.', 409);
            }
            const tradeAttempts = horoscope.trade_attempts ?? 0;
            if (tradeAttempts >= AGENT_MAX_RETRIES) {
                return errorResponse(res, `Max retries (${AGENT_MAX_RETRIES}) reached for today.`, 429);
            }

            // ── Build signal to get direction + ticker + leverage ─────────────
            const signal = buildSignal(horoscope.cards, horoscope.verified, tradeAttempts);

            if (!signal.direction) {
                return errorResponse(res, 'Signal is incomplete — missing direction.', 422);
            }

            const { solana } = getConfig();
            const side     = signal.direction === 'LONG' ? 'long' : 'short';
            const leverage = signal.leverage_suggestion ?? 1;
            const symbol   = 'ETH'; // hardcoded for now

            logger.info('Agent execute-trade: building transaction', {
                walletAddress, side, leverage, symbol, collateralUsd,
            });

            // ── Build Flash transaction (server-side) ─────────────────────────
            let buildResult;
            try {
                buildResult = await buildOpenPositionTx({
                    walletAddress,
                    side,
                    inputAmountUsd: collateralUsd,
                    leverage,
                    symbol,
                    network: solana.network,
                });
            } catch (buildErr) {
                const errMsg = buildErr instanceof Error
                    ? buildErr.message
                    : typeof buildErr === 'string'
                        ? buildErr
                        : JSON.stringify(buildErr);
                logger.error('Agent execute-trade: transaction build failed', { walletAddress, error: errMsg, stack: buildErr?.stack });
                return errorResponse(res, `Failed to build trade transaction: ${errMsg}`, 502);
            }

            // ── Sign + broadcast via Privy ────────────────────────────────────
            let txSig;
            try {
                txSig = await privyService.signAndSendTransaction(
                    user.privy_wallet_id,
                    buildResult.base64Tx,
                    solana.network,
                );
            } catch (privyErr) {
                logger.error('Agent execute-trade: Privy signing failed', { walletAddress, error: privyErr.message });
                return errorResponse(res, `Privy signing failed: ${privyErr.message}`, 502);
            }

            // ── Record attempt ────────────────────────────────────────────────
            const attemptResult = await horoscopeService.recordTradeAttempt(walletAddress);

            // ── Fire webhook (fire-and-forget) ────────────────────────────────
            webhookService.deliver(walletAddress, 'trade_executed', {
                txSig,
                direction: signal.direction,
                ticker:    symbol,
                leverage,
                collateral_usd: collateralUsd,
            }).catch(() => {});

            logger.info('Agent execute-trade: success', { walletAddress, txSig, side, symbol, leverage });

            // ── Schedule auto-close + P&L verification after 30s ─────────────
            autoCloseAndVerify({
                walletAddress,
                side,
                symbol,
                entryPrice:    buildResult.estimatedPrice,
                leverage,
                privyWalletId: user.privy_wallet_id,
                network:       solana.network,
                openTxSig:     txSig,
            }).catch((err) => logger.error('autoCloseAndVerify unhandled error', { error: err?.message }));

            const explorerBase = 'https://solscan.io/tx';

            return successResponse(res, {
                executed:             true,
                txSig,
                direction:            signal.direction,
                ticker:               symbol,
                leverage,
                collateral_usd:       collateralUsd,
                estimated_price:      buildResult.estimatedPrice,
                trade_attempts_today: attemptResult.trade_attempts,
                can_retry:            attemptResult.trade_attempts < AGENT_MAX_RETRIES,
                explorer_url:         `${explorerBase}/${txSig}`,
                auto_close_in:        '30s',
            });
        } catch (error) {
            logger.error('executeTrade controller error:', error);
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
