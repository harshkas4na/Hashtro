require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./src/config/swagger');
const { getConfig, validateEnv } = require('./src/config/environment');
const { testConnection } = require('./src/config/supabase');
const logger = require('./src/config/logger');
const requestLogger = require('./src/middleware/requestLogger');
const correlationId = require('./src/middleware/correlationId');
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');
const routes = require('./src/routes');

/**
 * Initialize Express application
 */
const app = express();

// ADD THIS LINE - CRITICAL for Vercel/proxies
app.set('trust proxy', 1); // Trust first proxy

/**
 * Validate environment variables on startup
 */
try {
  validateEnv();
  logger.info('Environment variables validated successfully');
} catch (error) {
  logger.error('Environment validation failed:', error.message);
  process.exit(1);
}

const config = getConfig();

// ── Startup warnings ────────────────────────────────────────────────────────
if (!process.env.IMAGE_SIGN_SECRET) {
  logger.warn('IMAGE_SIGN_SECRET is not set — falling back to JWT_SECRET for image URL signing. Set a dedicated IMAGE_SIGN_SECRET in production.');
}

/**
 * Correlation ID — attach before any other middleware so every log line
 * can include req.requestId to trace a request end-to-end.
 */
app.use(correlationId);

/**
 * Security middleware
 */
app.use(helmet()); // Security headers
app.use(compression()); // Response compression

/**
 * CORS configuration
 */
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://localhost:3001',
    'https://www.hashtro.fun',        // Add your production domain
    'https://hashtro.fun',             // Add without www too
    'https://hastrology.vercel.app',
    'https://staging.hashtro.fun',   // If you have a Vercel frontend
    // Add any other frontend domains you use
  ],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
};
app.use(cors(corsOptions));

/**
 * Body parsing middleware
 */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Request logging
 */
if (config.server.isDevelopment) {
  app.use(requestLogger);
}

/**
 * Root endpoint
 */
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Hastrology Backend API',
    version: '2.0.0',
    environment: config.server.nodeEnv
  });
});

/**
 * Root-level health check for load balancers and uptime monitors.
 * Checks database connectivity so the probe reflects real readiness.
 */
app.get('/health', async (req, res) => {
  try {
    const dbOk = await testConnection();
    const status = dbOk ? 'ok' : 'degraded';
    res.status(dbOk ? 200 : 503).json({
      status,
      db: dbOk ? 'connected' : 'unreachable',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'error',
      db: 'unreachable',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * OpenAPI spec + Swagger UI
 * Helmet's CSP is relaxed for the docs route so the browser can run the UI scripts.
 */
app.get('/api/openapi.json', (req, res) => res.json(swaggerSpec));
app.use(
  '/api/docs',
  helmet({ contentSecurityPolicy: false }),
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Hastrology API Docs',
    swaggerOptions: { persistAuthorization: true },
  })
);

/**
 * Mount API routes
 */
app.use('/api', routes);

/**
 * Error handling
 */
app.use(notFoundHandler); // 404 handler
app.use(errorHandler); // Global error handler

/**
 * Start server
 */
const startServer = async () => {
  try {
    // Test database connection
    logger.info('Testing Supabase connection...');
    const isConnected = await testConnection();

    if (!isConnected) {
      logger.warn('Supabase connection test failed, but continuing...');
      logger.warn('Make sure to run the schema.sql in your Supabase project');
    } else {
      logger.info('✓ Supabase connection successful');
    }

    // Lottery scheduler is now initialized globally via initializeServices()


    // Start listening
    const PORT = config.server.port;
    app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📡 Environment: ${config.server.nodeEnv}`);
      logger.info(`🔗 API available at: http://localhost:${PORT}/api`);

      if (config.server.isDevelopment) {
        logger.info('💡 Development mode - detailed logging enabled');
      }
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

/**
 * Graceful shutdown
 */
process.on('SIGTERM', () => {
  logger.info('SIGTERM signal received: closing HTTP server');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT signal received: closing HTTP server');
  process.exit(0);
});


// Start the server (skip on Vercel - it uses the exported app directly)
if (!process.env.VERCEL) {
  startServer();
}

// Export app for Vercel
module.exports = app;