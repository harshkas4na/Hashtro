const Joi = require("joi");
const { errorResponse } = require("../utils/response");
const logger = require("../config/logger");

/**
 * Validation middleware factory
 * Creates middleware to validate request data against Joi schemas
 */
const validate = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join("."),
        message: detail.message,
      }));

      logger.warn("Validation error:", errors);
      return errorResponse(res, "Validation failed", 400, errors);
    }

    // Replace req.body with validated and sanitized data
    req.body = value;
    next();
  };
};

/**
 * User registration validation schema
 */
const userRegistrationSchema = Joi.object({
  walletAddress: Joi.string().required().trim().messages({
    "string.empty": "Wallet address is required",
    "any.required": "Wallet address is required",
  }),

  twitterId: Joi.string().required().min(1).messages({
    "string.empty": "Twitter id is required",
    "any.required": "Twitter Id is required",
  }),

  username: Joi.string().required().min(1).messages({
    "string.empty": "Username is required",
    "any.required": "Username is required",
  }),

  twitterUsername: Joi.string().required().min(1).messages({
    "string.empty": "Twitter Username is required",
    "any.required": "Twitter Username is required",
  }),

  twitterProfileUrl: Joi.string().required().min(1).messages({
    "string.empty": "Twitter Profile Url is required",
    "any.required": "Twitter Profile Url is required",
  }),
}).options({ stripUnknown: true });

/**
 * User birth details updation validation schema
 */
const birthDetailsUpdateSchema = Joi.object({
  walletAddress: Joi.string().required().trim().messages({
    "string.empty": "Wallet address is required",
    "any.required": "Wallet address is required",
  }),

  dob: Joi.string()
    .required()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .messages({
      "string.empty": "Date of birth is required",
      "any.required": "Date of birth is required",
      "string.pattern.base": "Date of birth must be in YYYY-MM-DD format",
    }),

  birthTime: Joi.string()
    .optional()
    .allow(null, "")
    .pattern(/^([01]\d|2[0-3]):([0-5]\d)$/)
    .messages({
      "string.pattern.base": "Birth time must be in HH:MM format (24-hour)",
    }),

  birthPlace: Joi.string().optional().allow(null, "").trim(),

  latitude: Joi.number().optional().allow(null).min(-90).max(90).messages({
    "number.min": "Latitude must be between -90 and 90",
    "number.max": "Latitude must be between -90 and 90",
  }),
  longitude: Joi.number().optional().allow(null).min(-180).max(180).messages({
    "number.min": "Longitude must be between -180 and 180",
    "number.max": "Longitude must be between -180 and 180",
  }),
  timezoneOffset: Joi.number()
    .optional()
    .allow(null)
    .min(-12)
    .max(14)
    .messages({
      "number.min": "Timezone offset must be between -12 and 14",
      "number.max": "Timezone offset must be between -12 and 14",
    }),
}).options({ stripUnknown: true });

/**
 * Horoscope confirmation validation schema
 */
const horoscopeConfirmSchema = Joi.object({
  walletAddress: Joi.string()
    .required()
    .min(32)
    .max(44)
    .pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .messages({
      "string.pattern.base": "Invalid Solana wallet address format",
      "string.empty": "Wallet address is required",
      "any.required": "Wallet address is required",
    }),

  signature: Joi.string().optional().allow(null, "").messages({
    "string.empty": "Transaction signature is required",
    "any.required": "Transaction signature is required",
  }),
});

/**
 * Horoscope verify (trade verification) validation schema
 */
const horoscopeVerifySchema = Joi.object({
  walletAddress: Joi.string()
    .required()
    .min(32)
    .max(44)
    .pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .messages({
      "string.pattern.base": "Invalid Solana wallet address format",
      "string.empty": "Wallet address is required",
      "any.required": "Wallet address is required",
    }),

  txSig: Joi.string().required().min(1).messages({
    "string.empty": "Transaction signature is required",
    "any.required": "Transaction signature is required",
  }),

  pnlPercent: Joi.number().required().messages({
    "number.base": "pnlPercent must be a number",
    "any.required": "pnlPercent is required",
  }),
});

/**
 * X account creation validation schema
 */
const xAccountCreationSchema = Joi.object({
  id: Joi.string().required().messages({
    "string.pattern.base": "Invalid User ID",
    "string.empty": "User ID is required",
    "any.required": "User ID is required",
  }),

  twitterId: Joi.string().required().min(1).messages({
    "string.empty": "Twitter id is required",
    "any.required": "Twitter Id is required",
  }),

  username: Joi.string().required().min(1).messages({
    "string.empty": "Username is required",
    "any.required": "Username is required",
  }),

  twitterUsername: Joi.string().required().min(1).messages({
    "string.empty": "Twitter Username is required",
    "any.required": "Twitter Username is required",
  }),

  twitterProfileUrl: Joi.string().required().min(1).messages({
    "string.empty": "Twitter Profile Url is required",
    "any.required": "Twitter Profile Url is required",
  }),

  twitterAccessToken: Joi.string().required().min(1).messages({
    "string.empty": "Access Token is required",
    "any.required": "Access Token is required",
  }),
  twitterRefreshToken: Joi.string().required().min(1).messages({
    "string.empty": "Refresh Token is required",
    "any.required": "Refresh Token is required",
  }),
  twitterTokenExpiresAt: Joi.string().required().min(1).messages({
    "string.empty": "Expired is required",
    "any.required": "Expired is required",
  }),
});

/**
 * Twitter tokens update validation schema
 */
const twitterTokensUpdateSchema = Joi.object({
  walletAddress: Joi.string()
    .required()
    .min(32)
    .max(44)
    .pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .messages({
      "string.pattern.base": "Invalid Solana wallet address format",
      "string.empty": "Wallet address is required",
      "any.required": "Wallet address is required",
    }),
  accessToken: Joi.string().required().min(1).messages({
    "string.empty": "Access token is required",
    "any.required": "Access token is required",
  }),
  refreshToken: Joi.string().required().min(1).messages({
    "string.empty": "Refresh token is required",
    "any.required": "Refresh token is required",
  }),
  expiresAt: Joi.string().required().isoDate().messages({
    "string.empty": "Expiration time is required",
    "any.required": "Expiration time is required",
    "string.isoDate": "Expiration time must be a valid ISO date",
  }),
});

/**
 * Agent key generation validation schema
 */
const generateKeySchema = Joi.object({
  walletAddress: Joi.string()
    .required()
    .min(32)
    .max(44)
    .pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .messages({
      "string.pattern.base": "Invalid Solana wallet address format",
      "string.empty": "Wallet address is required",
      "any.required": "Wallet address is required",
    }),

  label: Joi.string().min(1).max(50).default("My Agent").messages({
    "string.min": "Label must be at least 1 character",
    "string.max": "Label must be at most 50 characters",
  }),
}).options({ stripUnknown: true });

/**
 * Webhook registration validation schema
 */
const WEBHOOK_EVENTS = ['horoscope_ready', 'trade_verified', 'trade_failed'];

const webhookRegistrationSchema = Joi.object({
  url: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required()
    .messages({
      "string.uri": "url must be a valid HTTP or HTTPS URL",
      "any.required": "url is required",
    }),
  events: Joi.array()
    .items(Joi.string().valid(...WEBHOOK_EVENTS))
    .min(1)
    .required()
    .messages({
      "array.min": "At least one event must be specified",
      "any.required": "events is required",
      "any.only": `events must be one of: ${WEBHOOK_EVENTS.join(', ')}`,
    }),
}).options({ stripUnknown: true });

/**
 * Agent trade-attempt recording validation schema.
 * Agent calls this when a trade is executed (before knowing profit/loss).
 */
const tradeAttemptSchema = Joi.object({
  txSig: Joi.string().required().min(1).messages({
    "string.empty": "Transaction signature is required",
    "any.required": "Transaction signature is required",
  }),
  direction: Joi.string().valid("LONG", "SHORT").required().messages({
    "any.only": "direction must be LONG or SHORT",
    "any.required": "direction is required",
  }),
  leverage: Joi.number().positive().required().messages({
    "number.positive": "leverage must be a positive number",
    "any.required": "leverage is required",
  }),
  asset: Joi.string().required().min(1).messages({
    "string.empty": "asset is required",
    "any.required": "asset is required",
  }),
}).options({ stripUnknown: true });

/**
 * Agent key revocation validation schema
 */
const revokeKeySchema = Joi.object({
  walletAddress: Joi.string()
    .required()
    .min(32)
    .max(44)
    .pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .messages({
      "string.pattern.base": "Invalid Solana wallet address format",
      "string.empty": "Wallet address is required",
      "any.required": "Wallet address is required",
    }),
}).options({ stripUnknown: true });

const updateTimeSchema = Joi.object({
  walletAddress: Joi.string()
    .required()
    .min(32)
    .max(44)
    .pattern(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    .messages({
      "string.pattern.base": "Invalid Solana wallet address format",
      "string.empty": "Wallet address is required",
      "any.required": "Wallet address is required",
    }),
  tradeMadeAt: Joi.string().required().isoDate().messages({
    "string.empty": "Trade timestamp is required",
    "any.required": "Trade timestamp is required",
    "string.isoDate":
      "Trade timestamp must be a valid ISO date string (e.g., 2024-01-15T10:30:00.000Z)",
  }),
}).options({ stripUnknown: true });

/**
 * Validate a Solana wallet address supplied as a URL parameter.
 * Usage: router.get('/profile/:walletAddress', validateWalletParam, controller)
 */
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const validateWalletParam = (req, res, next) => {
  const { walletAddress } = req.params;
  if (!walletAddress || !SOLANA_ADDRESS_RE.test(walletAddress)) {
    logger.warn("Invalid walletAddress param:", walletAddress);
    return errorResponse(res, "Invalid Solana wallet address format", 400);
  }
  next();
};

module.exports = {
  validate,
  validateWalletParam,
  validateUserRegistration: validate(userRegistrationSchema),
  validateHoroscopeConfirm: validate(horoscopeConfirmSchema),
  validateHoroscopeVerify: validate(horoscopeVerifySchema),
  validateTwitterConfirm: validate(xAccountCreationSchema),
  validateTwitterTokensUpdate: validate(twitterTokensUpdateSchema),
  validateBirthDetailsConfirm: validate(birthDetailsUpdateSchema),
  validateAddTimeConfirm: validate(updateTimeSchema),
  validateGenerateKey: validate(generateKeySchema),
  validateRevokeKey: validate(revokeKeySchema),
  validateTradeAttempt: validate(tradeAttemptSchema),
  validateWebhookRegistration: validate(webhookRegistrationSchema),
};
