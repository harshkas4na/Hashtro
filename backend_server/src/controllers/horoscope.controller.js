const userService = require('../services/user.service');
const horoscopeService = require('../services/horoscope.service');
const aiService = require('../services/ai.service');
const solanaService = require('../services/solana.service');
const twitterService = require('../services/twitter.service');
const webhookService = require('../services/webhook.service');
const imageSign = require('../services/imageSign.service');
const { successResponse, errorResponse } = require('../utils/response');
const { getConfig } = require('../config/environment');
const logger = require('../config/logger');

/**
 * Horoscope Controller - Handles horoscope-related HTTP requests
 */
class HoroscopeController {
    /**
     * Get horoscope status for a wallet address
     * @route GET /api/horoscope/status
     */
    async getStatus(req, res, next) {
        try {
            const { walletAddress } = req.query;

            if (!walletAddress) {
                return errorResponse(res, 'walletAddress is required', 400);
            }

            // Check if user exists
            const user = await userService.findUserByWallet(walletAddress);

            if (!user) {
                return successResponse(res, { status: 'new_user' });
            }

            // Get horoscope status from service (checks DB first)
            const status = await horoscopeService.getHoroscopeStatus(walletAddress);



            return successResponse(res, status);
        } catch (error) {
            logger.error('Get status controller error:', error);
            next(error);
        }
    }

    /**
     * Confirm payment and generate horoscope
     * @route POST /api/horoscope/confirm
     */
    async confirm(req, res, next) {
        try {
            const { walletAddress, signature } = req.body;

            // Verify user exists
            const user = await userService.findUserByWallet(walletAddress);

            if (!user) {
                return errorResponse(res, 'User not found. Please register first.', 404);
            }

            // Check if horoscope card already exists for today
            const existingHoroscope = await horoscopeService.getHoroscope(walletAddress);

            if (existingHoroscope && existingHoroscope.cards) {
                // Handle both old format (dict of cards) and new format (single card)
                const cardData = existingHoroscope.cards;
                // If it's a single card object (has front/back), return as card
                // Otherwise return as cards for backwards compatibility
                if (cardData.front && cardData.back) {
                    return successResponse(res, {
                        message: 'Horoscope already generated for today',
                        card: cardData,
                        date: existingHoroscope.date
                    });
                } else {
                    return successResponse(res, {
                        message: 'Horoscope already generated for today',
                        cards: cardData,
                        date: existingHoroscope.date
                    });
                }
            }

            // PAYMENT DISABLED: Horoscope generation is free for now
            // Uncomment the block below to re-enable payment verification
            /*
            // Verify lottery participation via on-chain PDA
            const hasParticipated = await solanaService.verifyLotteryParticipation(walletAddress);

            if (!hasParticipated) {
                // If PDA check fails, we can fallback to signature verification for legacy support or retry
                // But for the new lottery system, PDA is the source of truth
                logger.warn('User has not entered the lottery:', { walletAddress });
                return res.status(402).json({
                    success: false,
                    message: 'Please enter the lottery to view your horoscope'
                });
            }

            logger.info('Payment/Lottery entry verified for:', { walletAddress, signature });
            */

            logger.info('Generating horoscope card (free mode)', { walletAddress });

            // Fetch enriched X context for personalization (bio, tweets, persona)
            let xContext = { available: false, handle: user.twitter_username };
            try {
                xContext = await twitterService.getEnrichedXContext(user);
                logger.info('X context fetched:', {
                    handle: xContext.handle,
                    hasBio: !!xContext.bio,
                    tweetCount: xContext.recentTweets?.length || 0,
                    persona: xContext.persona
                });
            } catch (error) {
                logger.warn('Failed to fetch X context, continuing with basic info:', error.message);
            }

            // Generate horoscope card using AI with coordinates for CDO and enriched X context
            const card = await aiService.generateHoroscope({
                dob: user.dob,
                birthTime: user.birth_time,
                birthPlace: user.birth_place,
                latitude: user.latitude,
                longitude: user.longitude,
                timezoneOffset: user.timezone_offset,
                xHandle: xContext.handle || user.twitter_username,
                xBio: xContext.bio,
                xRecentTweets: xContext.recentTweets,
                xPersona: xContext.persona
            });


            // Save horoscope card to database (stored as single card object)
            const horoscope = await horoscopeService.saveHoroscope({
                walletAddress,
                cards: card  // Store as single card, backend service expects 'cards' key
            });

            logger.info('Horoscope card generated and saved', { walletAddress });

            // Fire-and-forget: push horoscope_ready to any registered agent webhooks
            webhookService.deliver(walletAddress, 'horoscope_ready', {
                date:       horoscope.date,
                luck_score: card.front?.luck_score ?? null,
                direction:  (card.front?.luck_score ?? 50) > 50 ? 'LONG' : 'SHORT',
                ticker:     card.back?.lucky_assets?.ticker ?? null,
            }).catch(err => logger.warn('horoscope_ready webhook delivery error:', err.message));

            return successResponse(res, {
                card: card,
                date: horoscope.date
            });
        } catch (error) {
            if (error.message === 'AI_SERVER_UNAVAILABLE') {
                return errorResponse(res, 'AI server is currently unavailable. Please try again later.', 503);
            }
            if (error.message === 'AI_SERVER_TIMEOUT') {
                return errorResponse(res, 'Horoscope generation timed out. Please try again.', 504);
            }
            if (error.message === 'HOROSCOPE_ALREADY_EXISTS') {
                return errorResponse(res, 'Horoscope already generated for today', 409);
            }

            logger.error('Confirm controller error:', error);
            next(error);
        }
    }

    /**
     * Verify horoscope via a profitable trade
     * @route POST /api/horoscope/verify
     */
    async verify(req, res, next) {
        try {
            const { walletAddress, txSig, pnlPercent } = req.body;

            // Reject break-even and losing trades server-side
            if (pnlPercent <= 0) {
                return errorResponse(res, 'Only profitable trades (pnlPercent > 0) can verify a horoscope', 400);
            }

            // Verify user exists
            const user = await userService.findUserByWallet(walletAddress);
            if (!user) {
                return errorResponse(res, 'User not found', 404);
            }

            // Count the attempt before the on-chain check (intentional: failed
            // attempts still consume quota to prevent brute-force replay).
            await horoscopeService.incrementTradeAttempts(walletAddress);

            // Verify the transaction exists on-chain.
            // In development, txSigs prefixed with "TEST_" bypass the on-chain check
            // so agents can test the full verify flow without a real transaction.
            const { server } = getConfig();
            const isTestSig = server.isDevelopment && txSig.startsWith('TEST_');
            if (!isTestSig) {
                const txValid = await solanaService.verifyTransaction(txSig);
                if (!txValid) {
                    return errorResponse(res, 'Transaction not found on-chain', 400);
                }
            }

            // Mark today's horoscope as verified
            await horoscopeService.verifyHoroscope(walletAddress);

            logger.info('Horoscope verified via trade', { walletAddress, txSig });

            // Fire-and-forget: push trade_verified to any registered agent webhooks
            webhookService.deliver(walletAddress, 'trade_verified', {
                verified:   true,
                pnl_percent: pnlPercent,
                tx_sig:     txSig,
            }).catch(err => logger.warn('trade_verified webhook delivery error:', err.message));

            return successResponse(res, { verified: true });
        } catch (error) {
            logger.error('Verify controller error:', error);
            next(error);
        }
    }

    /**
     * Get user's horoscope history
     * @route GET /api/horoscope/history/:walletAddress
     */
    async getHistory(req, res, next) {
        try {
            const { walletAddress } = req.params;
            const limit = Math.min(parseInt(req.query.limit) || 10, 50);
            const afterDate = req.query.after_date || null;

            const horoscopes = await horoscopeService.getUserHoroscopes(walletAddress, limit, afterDate);

            // next_cursor is the date of the last row — pass as after_date on the next request
            const nextCursor = horoscopes.length === limit
                ? horoscopes[horoscopes.length - 1].date
                : null;

            return successResponse(res, {
                count: horoscopes.length,
                next_cursor: nextCursor,
                horoscopes: horoscopes.map(h => ({
                    date: h.date,
                    horoscopeText: h.horoscope_text,
                    verified: h.verified || false,
                    createdAt: h.created_at
                }))
            });
        } catch (error) {
            logger.error('Get history controller error:', error);
            next(error);
        }
    }

    /**
     * Public, signed-URL endpoint used by the Next.js /api/og/card route to
     * render today's card image. Requires an HMAC signature over "card:{wallet}:{date}"
     * that only the backend (and its co-located frontend) can produce.
     * @route GET /api/horoscope/public/card
     */
    async getPublicCard(req, res, next) {
        try {
            const { w: walletAddress, d: date, s: sig } = req.query;

            if (!walletAddress || !date || !sig) {
                return errorResponse(res, 'Missing w, d, or s', 400);
            }
            if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletAddress)) {
                return errorResponse(res, 'Invalid wallet address', 400);
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
                return errorResponse(res, 'Invalid date', 400);
            }

            const payload = `card:${walletAddress}:${date}`;
            if (!imageSign.verify(payload, sig)) {
                return errorResponse(res, 'Invalid signature', 403);
            }

            const horoscope = await horoscopeService.getHoroscope(walletAddress, date);
            if (!horoscope || !horoscope.cards) {
                return errorResponse(res, 'Card not found', 404);
            }

            res.setHeader('Cache-Control', 'public, max-age=300');
            return successResponse(res, {
                walletAddress,
                date,
                card: horoscope.cards,
                verified: horoscope.verified || false,
            });
        } catch (error) {
            logger.error('getPublicCard controller error:', error);
            next(error);
        }
    }
}

module.exports = new HoroscopeController();
