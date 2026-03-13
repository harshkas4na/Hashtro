const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { getConfig } = require("../config/environment");
const { errorResponse } = require("../utils/response");
const logger = require("../config/logger");

const config = getConfig();

/**
 * Compute retry_after in seconds from the reset time the rate-limiter supplies.
 * Falls back to the full window if the reset time is unavailable.
 */
function retryAfterSecs(req, windowMs) {
  if (req.rateLimit && req.rateLimit.resetTime instanceof Date) {
    return Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000));
  }
  return Math.ceil(windowMs / 1000);
}

/**
 * Create rate limiter with custom error response.
 * All limiters return standardHeaders (RateLimit-Limit / -Remaining / -Reset)
 * and a structured 429 body with error, retry_after, and message.
 */
const createRateLimiter = (options = {}) => {
  const windowMs = options.windowMs || config.security.rateLimitWindowMs;
  const message = options.message || "Too many requests, please try again later";

  return rateLimit({
    windowMs,
    max: options.max || config.security.rateLimitMaxRequests,
    message,
    standardHeaders: true,  // RateLimit-Limit, -Remaining, -Reset
    legacyHeaders: false,    // no X-RateLimit-* headers
    keyGenerator: options.keyGenerator, // undefined → express-rate-limit uses IP
    handler: (req, res) => {
      logger.warn("Rate limit exceeded", { ip: req.ip, path: req.path });
      return res.status(429).json({
        success: false,
        error: "rate_limit_exceeded",
        message,
        retry_after: retryAfterSecs(req, windowMs),
      });
    },
    skip: () => process.env.NODE_ENV === "test",
  });
};

/**
 * Derive a rate-limit bucket key from the Bearer token in the Authorization header.
 * We hash the raw key (SHA-256) so the limiter never stores the key itself in memory.
 * Falls back to IP for requests that have no Bearer header (they will fail auth anyway).
 */
function agentKeyGenerator(req) {
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) {
    const raw = auth.slice(7).trim();
    return crypto.createHash("sha256").update(raw).digest("hex");
  }
  return req.ip;
}

/**
 * Create a per-API-key rate limiter for agent-authenticated endpoints.
 * Buckets are keyed by SHA-256 of the Bearer token — not by IP — so multiple
 * agents sharing a proxy / NAT box don't eat into each other's quota.
 */
const createAgentLimiter = (options = {}) =>
  createRateLimiter({ ...options, keyGenerator: agentKeyGenerator });

// ─────────────────────────────────────────────
// Shared limiter instances
// ─────────────────────────────────────────────

/** General API: 100 req / 15 min (IP-based) */
const generalLimiter = createRateLimiter();

/** Strict: 10 req / 15 min for expensive ops (IP-based) */
const strictLimiter = createRateLimiter({
  max: 10,
  message: "Too many requests for this operation, please try again later",
});

/** Auth / key-generation: 20 req / 15 min (IP-based) */
const authLimiter = createRateLimiter({
  max: 20,
  message: "Too many authentication attempts, please try again later",
});

/**
 * Agent signal & trade-attempt: 60 req / hour per API key.
 * Generous enough for a polling agent that checks every minute.
 */
const agentSignalLimiter = createAgentLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 60,
  message: "Signal rate limit exceeded. Max 60 requests per hour per API key.",
});

/**
 * Agent webhook management: 30 req / hour per API key.
 */
const agentWebhookLimiter = createAgentLimiter({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: "Webhook management rate limit exceeded. Max 30 requests per hour per API key.",
});

module.exports = {
  createRateLimiter,
  createAgentLimiter,
  generalLimiter,
  strictLimiter,
  authLimiter,
  agentSignalLimiter,
  agentWebhookLimiter,
};
