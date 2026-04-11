const crypto = require('crypto');
const { getSupabaseClient } = require('../config/supabase');
const apiKeyService = require('./apikey.service');
const logger = require('../config/logger');

// 15 minute pairing window — enough for a user to grab their phone, unlock a wallet, and approve.
const PAIRING_TTL_MS = 15 * 60 * 1000;

// User-facing codes: 8 unambiguous uppercase chars, rendered as HSTRO-XXXX-XXXX.
// We strip 0/O/1/I/L to avoid misreads.
const USER_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const DEVICE_CODE_BYTES = 32;

function randomUserCode() {
    const bytes = crypto.randomBytes(8);
    const chars = Array.from(bytes).map(b => USER_CODE_ALPHABET[b % USER_CODE_ALPHABET.length]);
    return `HSTRO-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}`;
}

function normalizeUserCode(raw) {
    if (!raw) return null;
    const cleaned = raw.toUpperCase().trim().replace(/\s+/g, '');
    // Accept both "HSTROABCDEFGH" and "HSTRO-ABCD-EFGH"
    if (!cleaned.startsWith('HSTRO')) return null;
    const rest = cleaned.slice(5).replace(/-/g, '');
    if (rest.length !== 8) return null;
    return `HSTRO-${rest.slice(0, 4)}-${rest.slice(4, 8)}`;
}

function hashDeviceCode(deviceCode) {
    return crypto.createHash('sha256').update(deviceCode).digest('hex');
}

class PairingService {
    constructor() {
        this.supabase = getSupabaseClient();
    }

    /**
     * Step 1 — agent initiates pairing.
     * Returns a deviceCode (secret, agent-only) and a userCode (short, human-pasteable).
     */
    async initiate({ agentName }) {
        const deviceCode = crypto.randomBytes(DEVICE_CODE_BYTES).toString('base64url');
        const deviceCodeHash = hashDeviceCode(deviceCode);

        // Retry a couple of times on the astronomically-small chance of a userCode collision.
        let userCode;
        let inserted = null;
        for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
            userCode = randomUserCode();
            const expiresAt = new Date(Date.now() + PAIRING_TTL_MS).toISOString();

            const { data, error } = await this.supabase
                .from('agent_pairing_codes')
                .insert({
                    device_code_hash: deviceCodeHash,
                    user_code: userCode,
                    agent_name: (agentName || 'Agent').slice(0, 50),
                    status: 'pending',
                    expires_at: expiresAt,
                })
                .select('id, expires_at')
                .single();

            if (!error) {
                inserted = data;
                break;
            }
            if (error.code !== '23505') {
                logger.error('pairing.initiate DB error:', error);
                throw error;
            }
            // 23505 = unique violation → try a fresh userCode
        }

        if (!inserted) {
            throw new Error('Could not allocate pairing code, please retry');
        }

        logger.info('Agent pairing initiated', { userCode, agentName });

        return {
            deviceCode,
            userCode,
            expiresAt: inserted.expires_at,
            expiresIn: Math.floor(PAIRING_TTL_MS / 1000),
            pollInterval: 3,
        };
    }

    /**
     * Step 2 — agent polls with the deviceCode.
     * Returns pending / approved (+ apiKey, one-shot) / consumed / expired.
     */
    async poll({ deviceCode }) {
        if (!deviceCode || typeof deviceCode !== 'string') {
            return { status: 'invalid' };
        }

        const deviceCodeHash = hashDeviceCode(deviceCode);

        const { data: row, error } = await this.supabase
            .from('agent_pairing_codes')
            .select('id, status, wallet_address, agent_name, expires_at, api_key_id')
            .eq('device_code_hash', deviceCodeHash)
            .single();

        if (error || !row) {
            return { status: 'invalid' };
        }

        // Expiry check — applies to all statuses except 'consumed' (already delivered key)
        if (row.status !== 'consumed' && new Date(row.expires_at).getTime() < Date.now()) {
            await this.supabase
                .from('agent_pairing_codes')
                .update({ status: 'expired' })
                .eq('id', row.id);
            return { status: 'expired' };
        }

        if (row.status === 'pending') {
            return { status: 'pending' };
        }

        if (row.status === 'expired') {
            return { status: 'expired' };
        }

        if (row.status === 'consumed') {
            // Already returned the key once — do NOT return it again.
            return { status: 'consumed' };
        }

        // status === 'approved' → mint a real api key, mark consumed, return once.
        if (row.status === 'approved' && row.wallet_address) {
            try {
                const { rawKey, keyPrefix, id: keyId } = await apiKeyService.generateKey(
                    row.wallet_address,
                    row.agent_name || 'Paired Agent',
                );

                const { error: updateErr } = await this.supabase
                    .from('agent_pairing_codes')
                    .update({
                        status: 'consumed',
                        consumed_at: new Date().toISOString(),
                        api_key_id: keyId,
                    })
                    .eq('id', row.id)
                    .eq('status', 'approved'); // guard against double-consumption race

                if (updateErr) {
                    logger.error('pairing.poll consume update error:', updateErr);
                    throw updateErr;
                }

                logger.info('Agent pairing consumed', { walletAddress: row.wallet_address, keyId });

                return {
                    status: 'approved',
                    apiKey: rawKey,
                    keyPrefix,
                    walletAddress: row.wallet_address,
                };
            } catch (err) {
                logger.error('pairing.poll mint error:', err);
                throw err;
            }
        }

        return { status: 'invalid' };
    }

    /**
     * Step 3 — user pastes the userCode in /connect after authenticating with their wallet.
     * Binds the code to the wallet and flips status to 'approved'.
     * Does NOT return the api key — the agent gets it on its next poll.
     */
    async claim({ userCode, walletAddress }) {
        const normalized = normalizeUserCode(userCode);
        if (!normalized) {
            return { ok: false, reason: 'invalid_code', message: 'That code does not look right. Double-check it and try again.' };
        }

        const { data: row, error } = await this.supabase
            .from('agent_pairing_codes')
            .select('id, status, agent_name, expires_at')
            .eq('user_code', normalized)
            .single();

        if (error || !row) {
            return { ok: false, reason: 'not_found', message: 'Code not found. It may have expired — ask your agent to start over.' };
        }

        if (new Date(row.expires_at).getTime() < Date.now()) {
            await this.supabase
                .from('agent_pairing_codes')
                .update({ status: 'expired' })
                .eq('id', row.id);
            return { ok: false, reason: 'expired', message: 'That code expired. Ask your agent to start over.' };
        }

        if (row.status !== 'pending') {
            return { ok: false, reason: 'already_claimed', message: 'This code was already used.' };
        }

        const { error: updateErr } = await this.supabase
            .from('agent_pairing_codes')
            .update({
                status: 'approved',
                wallet_address: walletAddress,
                approved_at: new Date().toISOString(),
            })
            .eq('id', row.id)
            .eq('status', 'pending');

        if (updateErr) {
            logger.error('pairing.claim update error:', updateErr);
            throw updateErr;
        }

        logger.info('Agent pairing approved', { walletAddress, agentName: row.agent_name });

        return {
            ok: true,
            agentName: row.agent_name || 'Agent',
        };
    }

    /**
     * Non-sensitive lookup used by /connect to show "Agent X wants to pair" before the user confirms.
     */
    async lookup({ userCode }) {
        const normalized = normalizeUserCode(userCode);
        if (!normalized) return null;

        const { data, error } = await this.supabase
            .from('agent_pairing_codes')
            .select('agent_name, status, expires_at')
            .eq('user_code', normalized)
            .single();

        if (error || !data) return null;

        const expired = new Date(data.expires_at).getTime() < Date.now();
        return {
            agentName: data.agent_name || 'Agent',
            status: expired ? 'expired' : data.status,
            expiresAt: data.expires_at,
        };
    }
}

module.exports = new PairingService();
