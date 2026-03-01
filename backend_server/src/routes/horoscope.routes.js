const express = require('express');
const horoscopeController = require('../controllers/horoscope.controller');
const { validateHoroscopeConfirm, validateHoroscopeVerify } = require('../middleware/validation');
const { generalLimiter, strictLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

/**
 * @swagger
 * /horoscope/status:
 *   get:
 *     summary: Get horoscope status for a wallet
 *     description: |
 *       Returns whether a horoscope exists for today and, if so, the full card.
 *       Agents can use `GET /agent/signal` instead — it's cleaner and auto-generates.
 *     tags: [Horoscope]
 *     parameters:
 *       - in: query
 *         name: walletAddress
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/WalletAddress'
 *     responses:
 *       200:
 *         description: |
 *           Status returned. The `status` field drives the response shape:
 *           - `new_user` — wallet is not registered. Only `status` is present.
 *           - `clear_to_pay` — registered but no horoscope generated today. Only `status` is present.
 *           - `exists` — horoscope exists for today. `card`, `verified`, and `date` are present.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 status:
 *                   type: string
 *                   enum: [new_user, exists, clear_to_pay]
 *                   description: "`new_user` = not registered, `clear_to_pay` = registered but no card today, `exists` = card available"
 *                 card:
 *                   $ref: '#/components/schemas/HoroscopeCard'
 *                   description: Present only when status = exists
 *                 verified:
 *                   type: boolean
 *                   description: Present only when status = exists
 *                 date:
 *                   type: string
 *                   format: date
 *                   description: Present only when status = exists
 */
router.get(
    '/status',
    generalLimiter,
    horoscopeController.getStatus
);

/**
 * @swagger
 * /horoscope/confirm:
 *   post:
 *     summary: Generate today's horoscope card
 *     description: |
 *       Generates a horoscope card for the wallet. Payment is currently disabled
 *       (free mode). Returns the existing card if one was already generated today.
 *
 *       Fires a `horoscope_ready` webhook event on generation.
 *     tags: [Horoscope]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress]
 *             properties:
 *               walletAddress:
 *                 $ref: '#/components/schemas/WalletAddress'
 *               signature:
 *                 type: string
 *                 description: Transaction signature (required when payment is enabled)
 *     responses:
 *       200:
 *         description: Card generated or returned from cache
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 card:
 *                   $ref: '#/components/schemas/HoroscopeCard'
 *                 date:
 *                   type: string
 *                   format: date
 *       404:
 *         description: User not found
 *       503:
 *         description: AI server unavailable
 */
router.post(
    '/confirm',
    strictLimiter,
    validateHoroscopeConfirm,
    horoscopeController.confirm
);

/**
 * @swagger
 * /horoscope/verify:
 *   post:
 *     summary: Verify horoscope via a profitable trade
 *     description: |
 *       Marks today's horoscope as verified when a profitable trade is confirmed
 *       on-chain. Only profitable trades (pnlPercent > 0) are accepted.
 *
 *       Fires a `trade_verified` webhook event on success.
 *     tags: [Horoscope]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [walletAddress, txSig, pnlPercent]
 *             properties:
 *               walletAddress:
 *                 $ref: '#/components/schemas/WalletAddress'
 *               txSig:
 *                 type: string
 *                 description: On-chain transaction signature
 *               pnlPercent:
 *                 type: number
 *                 description: Profit/loss percentage — must be strictly greater than 0 (break-even trades are rejected)
 *                 exclusiveMinimum: 0
 *                 example: 5.2
 *     responses:
 *       200:
 *         description: Horoscope verified
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 verified:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Losing or break-even trade (pnlPercent must be > 0)
 *       404:
 *         description: User not found
 */
router.post(
    '/verify',
    strictLimiter,
    validateHoroscopeVerify,
    horoscopeController.verify
);

/**
 * @swagger
 * /horoscope/history/{walletAddress}:
 *   get:
 *     summary: Get horoscope history
 *     description: Returns paginated horoscope history for a wallet. Use `after_date` for cursor-based pagination.
 *     tags: [Horoscope]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           $ref: '#/components/schemas/WalletAddress'
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *       - in: query
 *         name: after_date
 *         schema:
 *           type: string
 *           format: date
 *         description: Cursor — returns records older than this date
 *     responses:
 *       200:
 *         description: History returned
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 count:
 *                   type: integer
 *                 next_cursor:
 *                   type: string
 *                   format: date
 *                   nullable: true
 *                 horoscopes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       horoscopeText:
 *                         type: string
 *                         nullable: true
 *                         description: The raw horoscope text (legacy field; full card is in the card field)
 *                       verified:
 *                         type: boolean
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 */
router.get(
    '/history/:walletAddress',
    generalLimiter,
    horoscopeController.getHistory
);

module.exports = router;
