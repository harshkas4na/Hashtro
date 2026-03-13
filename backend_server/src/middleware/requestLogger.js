const logger = require('../config/logger');

/**
 * Request logging middleware
 * Logs all incoming requests and responses
 */
const requestLogger = (req, res, next) => {
    const startTime = Date.now();

    // Log request
    logger.info('Incoming request', {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent')
    });

    // Intercept response to log it
    const originalSend = res.send;
    res.send = function (data) {
        const duration = Date.now() - startTime;

        logger.info('Outgoing response', {
            requestId: req.requestId,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: `${duration}ms`
        });

        originalSend.call(this, data);
    };

    next();
};

module.exports = requestLogger;
