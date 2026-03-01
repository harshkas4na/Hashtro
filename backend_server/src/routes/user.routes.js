const express = require("express");
const userController = require("../controllers/user.controller");
const {
  validateUserRegistration,
  validateTwitterConfirm,
  validateTwitterTokensUpdate,
  validateBirthDetailsConfirm,
  validateAddTimeConfirm,
  validateWalletParam,
} = require("../middleware/validation");
const { authLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

/**
 * @swagger
 * /user/register:
 *   post:
 *     summary: Register or update a user
 *     description: Creates a new user record linked to a Solana wallet, or updates an existing one. Requires Twitter/X account details.
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress, twitterId, username, twitterUsername, twitterProfileUrl]
 *             properties:
 *               walletAddress:
 *                 $ref: '#/components/schemas/WalletAddress'
 *               twitterId:
 *                 type: string
 *               username:
 *                 type: string
 *               twitterUsername:
 *                 type: string
 *               twitterProfileUrl:
 *                 type: string
 *               dob:
 *                 type: string
 *                 description: "Date of birth as a human-readable string (e.g. 'April 20, 1995')"
 *                 example: "April 20, 1995"
 *               birthTime:
 *                 type: string
 *                 description: "Birth time (e.g. '4:30 PM')"
 *                 example: "4:30 PM"
 *               birthPlace:
 *                 type: string
 *                 example: "New Delhi, India"
 *               latitude:
 *                 type: number
 *                 example: 28.6139
 *               longitude:
 *                 type: number
 *                 example: 77.2090
 *               timezoneOffset:
 *                 type: number
 *                 description: UTC offset in hours (e.g. 5.5 for IST)
 *                 example: 5.5
 *               privyUserId:
 *                 type: string
 *                 description: Privy user DID — required for autonomous trading via execute-trade
 *                 example: "did:privy:abc123"
 *               privyWalletId:
 *                 type: string
 *                 description: Privy embedded wallet UUID — required for autonomous trading via execute-trade
 *                 example: "wallet-uuid-here"
 *     responses:
 *       201:
 *         description: User registered or updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "User registered successfully"
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                       format: uuid
 *                     walletAddress:
 *                       $ref: '#/components/schemas/WalletAddress'
 *                 token:
 *                   type: string
 *                   description: JWT token for authenticated requests
 *       400:
 *         description: Validation error
 */
router.post(
  "/register",
  authLimiter,
  validateUserRegistration,
  userController.register
);

/**
 * @swagger
 * /user/x-account:
 *   post:
 *     summary: Link an X (Twitter) account
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id, twitterId, username, twitterUsername, twitterProfileUrl, twitterAccessToken, twitterRefreshToken, twitterTokenExpiresAt]
 *             properties:
 *               id:
 *                 type: string
 *                 format: uuid
 *               twitterId:
 *                 type: string
 *               username:
 *                 type: string
 *               twitterUsername:
 *                 type: string
 *               twitterProfileUrl:
 *                 type: string
 *               twitterAccessToken:
 *                 type: string
 *               twitterRefreshToken:
 *                 type: string
 *               twitterTokenExpiresAt:
 *                 type: string
 *     responses:
 *       200:
 *         description: X account linked
 */
router.post(
  "/x-account",
  authLimiter,
  validateTwitterConfirm,
  userController.registerX
);

/**
 * @swagger
 * /user/twitter-tokens:
 *   patch:
 *     summary: Update Twitter OAuth tokens
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress, accessToken, refreshToken, expiresAt]
 *             properties:
 *               walletAddress:
 *                 $ref: '#/components/schemas/WalletAddress'
 *               accessToken:
 *                 type: string
 *               refreshToken:
 *                 type: string
 *               expiresAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Tokens updated
 */
router.patch(
  "/twitter-tokens",
  authLimiter,
  validateTwitterTokensUpdate,
  userController.updateTwitterTokens
);

/**
 * @swagger
 * /user/profile/{walletAddress}:
 *   get:
 *     summary: Get user profile
 *     tags: [User]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/WalletAddress'
 *     responses:
 *       200:
 *         description: User profile
 *       404:
 *         description: User not found
 */
router.get("/profile/:walletAddress", validateWalletParam, userController.getProfile);

/**
 * @swagger
 * /user/birth-details:
 *   post:
 *     summary: Set birth details for horoscope generation
 *     description: |
 *       Birth details are required before the AI can generate a horoscope.
 *       `dob` must be YYYY-MM-DD. `birthTime` must be HH:MM (24h). Coordinates
 *       improve accuracy but are optional.
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress, dob]
 *             properties:
 *               walletAddress:
 *                 $ref: '#/components/schemas/WalletAddress'
 *               dob:
 *                 type: string
 *                 pattern: '^\d{4}-\d{2}-\d{2}$'
 *                 example: '1995-04-20'
 *               birthTime:
 *                 type: string
 *                 pattern: '^([01]\d|2[0-3]):([0-5]\d)$'
 *                 example: '16:30'
 *               birthPlace:
 *                 type: string
 *                 example: 'New Delhi, India'
 *               latitude:
 *                 type: number
 *                 example: 28.6139
 *               longitude:
 *                 type: number
 *                 example: 77.2090
 *               timezoneOffset:
 *                 type: number
 *                 example: 5.5
 *     responses:
 *       200:
 *         description: Birth details saved
 */
router.post(
  "/birth-details",
  authLimiter,
  validateBirthDetailsConfirm,
  userController.registerBirth
);

/**
 * @swagger
 * /user/trade-time:
 *   post:
 *     summary: Record when a trade was made
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress, tradeMadeAt]
 *             properties:
 *               walletAddress:
 *                 $ref: '#/components/schemas/WalletAddress'
 *               tradeMadeAt:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Trade time recorded
 */
router.post(
  "/trade-time",
  authLimiter,
  validateAddTimeConfirm,
  userController.addTradeTime
);

/**
 * @swagger
 * /user/trading-delegated:
 *   patch:
 *     summary: Enable or disable autonomous trading
 *     description: |
 *       Called by the frontend after the user approves or revokes Privy's
 *       delegateWallet(). When enabled, the agent can execute Flash Protocol
 *       trades server-side on behalf of the user without a browser session.
 *     tags: [User]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress, delegated]
 *             properties:
 *               walletAddress:
 *                 $ref: '#/components/schemas/WalletAddress'
 *               delegated:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Delegation status updated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 trading_delegated:
 *                   type: boolean
 *                   description: The new delegation state
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Autonomous trading enabled"
 *       400:
 *         description: Missing or invalid fields
 *       404:
 *         description: User not found
 */
router.patch("/trading-delegated", authLimiter, userController.setTradingDelegated);

module.exports = router;
