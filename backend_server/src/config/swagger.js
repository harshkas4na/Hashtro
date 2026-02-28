const swaggerJSDoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Hastrology API',
      version: '2.0.0',
      description: `
AI-powered horoscope + trading signal API for Solana wallets.

## Authentication

**Agent endpoints** require a Bearer API key in the \`Authorization\` header:
\`\`\`
Authorization: Bearer hstro_sk_...
\`\`\`

Generate a key with \`POST /agent/keys\`. Keys are per-wallet and can be revoked.

**User endpoints** are public — they require a valid Solana wallet address.

## Quick start for agents

1. Generate a key: \`POST /agent/keys\`
2. Fetch today's signal: \`GET /agent/signal\`
3. Record a trade: \`POST /agent/trade-attempt\`
4. Verify profit: \`POST /horoscope/verify\`
      `.trim(),
      contact: {
        name: 'Hastrology',
        url: 'https://hashtro.fun',
      },
    },
    servers: [
      { url: 'http://localhost:5001/api', description: 'Local development' },
      { url: 'https://api.hashtro.fun/api', description: 'Production' },
    ],
    tags: [
      { name: 'Agent', description: 'Agent authentication, signals, and webhooks' },
      { name: 'Horoscope', description: 'Horoscope generation and trade verification' },
      { name: 'User', description: 'User registration and profile management' },
    ],
    components: {
      securitySchemes: {
        AgentApiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'Agent API key (`hstro_sk_...`). Generate one at `POST /agent/keys`.',
        },
      },
      schemas: {
        // ── Shared ──────────────────────────────────────────────
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Something went wrong' },
          },
        },
        RateLimitError: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            error: { type: 'string', example: 'rate_limit_exceeded' },
            message: { type: 'string', example: 'Signal rate limit exceeded. Max 60 requests per hour per API key.' },
            retry_after: { type: 'integer', example: 3540 },
          },
        },
        WalletAddress: {
          type: 'string',
          pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
          description: 'Base58-encoded Solana public key',
          example: '4RBN5JLrqTFRbuatJgoxKcBKnpxMWq4U98rGyDxFB6e2',
        },

        // ── Agent — keys ─────────────────────────────────────────
        GenerateKeyRequest: {
          type: 'object',
          required: ['walletAddress'],
          properties: {
            walletAddress: { $ref: '#/components/schemas/WalletAddress' },
            label: { type: 'string', minLength: 1, maxLength: 50, default: 'My Agent', example: 'OpenClaw' },
          },
        },
        GenerateKeyResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            key: {
              type: 'string',
              description: 'Full raw API key — shown ONCE, store it immediately.',
              example: 'hstro_sk_V2f8kLm3Qr9...',
            },
            keyPrefix: { type: 'string', example: 'hstro_sk_V2f8' },
            id: { type: 'string', format: 'uuid' },
            message: { type: 'string', example: 'Save this key — it will not be shown again.' },
          },
        },
        ApiKey: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            key_prefix: { type: 'string', example: 'hstro_sk_V2f8' },
            label: { type: 'string', example: 'OpenClaw' },
            created_at: { type: 'string', format: 'date-time' },
            last_used_at: { type: 'string', format: 'date-time', nullable: true },
            revoked: { type: 'boolean', example: false },
          },
        },

        // ── Agent — signal ───────────────────────────────────────
        SignalResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            wallet_address: { $ref: '#/components/schemas/WalletAddress' },
            date: { type: 'string', format: 'date', example: '2026-02-28' },
            horoscope_ready: { type: 'boolean', example: true },
            direction: {
              type: 'string',
              enum: ['LONG', 'SHORT'],
              description: 'Derived from luck_score: >50 = LONG, ≤50 = SHORT',
              example: 'LONG',
            },
            asset: { type: 'string', nullable: true, example: 'Solana' },
            ticker: { type: 'string', nullable: true, example: 'SOL' },
            leverage_suggestion: {
              type: 'integer',
              nullable: true,
              description: 'Suggested leverage (capped at 3 if has_warning, 5 otherwise)',
              example: 5,
            },
            leverage_max: { type: 'integer', nullable: true, example: 10 },
            power_hour: { type: 'string', nullable: true, example: '3:00 PM' },
            luck_score: { type: 'integer', minimum: 0, maximum: 100, example: 78 },
            vibe_status: {
              type: 'string',
              enum: ['Stellar', 'Ascending', 'Shaky', 'Eclipse'],
              example: 'Ascending',
            },
            zodiac_sign: { type: 'string', example: 'Virgo' },
            time_lord: { type: 'string', example: 'Mercury' },
            has_warning: { type: 'boolean', example: false },
            warning_text: { type: 'string', nullable: true },
            should_trade: {
              type: 'boolean',
              description: 'true when horoscope is not yet verified and luck_score is available',
              example: true,
            },
            already_verified: { type: 'boolean', example: false },
            trade_attempts_today: { type: 'integer', example: 0 },
            max_retries: { type: 'integer', example: 2 },
            can_retry: { type: 'boolean', example: true },
            last_trade_attempt_at: { type: 'string', format: 'date-time', nullable: true },
            trade_url: {
              type: 'string',
              format: 'uri',
              description: 'Direct link for the user to review and execute the trade in the app',
              example: 'https://hashtro.fun/cards',
            },
            rationale: {
              type: 'string',
              nullable: true,
              description: 'Detailed astrological reasoning for the signal',
              example: 'Mercury as Time Lord with Jupiter trine amplifies...',
            },
          },
        },

        // ── Agent — trade attempt ────────────────────────────────
        TradeAttemptRequest: {
          type: 'object',
          required: ['txSig', 'direction', 'leverage', 'asset'],
          properties: {
            txSig: { type: 'string', description: 'On-chain transaction signature', example: 'abc123...' },
            direction: { type: 'string', enum: ['LONG', 'SHORT'] },
            leverage: { type: 'number', minimum: 0.1, example: 5 },
            asset: { type: 'string', example: 'SOL' },
          },
        },
        TradeAttemptResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            recorded: { type: 'boolean', example: true },
            trade_attempts_today: { type: 'integer', example: 1 },
            last_trade_attempt_at: { type: 'string', format: 'date-time' },
            max_retries: { type: 'integer', example: 2 },
            can_retry: { type: 'boolean', example: true },
            message: { type: 'string' },
          },
        },

        // ── Agent — webhooks ─────────────────────────────────────
        WebhookRegisterRequest: {
          type: 'object',
          required: ['url', 'events'],
          properties: {
            url: { type: 'string', format: 'uri', example: 'https://agent.example.com/hastrology-hook' },
            events: {
              type: 'array',
              items: { type: 'string', enum: ['horoscope_ready', 'trade_verified', 'trade_failed'] },
              minItems: 1,
              example: ['horoscope_ready', 'trade_verified'],
            },
          },
        },
        WebhookRegisterResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            webhook_id: { type: 'string', format: 'uuid' },
            secret: {
              type: 'string',
              description: 'HMAC-SHA256 signing secret — shown ONCE. Verify incoming payloads with: sha256=HMAC(secret, rawBody)',
              example: 'a3f9b2c1...',
            },
            message: { type: 'string' },
          },
        },
        Webhook: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            url: { type: 'string', format: 'uri' },
            events: { type: 'array', items: { type: 'string' } },
            active: { type: 'boolean' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        WebhookPayload: {
          type: 'object',
          description: 'Payload delivered to registered webhook URLs',
          properties: {
            event: { type: 'string', enum: ['horoscope_ready', 'trade_verified', 'trade_failed'] },
            timestamp: { type: 'string', format: 'date-time' },
            wallet_address: { $ref: '#/components/schemas/WalletAddress' },
            data: { type: 'object', description: 'Event-specific payload' },
          },
        },

        // ── Horoscope ────────────────────────────────────────────
        HoroscopeCard: {
          type: 'object',
          description: 'Complete horoscope card with front (shareable) and back (deep-dive)',
          properties: {
            front: {
              type: 'object',
              properties: {
                tagline: { type: 'string' },
                hook_1: { type: 'string' },
                hook_2: { type: 'string' },
                luck_score: { type: 'integer', minimum: 0, maximum: 100 },
                vibe_status: { type: 'string', enum: ['Stellar', 'Ascending', 'Shaky', 'Eclipse'] },
                energy_emoji: { type: 'string' },
                zodiac_sign: { type: 'string' },
                time_lord: { type: 'string' },
                profection_house: { type: 'integer', minimum: 1, maximum: 12 },
              },
            },
            back: {
              type: 'object',
              properties: {
                detailed_reading: { type: 'string' },
                hustle_alpha: { type: 'string' },
                shadow_warning: { type: 'string' },
                lucky_assets: {
                  type: 'object',
                  properties: {
                    number: { type: 'string' },
                    color: { type: 'string' },
                    power_hour: { type: 'string' },
                    ticker: { type: 'string', nullable: true },
                    name: { type: 'string', nullable: true },
                    max_leverage: { type: 'integer', nullable: true },
                  },
                },
                remedy: { type: 'string', nullable: true },
                time_lord_insight: { type: 'string' },
                planetary_blame: { type: 'string' },
              },
            },
            ruling_planet: { type: 'string' },
            sect: { type: 'string', enum: ['Diurnal', 'Nocturnal'] },
          },
        },
      },
    },
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJSDoc(options);
