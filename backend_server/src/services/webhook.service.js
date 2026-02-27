const crypto = require('crypto');
const axios  = require('axios');
const { getSupabaseClient } = require('../config/supabase');
const logger = require('../config/logger');

const MAX_RETRIES       = 3;
const RETRY_BASE_MS     = 1000; // 1s, 2s, 4s exponential backoff
const DELIVERY_TIMEOUT  = 10000; // 10s per attempt

/**
 * Webhook Service — registers, deregisters, and delivers webhook events.
 *
 * Supported events:
 *   horoscope_ready — fired after a horoscope card is generated
 *   trade_verified  — fired after a profitable trade marks the horoscope verified
 *   trade_failed    — reserved for Phase 4 (auto trade execution)
 */
class WebhookService {
    constructor() {
        this.supabase = getSupabaseClient();
    }

    /**
     * Register a new webhook endpoint for a wallet.
     * The signing secret is generated here and returned ONCE — store it server-side
     * to sign every payload, and give it to the agent to verify incoming payloads.
     *
     * @param {string} walletAddress
     * @param {string} apiKeyId       — UUID of the API key used to register
     * @param {string} url            — HTTPS endpoint that receives the events
     * @param {string[]} events       — subset of ['horoscope_ready','trade_verified','trade_failed']
     * @returns {Promise<{ id: string, secret: string }>}
     */
    async register(walletAddress, apiKeyId, url, events) {
        const secret = crypto.randomBytes(32).toString('hex'); // 64-char hex; stored raw

        const { data, error } = await this.supabase
            .from('agent_webhooks')
            .insert({
                api_key_id:     apiKeyId,
                wallet_address: walletAddress,
                url,
                secret,
                events,
                active: true,
            })
            .select('id')
            .single();

        if (error) {
            logger.error('webhook register error:', error);
            throw error;
        }

        logger.info('Webhook registered', { webhookId: data.id, walletAddress, events });
        return { id: data.id, secret };
    }

    /**
     * Deactivate a webhook. Only succeeds if the webhook belongs to the given wallet.
     *
     * @param {string} webhookId
     * @param {string} walletAddress
     * @returns {Promise<boolean>}
     */
    async deregister(webhookId, walletAddress) {
        const { data, error } = await this.supabase
            .from('agent_webhooks')
            .update({ active: false })
            .eq('id', webhookId)
            .eq('wallet_address', walletAddress)
            .select('id')
            .single();

        if (error || !data) {
            logger.warn('webhook deregister: not found or wrong owner', { webhookId, walletAddress });
            return false;
        }

        logger.info('Webhook deregistered', { webhookId, walletAddress });
        return true;
    }

    /**
     * List all webhooks for a wallet (secret omitted — never expose after registration).
     *
     * @param {string} walletAddress
     * @returns {Promise<Array>}
     */
    async list(walletAddress) {
        const { data, error } = await this.supabase
            .from('agent_webhooks')
            .select('id, url, events, active, created_at')
            .eq('wallet_address', walletAddress)
            .order('created_at', { ascending: false });

        if (error) {
            logger.error('webhook list error:', error);
            throw error;
        }

        return data || [];
    }

    /**
     * Sign a JSON payload string with a webhook secret.
     * Returns the header value: "sha256=<hmac-hex>"
     */
    _sign(payloadStr, secret) {
        const hmac = crypto.createHmac('sha256', secret);
        hmac.update(payloadStr);
        return `sha256=${hmac.digest('hex')}`;
    }

    /**
     * Deliver an event to all active webhooks registered for this wallet+event.
     * Fire-and-forget: call without await so the HTTP response is not delayed.
     * Each delivery is retried up to MAX_RETRIES times with exponential backoff.
     *
     * @param {string}   walletAddress
     * @param {string}   event          — one of the supported event names
     * @param {Object}   data           — event-specific payload
     */
    async deliver(walletAddress, event, data) {
        let webhooks;
        try {
            const { data: rows, error } = await this.supabase
                .from('agent_webhooks')
                .select('id, url, secret')
                .eq('wallet_address', walletAddress)
                .eq('active', true)
                .contains('events', [event]);

            if (error) {
                logger.warn('webhook deliver: DB fetch failed', { event, err: error.message });
                return;
            }
            webhooks = rows || [];
        } catch (err) {
            logger.warn('webhook deliver: unexpected error fetching webhooks', err.message);
            return;
        }

        if (webhooks.length === 0) return;

        const payload = {
            event,
            timestamp:      new Date().toISOString(),
            wallet_address: walletAddress,
            data,
        };
        const payloadStr = JSON.stringify(payload);

        for (const webhook of webhooks) {
            // Intentionally not awaited — delivery runs in background
            this._deliverOne(webhook, event, payloadStr).catch(err => {
                logger.error('Webhook delivery failed permanently', {
                    webhookId: webhook.id,
                    event,
                    err: err.message,
                });
            });
        }
    }

    async _deliverOne(webhook, event, payloadStr) {
        const signature = this._sign(payloadStr, webhook.secret);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                const response = await axios.post(webhook.url, payloadStr, {
                    headers: {
                        'Content-Type':           'application/json',
                        'X-Hastrology-Signature': signature,
                        'X-Hastrology-Event':     event,
                    },
                    timeout: DELIVERY_TIMEOUT,
                });

                logger.info('Webhook delivered', {
                    webhookId: webhook.id,
                    event,
                    status: response.status,
                    attempt,
                });
                return;
            } catch (err) {
                const status = err.response?.status;
                logger.warn('Webhook delivery attempt failed', {
                    webhookId: webhook.id,
                    event,
                    attempt,
                    status,
                    err: err.message,
                });

                if (attempt < MAX_RETRIES) {
                    const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
        }

        throw new Error(`Webhook delivery failed after ${MAX_RETRIES} attempts`);
    }
}

module.exports = new WebhookService();
