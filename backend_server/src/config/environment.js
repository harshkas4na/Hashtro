const Joi = require('joi');

/**
 * Environment variable schema definition
 */
const envSchema = Joi.object({
    // Supabase
    SUPABASE_URL: Joi.string().uri().required()
        .description('Supabase project URL'),
    SUPABASE_ANON_KEY: Joi.string().required()
        .description('Supabase anonymous key'),
    SUPABASE_SERVICE_KEY: Joi.string().required()
        .description('Supabase service role key'),

    // AI Server
    AI_SERVER_URL: Joi.string().uri().required()
        .description('Python AI server URL'),

    // Server Config
    PORT: Joi.number().port().default(5001)
        .description('Server port'),
    NODE_ENV: Joi.string().valid('development', 'production', 'test')
        .default('development')
        .description('Node environment'),

    // Security
    JWT_SECRET: Joi.string().min(32).required()
        .description('JWT signing secret (min 32 chars)'),
    RATE_LIMIT_WINDOW_MS: Joi.number().default(900000)
        .description('Rate limit window in milliseconds'),
    RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100)
        .description('Max requests per window'),

    // CORS
    ALLOWED_ORIGINS: Joi.string().default('*')
        .description('Comma-separated list of allowed CORS origins'),

    // Frontend
    FRONTEND_URL: Joi.string().uri().default('https://hashtro.fun')
        .description('Public frontend URL — used to build trade_url in agent signal'),

    // Privy — server-side delegated actions
    PRIVY_APP_ID: Joi.string().optional()
        .description('Privy App ID for server-side wallet operations'),
    PRIVY_APP_SECRET: Joi.string().optional()
        .description('Privy App Secret for server-side wallet operations'),

    // Solana
    SOLANA_RPC_URL: Joi.string().uri().default('https://api.mainnet-beta.solana.com')
        .description('Solana RPC endpoint used for building and confirming transactions'),
    SOLANA_NETWORK: Joi.string().valid('mainnet-beta', 'devnet').default('mainnet-beta')
        .description('Solana network (mainnet-beta or devnet)'),
}).unknown(true); // Allow other env vars

/**
 * Validate environment variables
 * @returns {Object} Validated environment config
 */
const validateEnv = () => {
    const { error, value } = envSchema.validate(process.env, {
        abortEarly: false,
        stripUnknown: false
    });

    if (error) {
        const missingVars = error.details.map(detail => detail.message).join('\n');
        throw new Error(`Environment validation failed:\n${missingVars}`);
    }

    return value;
};

/**
 * Get validated configuration
 */
const getConfig = () => {
    const env = validateEnv();

    return {
        supabase: {
            url: env.SUPABASE_URL,
            anonKey: env.SUPABASE_ANON_KEY,
            serviceKey: env.SUPABASE_SERVICE_KEY,
        },
        aiServer: {
            url: env.AI_SERVER_URL,
        },
        server: {
            port: env.PORT,
            nodeEnv: env.NODE_ENV,
            isDevelopment: env.NODE_ENV === 'development',
            isProduction: env.NODE_ENV === 'production',
        },
        security: {
            jwtSecret: env.JWT_SECRET,
            rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
            rateLimitMaxRequests: env.RATE_LIMIT_MAX_REQUESTS,
        },
        cors: {
            allowedOrigins: env.ALLOWED_ORIGINS === '*'
                ? '*'
                : env.ALLOWED_ORIGINS.split(',').map(o => o.trim()),
        },
        frontend: {
            url: env.FRONTEND_URL,
        },
        privy: {
            appId: env.PRIVY_APP_ID,
            appSecret: env.PRIVY_APP_SECRET,
        },
        solana: {
            rpcUrl: env.SOLANA_RPC_URL,
            network: env.SOLANA_NETWORK,
        },
    };
};

module.exports = {
    validateEnv,
    getConfig
};
