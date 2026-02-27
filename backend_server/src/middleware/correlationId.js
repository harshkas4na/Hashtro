const crypto = require('crypto');

/**
 * Correlation ID middleware.
 * Reads X-Request-ID from the incoming request (set by the client or a
 * load balancer) or generates a new UUID. Attaches the ID to req.requestId
 * and echoes it back in the X-Request-ID response header so callers can
 * link their log entries to backend log entries.
 */
const correlationId = (req, res, next) => {
    const id = req.headers['x-request-id'] || crypto.randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-ID', id);
    next();
};

module.exports = correlationId;
