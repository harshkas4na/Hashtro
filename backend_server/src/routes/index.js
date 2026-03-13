const express = require('express');
const userRoutes = require('./user.routes');
const horoscopeRoutes = require('./horoscope.routes');
const agentRoutes = require('./agent.routes');

const router = express.Router();

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Hastrology API is running',
        timestamp: new Date().toISOString()
    });
});

/**
 * Mount route modules
 */
router.use('/user', userRoutes);
router.use('/horoscope', horoscopeRoutes);
router.use('/agent', agentRoutes);

/**
 * Debug routes — only available in development/test environments.
 * Never expose in production: they leak environment details.
 */
if (process.env.NODE_ENV !== 'production') {
    const debugRoutes = require('./debug.routes');
    router.use('/debug', debugRoutes);
}

module.exports = router;
