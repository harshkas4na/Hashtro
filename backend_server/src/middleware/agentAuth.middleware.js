const apiKeyService = require('../services/apikey.service');
const { errorResponse } = require('../utils/response');
const logger = require('../config/logger');

/**
 * Agent authentication middleware.
 *
 * Expects:  Authorization: Bearer hstro_sk_<key>
 *
 * On success: sets req.agentWallet = walletAddress and calls next().
 * On failure: returns 401 with a generic message (never reveals why).
 */
const agentAuth = async (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';

    if (!authHeader.startsWith('Bearer ')) {
        return errorResponse(res, 'Invalid or revoked API key', 401);
    }

    const rawKey = authHeader.slice(7).trim(); // strip "Bearer "

    try {
        const result = await apiKeyService.validateKey(rawKey);

        if (!result) {
            logger.warn('agentAuth: invalid or revoked key attempted', {
                ip: req.ip,
                path: req.path,
            });
            return errorResponse(res, 'Invalid or revoked API key', 401);
        }

        req.agentWallet = result.walletAddress;
        req.agentKeyId  = result.keyId;
        next();
    } catch (error) {
        logger.error('agentAuth middleware error:', error);
        return errorResponse(res, 'Authentication error', 500);
    }
};

module.exports = agentAuth;
