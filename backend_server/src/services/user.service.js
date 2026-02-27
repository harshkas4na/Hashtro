const { getSupabaseClient } = require("../config/supabase");
const logger = require("../config/logger");

/**
 * User Service - Handles all user-related database operations
 */
class UserService {
  constructor() {
    this.supabase = getSupabaseClient();
  }

  /**
   * Register or update a user
   * @param {Object} userData - User registration data
   * @returns {Promise<Object>} Created/updated user
   */
  async registerUser({
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
  }) {
    try {
      logger.info("Registering user:", { walletAddress });

      // Use upsert to create or update user
      const { data, error } = await this.supabase
        .from("users")
        .upsert(
          {
            wallet_address: walletAddress,
            updated_at: new Date().toISOString(),
            username: username,
            twitter_id: twitterId,
            twitter_username: twitterUsername,
            twitter_profile_url: twitterProfileUrl,
            dob: dob,
            birth_time: birthTime,
            birth_place: birthPlace,
            latitude: latitude,
            longitude: longitude,
            timezone_offset: timezoneOffset,
          },
          {
            onConflict: "wallet_address",
            returning: "representation",
          }
        )
        .select()
        .single();

      if (error) {
        logger.error("User registration error:", error);
        throw error;
      }

      logger.info("User registered successfully:", { userId: data.id });
      return data;
    } catch (error) {
      logger.error("User service error:", error);
      throw error;
    }
  }

  /**
   * Update a user birth details
   * @param {Object} userData - User birth data
   * @returns {Promise<Object>} Updated user data
   */
  async registerBirthDetails({
    walletAddress,
    dob,
    birthTime,
    birthPlace,
    latitude,
    longitude,
    timezoneOffset,
  }) {
    try {
      logger.info("Registering user birth details:", { walletAddress });

      // Use upsert to create or update user birth details
      const { data, error } = await this.supabase
        .from("users")
        .update({
          dob: dob,
          birth_time: birthTime,
          birth_place: birthPlace,
          latitude: latitude || null,
          longitude: longitude || null,
          timezone_offset: timezoneOffset || null,
          updated_at: new Date().toISOString(),
        })
        .eq("wallet_address", walletAddress)
        .select()
        .single();

      if (error) {
        logger.error("User birth registration error:", error);
        throw error;
      }

      logger.info("User birth details registered successfully:", {
        userId: data.id,
      });
      return data;
    } catch (error) {
      logger.error("User service error:", error);
      throw error;
    }
  }

  /**
   * Update user's X (Twitter) account details
   * @param {Object} params
   * @param {string} params.userId - User UUID
   * @param {string} params.twitterId - X user ID
   * @param {string} params.twitterUsername - X username
   * @returns {Promise<Object>} Updated user
   */
  async registerXAccount({
    userId,
    twitterId,
    username,
    twitterUsername,
    twitterProfileUrl,
    twitterAccessToken,
    twitterRefreshToken,
    twitterTokenExpiresAt,
  }) {
    try {
      logger.info("Updating X account for user:", { userId });

      const { data, error } = await this.supabase
        .from("users")
        .update({
          twitter_id: twitterId,
          username: username,
          twitter_username: twitterUsername,
          twitter_profile_url: twitterProfileUrl,
          twitter_access_token: twitterAccessToken,
          twitter_refresh_token: twitterRefreshToken,
          twitter_token_expires: twitterTokenExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .select()
        .single();

      if (error) {
        logger.error("X account update error:", error);
        throw error;
      }

      logger.info("X account updated successfully:", { userId });
      return data;
    } catch (error) {
      logger.error("User service error:", error);
      throw error;
    }
  }

  /**
   * Find user by wallet address
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<Object|null>} User object or null
   */
  async findUserByWallet(walletAddress) {
    try {
      const { data, error } = await this.supabase
        .from("users")
        .select("*")
        .eq("wallet_address", walletAddress)
        .single();

      if (error && error.code !== "PGRST116") {
        // PGRST116 = no rows returned
        logger.error("Find user error:", error);
        throw error;
      }

      return data || null;
    } catch (error) {
      logger.error("Find user error:", error);
      throw error;
    }
  }

  /**
   * Get user by ID
   * @param {string} userId - User's UUID
   * @returns {Promise<Object|null>} User object or null
   */
  async getUserById(userId) {
    try {
      const { data, error } = await this.supabase
        .from("users")
        .select("*")
        .eq("id", userId)
        .single();

      if (error && error.code !== "PGRST116") {
        logger.error("Get user error:", error);
        throw error;
      }

      return data || null;
    } catch (error) {
      logger.error("Get user error:", error);
      throw error;
    }
  }

  /**
   * Update user information
   * @param {string} walletAddress - User's wallet address
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated user
   */
  async updateUser(walletAddress, updates) {
    try {
      const { data, error } = await this.supabase
        .from("users")
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq("wallet_address", walletAddress)
        .select()
        .single();

      if (error) {
        logger.error("Update user error:", error);
        throw error;
      }

      logger.info("User updated successfully:", { walletAddress });
      return data;
    } catch (error) {
      logger.error("Update user error:", error);
      throw error;
    }
  }

  /**
   * Check if user exists
   * @param {string} walletAddress - User's wallet address
   * @returns {Promise<boolean>} True if user exists
   */
  async userExists(walletAddress) {
    const user = await this.findUserByWallet(walletAddress);
    return !!user;
  }

  /**
   * Update user's Twitter OAuth tokens
   * @param {Object} params
   * @param {string} params.walletAddress - User's wallet address
   * @param {string} params.accessToken - New access token
   * @param {string} params.refreshToken - New refresh token
   * @param {string} params.expiresAt - Token expiration time (ISO string)
   * @returns {Promise<Object>} Updated user
   */
  async updateTwitterTokens({
    walletAddress,
    accessToken,
    refreshToken,
    expiresAt,
  }) {
    try {
      logger.info("Updating Twitter tokens for user:", { walletAddress });

      const { data, error } = await this.supabase
        .from("users")
        .update({
          twitter_access_token: accessToken,
          twitter_refresh_token: refreshToken,
          twitter_token_expires: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("wallet_address", walletAddress)
        .select()
        .single();

      if (error) {
        logger.error("Twitter tokens update error:", error);
        throw error;
      }

      logger.info("Twitter tokens updated successfully:", { walletAddress });
      return data;
    } catch (error) {
      logger.error("Update Twitter tokens error:", error);
      throw error;
    }
  }

  /**
   * Update trade timestamp for a user
   * @param {Object} params - Update parameters
   * @param {string} params.walletAddress - User's wallet address
   * @param {Date} params.tradeMadeAt - Trade timestamp
   * @returns {Promise<Object>} Updated user
   */
  async updateTradeTime({ walletAddress, tradeMadeAt }) {
    try {
      logger.info("Updating trade time for user:", { walletAddress });

      // Update the "last trade" shortcut on the users row (kept for fast
      // "did the user trade today?" checks in HoroscopeReveal).
      const { data, error } = await this.supabase
        .from("users")
        .update({
          trade_made_at: tradeMadeAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("wallet_address", walletAddress)
        .select()
        .single();

      if (error) {
        logger.error("Trade time update error:", error);
        throw error;
      }

      // Insert a permanent history record so we never lose past trades.
      // The horoscope_date is today's UTC date (the day the horoscope was
      // generated for). Non-fatal on failure — don't let a failed INSERT
      // roll back the user-facing trade confirmation.
      const todayUtc = new Date().toISOString().slice(0, 10);
      const { error: tradeInsertError } = await this.supabase
        .from("trades")
        .insert({
          wallet_address: walletAddress,
          horoscope_date: todayUtc,
          traded_at: tradeMadeAt.toISOString(),
        });
      if (tradeInsertError) {
        logger.warn("Failed to insert trade history record (non-fatal):", tradeInsertError);
      }

      logger.info("Trade time updated successfully:", {
        walletAddress,
        tradeMadeAt: tradeMadeAt.toISOString(),
      });
      return data;
    } catch (error) {
      logger.error("Update trade time error:", error);
      throw error;
    }
  }
}

module.exports = new UserService();
