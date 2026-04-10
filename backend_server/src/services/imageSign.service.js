const crypto = require('crypto');
const { getConfig } = require('../config/environment');

function getSecret() {
    const { security } = getConfig();
    // Dedicated secret if configured, otherwise fall back to JWT_SECRET so
    // dev setups keep working without an extra env var.
    return process.env.IMAGE_SIGN_SECRET || security.jwtSecret;
}

function sign(payload) {
    return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex').slice(0, 32);
}

/**
 * Build a signed URL for the daily card image.
 * The frontend /api/og/card route re-verifies the sig before rendering.
 */
function cardImageUrl({ frontendUrl, walletAddress, date }) {
    const payload = `card:${walletAddress}:${date}`;
    const sig = sign(payload);
    const qs = new URLSearchParams({ w: walletAddress, d: date, s: sig });
    return `${frontendUrl}/api/og/card?${qs.toString()}`;
}

/**
 * Build a signed URL for a trade position/result image.
 * pnl may be null for an open position; non-null once the trade has closed.
 */
function tradeImageUrl({ frontendUrl, direction, ticker, leverage, entry, exit = null, pnl = null, status = 'open' }) {
    const parts = [
        `trade`,
        direction,
        ticker,
        String(leverage),
        String(entry),
        exit === null ? '' : String(exit),
        pnl === null ? '' : String(pnl),
        status,
    ];
    const payload = parts.join(':');
    const sig = sign(payload);
    const qs = new URLSearchParams({
        dir: direction,
        ticker,
        lev: String(leverage),
        entry: String(entry),
        status,
        s: sig,
    });
    if (exit !== null) qs.set('exit', String(exit));
    if (pnl !== null) qs.set('pnl', String(pnl));
    return `${frontendUrl}/api/og/trade?${qs.toString()}`;
}

/**
 * Verify a signature for a given payload.
 * Used by a public backend endpoint if/when the frontend og route proxies through us.
 */
function verify(payload, sig) {
    if (!sig) return false;
    const expected = sign(payload);
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}

module.exports = { sign, verify, cardImageUrl, tradeImageUrl };
