const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const logger = require('../config/logger');

// base62 alphabet: digits + uppercase + lowercase
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const KEY_PREFIX = 'hstro_sk_';
const RANDOM_LENGTH = 48;

/**
 * Generate a cryptographically random base62 string of the given length.
 * Each byte is mapped via modulo 62. The slight bias (256 % 62 = 8, so the
 * first 8 characters of the alphabet appear marginally more often) is
 * acceptable for a display token — this is not a key-derivation operation.
 */
function randomBase62(length) {
    const bytes = crypto.randomBytes(length);
    return Array.from(bytes)
        .map(b => BASE62[b % 62])
        .join('');
}

/**
 * API Key Service — manages agent API keys
 */
class ApiKeyService {
    constructor() {
        this.supabase = getSupabaseClient();
    }

    /**
     * Generate a new API key for a wallet address.
     * The raw key is returned ONCE and is never stored — only its SHA-256 hash.
     *
     * @param {string} walletAddress
     * @param {string} label - Human-readable name for the key (e.g. "OpenClaw")
     * @returns {Promise<{ rawKey: string, keyPrefix: string, id: string }>}
     */
    async generateKey(walletAddress, label) {
        const random = randomBase62(RANDOM_LENGTH);
        const rawKey = KEY_PREFIX + random;
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        // First 13 chars shown in the key list (hstro_sk_ + 4 random chars)
        const keyPrefix = rawKey.slice(0, 13);

        const { data, error } = await this.supabase
            .from('agent_api_keys')
            .insert({
                key_hash: keyHash,
                key_prefix: keyPrefix,
                wallet_address: walletAddress,
                label: label || 'My Agent',
            })
            .select('id')
            .single();

        if (error) {
            logger.error('generateKey DB error:', error);
            throw error;
        }

        logger.info('API key generated', { walletAddress, keyId: data.id, label });
        return { rawKey, keyPrefix, id: data.id };
    }

    /**
     * Validate a raw API key presented in a request.
     * Hashes it, looks it up in the DB, confirms it is not revoked,
     * and updates last_used_at.
     *
     * @param {string} rawKey
     * @returns {Promise<{ walletAddress: string } | null>} null if invalid/revoked
     */
    async validateKey(rawKey) {
        if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) {
            return null;
        }

        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const { data, error } = await this.supabase
            .from('agent_api_keys')
            .select('id, wallet_address, revoked')
            .eq('key_hash', keyHash)
            .single();

        if (error || !data) {
            return null;
        }

        if (data.revoked) {
            return null;
        }

        // Fire-and-forget last_used_at update — don't block the request on it
        this.supabase
            .from('agent_api_keys')
            .update({ last_used_at: new Date().toISOString() })
            .eq('id', data.id)
            .then(({ error: updateErr }) => {
                if (updateErr) {
                    logger.warn('Failed to update last_used_at:', updateErr.message);
                }
            });

        return { walletAddress: data.wallet_address, keyId: data.id };
    }

    /**
     * List all keys for a wallet address.
     * Never returns the hash — only display-safe fields.
     *
     * @param {string} walletAddress
     * @returns {Promise<Array>}
     */
    async listKeys(walletAddress) {
        const { data, error } = await this.supabase
            .from('agent_api_keys')
            .select('id, key_prefix, label, created_at, last_used_at, revoked')
            .eq('wallet_address', walletAddress)
            .order('created_at', { ascending: false });

        if (error) {
            logger.error('listKeys DB error:', error);
            throw error;
        }

        return data || [];
    }

    /**
     * Revoke a key by its UUID.
     * Only succeeds if the key belongs to the given wallet address.
     *
     * @param {string} keyId  - UUID of the key row
     * @param {string} walletAddress - Must match the key owner
     * @returns {Promise<boolean>} true if revoked, false if not found / not owned
     */
    async revokeKey(keyId, walletAddress) {
        const { data, error } = await this.supabase
            .from('agent_api_keys')
            .update({ revoked: true })
            .eq('id', keyId)
            .eq('wallet_address', walletAddress)
            .select('id')
            .single();

        if (error || !data) {
            logger.warn('revokeKey: not found or wrong owner', { keyId, walletAddress });
            return false;
        }

        logger.info('API key revoked', { keyId, walletAddress });
        return true;
    }
}

module.exports = new ApiKeyService();
