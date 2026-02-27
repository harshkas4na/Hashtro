const axios = require('axios');
const { getConfig } = require('../config/environment');
const logger = require('../config/logger');

// Circuit breaker thresholds
const CB_FAILURE_THRESHOLD = 3;   // open after this many consecutive failures
const CB_RESET_TIMEOUT_MS  = 30_000; // try again after 30 s
const RETRY_DELAY_MS       = 2_000;  // base delay between retries

/** True when the error is transient and worth retrying once. */
function isRetryable(error) {
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') return true;
    if (error.response && error.response.status >= 500) return true;
    return false;
}

/** Simple delay helper. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * AI Service - Handles communication with the Python AI server
 */
class AIService {
    constructor() {
        const config = getConfig();
        this.aiServerUrl = config.aiServer.url;
        // Circuit breaker state
        this._failures  = 0;
        this._openedAt  = null; // timestamp when circuit was opened
    }

    /** Returns true when the circuit is open and calls should be rejected immediately. */
    _isOpen() {
        if (this._failures < CB_FAILURE_THRESHOLD) return false;
        if (Date.now() - this._openedAt >= CB_RESET_TIMEOUT_MS) {
            // Half-open: allow one probe attempt
            logger.info('AI circuit breaker: half-open, allowing probe request');
            return false;
        }
        return true;
    }

    _recordSuccess() {
        this._failures = 0;
        this._openedAt = null;
    }

    _recordFailure() {
        this._failures += 1;
        if (this._failures >= CB_FAILURE_THRESHOLD) {
            this._openedAt = Date.now();
            logger.warn('AI circuit breaker opened', { failures: this._failures });
        }
    }

    /**
     * Make the actual HTTP call to the AI server (no retry / CB logic here).
     */
    async _callAIServer(payload) {
        const response = await axios.post(
            `${this.aiServerUrl}/generate_horoscope`,
            payload,
            {
                timeout: 60000, // 60 second timeout (increased for card generation)
                headers: { 'Content-Type': 'application/json' },
            }
        );
        return response;
    }

    /**
     * Generate horoscope card using AI server
     * @param {Object} birthDetails - User's birth details including coordinates
     * @returns {Promise<Object>} Generated horoscope card (single card)
     */
    async generateHoroscope({ dob, birthTime, birthPlace, latitude, longitude, timezoneOffset, xHandle, xBio, xRecentTweets, xPersona }) {
        if (this._isOpen()) {
            logger.warn('AI circuit breaker is open — rejecting request');
            throw new Error('AI_SERVER_UNAVAILABLE');
        }

        const payload = {
            dob,
            birth_time: birthTime,
            birth_place: birthPlace,
            latitude: latitude || 0,
            longitude: longitude || 0,
            timezone_offset: timezoneOffset || 0,
            x_handle: xHandle || null,
            x_bio: xBio || null,
            x_recent_tweets: xRecentTweets || [],
            x_persona: xPersona || null,
        };

        logger.info('Requesting horoscope cards from AI server', { latitude, longitude, xHandle, xPersona });

        let lastError;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                const response = await this._callAIServer(payload);

                // New response format: { card: {...}, cached: bool, generation_mode: 'cdo' | 'fallback' }
                if (!response.data || !response.data.card) {
                    throw new Error('Invalid response from AI server');
                }

                logger.info('Horoscope card generated successfully', { mode: response.data.generation_mode, attempt });
                this._recordSuccess();

                const card = response.data.card;
                // Ensure ruling_planet_theme is present (frontend expects this)
                if (card && card.ruling_planet && !card.ruling_planet_theme) {
                    card.ruling_planet_theme = card.ruling_planet;
                }
                return card;

            } catch (error) {
                lastError = error;

                if (error.code === 'ECONNREFUSED') {
                    // Server not running — no point retrying
                    this._recordFailure();
                    logger.error('AI server is not running or not reachable');
                    throw new Error('AI_SERVER_UNAVAILABLE');
                }

                if (attempt === 1 && isRetryable(error)) {
                    logger.warn('AI server transient error, retrying', { code: error.code, status: error.response?.status, attempt });
                    await sleep(RETRY_DELAY_MS);
                    continue;
                }

                // Non-retryable or second attempt failed
                this._recordFailure();
                if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
                    logger.error('AI server request timeout after retries');
                    throw new Error('AI_SERVER_TIMEOUT');
                }
                logger.error('AI server error:', error.message);
                throw error;
            }
        }

        // Should not reach here, but safety net
        this._recordFailure();
        throw lastError;
    }


    /**
     * Check if AI server is healthy
     * @returns {Promise<boolean>} Health status
     */
    async healthCheck() {
        try {
            const response = await axios.get(`${this.aiServerUrl}/`, {
                timeout: 5000
            });

            return response.status === 200;
        } catch (error) {
            logger.error('AI server health check failed:', error.message);
            return false;
        }
    }
}

module.exports = new AIService();

