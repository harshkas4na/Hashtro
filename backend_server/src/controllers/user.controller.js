const userService = require("../services/user.service");
const authService = require("../services/auth.service");
const { successResponse, errorResponse } = require("../utils/response");
const logger = require("../config/logger");

/**
 * User Controller - Handles user-related HTTP requests
 */
class UserController {
  /**
   * Register a new user or update existing user
   * @route POST /api/user/register
   */
  async register(req, res, next) {
    try {
      const {
        walletAddress,
        twitterId,
        username,
        twitterUsername,
        twitterProfileUrl,
        dob,
        birthTime,
        birthPlace,
        latitude,
        longitude,
        timezoneOffset,
        privyUserId,
        privyWalletId,
      } = req.body;

      // Register/update user
      const user = await userService.registerUser({
        walletAddress,
        username,
        twitterId,
        twitterUsername,
        twitterProfileUrl,
        dob,
        birthTime,
        birthPlace,
        latitude,
        longitude,
        timezoneOffset,
        privyUserId,
        privyWalletId,
      });

      // Generate JWT token for the user
      const token = authService.generateToken(walletAddress, {
        userId: user.id,
      });

      logger.info("User registered successfully", { walletAddress });

      return successResponse(
        res,
        {
          message: "User registered successfully",
          user: {
            id: user.id,
            walletAddress: user.wallet_address,
            createdAt: user.created_at,
            username: user.username,
            twitterId: user.twitter_id,
            twitterUsername: user.twitter_username,
            twitterProfileUrl: user.twitter_profile_url,
            tradingDelegated: user.trading_delegated,
          },
          token,
        },
        201
      );
    } catch (error) {
      logger.error("Register controller error:", error);
      next(error);
    }
  }

  /**
   * Get user profile by wallet address
   * @route GET /api/user/profile/:walletAddress
   */
  async getProfile(req, res, next) {
    try {
      const { walletAddress } = req.params;

      const user = await userService.findUserByWallet(walletAddress);

      if (!user) {
        return errorResponse(res, "User not found", 404);
      }

      return successResponse(res, {
        user: {
          id: user.id,
          walletAddress: user.wallet_address,
          dob: user.dob,
          birthTime: user.birth_time,
          birthPlace: user.birth_place,
          latitude: user.latitude,
          longitude: user.longitude,
          twitterId: user.twitter_id,
          twitterUsername: user.twitter_username,
          twitterProfileUrl: user.twitter_profile_url,
          timezoneOffset: user.timezone_offset,
          createdAt: user.created_at,
          username: user.username,
          tradeMadeAt: user.trade_made_at,
          // OAuth tokens intentionally excluded — they grant write access to
          // the user's Twitter account and must not be sent to clients.
        },
      });
    } catch (error) {
      logger.error("Get profile controller error:", error);
      next(error);
    }
  }

  /**
   * Register a user X account
   * @route POST /api/user/x-account
   */
  async registerX(req, res, next) {
    try {
      const {
        id,
        twitterId,
        username,
        twitterUsername,
        twitterProfileUrl,
        twitterAccessToken,
        twitterRefreshToken,
        twitterTokenExpiresAt,
      } = req.body;

      if (
        !id ||
        (!twitterId &&
          !twitterUsername &&
          !twitterProfileUrl &&
          !twitterAccessToken &&
          !username)
      ) {
        return res.status(400).json({
          success: false,
          message: "User id and X account details are required",
        });
      }

      const user = await userService.registerXAccount({
        userId: id,
        twitterId,
        username,
        twitterUsername,
        twitterProfileUrl,
        twitterAccessToken,
        twitterRefreshToken,
        twitterTokenExpiresAt,
      });

      return successResponse(
        res,
        {
          message: "User X account linked successfully",
          user: {
            id: user.id,
            walletAddress: user.wallet_address,
            dob: user.dob,
            createdAt: user.created_at,
            username: user.username,
            twitterId: user.twitter_id,
            twitterUsername: user.twitter_username,
            twitterProfileUrl: user.twitter_profile_url,
          },
        },
        200
      );
    } catch (error) {
      logger.error("Register X controller error:", error);
      next(error);
    }
  }

  /**
   * Update user's Twitter OAuth tokens
   * @route PATCH /api/user/twitter-tokens
   */
  async updateTwitterTokens(req, res, next) {
    try {
      const { walletAddress, accessToken, refreshToken, expiresAt } = req.body;

      if (!walletAddress || !accessToken || !refreshToken || !expiresAt) {
        return errorResponse(
          res,
          "Wallet address, access token, refresh token, and expiration time are required",
          400
        );
      }

      const existingUser = await userService.findUserByWallet(walletAddress);
      if (!existingUser) {
        return errorResponse(res, "User not found", 404);
      }

      const user = await userService.updateTwitterTokens({
        walletAddress,
        accessToken,
        refreshToken,
        expiresAt,
      });

      logger.info("Twitter tokens updated successfully", { walletAddress });

      return successResponse(
        res,
        {
          message: "Twitter tokens updated successfully",
          user: {
            id: user.id,
            walletAddress: user.wallet_address,
            twitterUsername: user.twitter_username,
            twitterTokenExpiresAt: user.twitter_token_expires,
          },
        },
        200
      );
    } catch (error) {
      logger.error("Update Twitter tokens controller error:", error);
      next(error);
    }
  }

  /**
   * Register user's birth details
   * @route POST /api/user/birth-details
   */
  async registerBirth(req, res, next) {
    try {
      const {
        walletAddress,
        dob,
        birthTime,
        birthPlace,
        latitude,
        longitude,
        timezoneOffset,
      } = req.body;

      const existingUser = await userService.findUserByWallet(walletAddress);
      if (!existingUser) {
        return errorResponse(
          res,
          "User not found. Please register first.",
          404
        );
      }

      if (
        existingUser.dob &&
        existingUser.birth_time &&
        existingUser.birth_place
      ) {
        return errorResponse(
          res,
          "Birth details are already registered for this user. Use update endpoint instead.",
          409
        );
      }

      const birthDate = new Date(dob);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (birthDate > today) {
        return errorResponse(res, "Date of birth cannot be in the future", 400);
      }

      let formattedBirthTime = birthTime;
      if (birthTime && !/^([01]\d|2[0-3]):([0-5]\d)$/.test(birthTime)) {
        return errorResponse(
          res,
          "Birth time must be in HH:MM format (24-hour)",
          400
        );
      }

      if ((latitude && !longitude) || (!latitude && longitude)) {
        return errorResponse(
          res,
          "Both latitude and longitude must be provided together",
          400
        );
      }

      const birthDetails = {
        walletAddress,
        dob,
        birthTime: formattedBirthTime || null,
        birthPlace: birthPlace || null,
        latitude: latitude || null,
        longitude: longitude || null,
        timezoneOffset: timezoneOffset || null,
      };

      const updatedUser = await userService.registerBirthDetails(birthDetails);

      return successResponse(
        res,
        {
          message: "Birth details registered successfully",
          user: {
            id: updatedUser.id,
            walletAddress: updatedUser.wallet_address,
            username: updatedUser.username,
            dob: updatedUser.dob,
            birthTime: updatedUser.birth_time,
            birthPlace: updatedUser.birth_place,
            latitude: updatedUser.latitude,
            longitude: updatedUser.longitude,
            timezoneOffset: updatedUser.timezone_offset,
          },
        },
        201
      );
    } catch (error) {
      logger.error("Register birth details controller error:", error);
      next(error);
    }
  }

  /**
   * Add or update trade timestamp for a user
   * @route POST /api/user/trade-time
   */
  async addTradeTime(req, res, next) {
    try {
      const { walletAddress, tradeMadeAt } = req.body;

      if (!walletAddress || !tradeMadeAt) {
        return errorResponse(
          res,
          "Wallet address and trade timestamp are required",
          400
        );
      }

      // Validate timestamp is not in the future
      const tradeDate = new Date(tradeMadeAt);
      const now = new Date();

      if (tradeDate > now) {
        return errorResponse(
          res,
          "Trade timestamp cannot be in the future",
          400
        );
      }

      // Validate ISO format (Joi already validated, but double-check)
      if (isNaN(tradeDate.getTime())) {
        return errorResponse(
          res,
          "Invalid timestamp format. Must be a valid ISO date string",
          400
        );
      }

      // Update the trade timestamp
      const updatedUser = await userService.updateTradeTime({
        walletAddress,
        tradeMadeAt: tradeDate, // Pass as Date object
      });

      logger.info("Trade time updated successfully", {
        walletAddress,
        tradeMadeAt: tradeDate.toISOString(),
      });

      return successResponse(
        res,
        {
          message: "Trade time updated successfully",
          user: {
            id: updatedUser.id,
            walletAddress: updatedUser.wallet_address,
            tradeMadeAt: updatedUser.trade_made_at,
            updatedAt: updatedUser.updated_at,
          },
        },
        200
      );
    } catch (error) {
      logger.error("Add trade time controller error:", error);
      next(error);
    }
  }

  /**
   * Enable or disable autonomous (server-side) trading for a user.
   * Called by the frontend after the user approves/revokes Privy delegateWallet().
   * @route PATCH /api/user/trading-delegated
   */
  async setTradingDelegated(req, res, next) {
    try {
      const { walletAddress, delegated } = req.body;

      if (!walletAddress || typeof delegated !== 'boolean') {
        return errorResponse(res, 'walletAddress and delegated (boolean) are required', 400);
      }

      const existingUser = await userService.findUserByWallet(walletAddress);
      if (!existingUser) {
        return errorResponse(res, 'User not found', 404);
      }

      const updated = await userService.setTradingDelegated(walletAddress, delegated);

      logger.info('Trading delegation status updated', { walletAddress, delegated });

      return successResponse(res, {
        trading_delegated: updated.trading_delegated,
        message: delegated
          ? 'Autonomous trading enabled. The agent can now execute trades on your behalf.'
          : 'Autonomous trading disabled.',
      });
    } catch (error) {
      logger.error('setTradingDelegated controller error:', error);
      next(error);
    }
  }

  /**
   * Get trade timestamp for a user
   * @route GET /api/user/trade-time/:walletAddress
   */
  async getTradeTime(req, res, next) {
    try {
      const { walletAddress } = req.params;

      if (!walletAddress) {
        return errorResponse(res, "Wallet address is required", 400);
      }

      const user = await userService.findUserByWallet(walletAddress);
      if (!user) {
        return errorResponse(res, "abcd", 404);
      }

      return successResponse(
        res,
        {
          tradeMadeAt: user.trade_made_at,
          hasTradeTime: !!user.trade_made_at,
          user: {
            id: user.id,
            walletAddress: user.wallet_address,
            username: user.username,
          },
        },
        200
      );
    } catch (error) {
      logger.error("Get trade time controller error:", error);
      next(error);
    }
  }
}

module.exports = new UserController();
