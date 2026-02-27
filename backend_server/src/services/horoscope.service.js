const { getSupabaseClient } = require('../config/supabase');
const logger = require('../config/logger');

/**
 * Horoscope Service - Handles horoscope database operations
 */
class HoroscopeService {
    constructor() {
        this.supabase = getSupabaseClient();
    }

    /**
     * Get today's date in YYYY-MM-DD format
     * @returns {string} Today's date
     */
    getTodayDateString() {
        // Use UTC so "today" is the same for all users regardless of their
        // location. IST (Asia/Kolkata) was biased: US users on Feb 27 would
        // receive a Feb 28 slot if IST had already crossed midnight.
        return new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    }

    /**
     * Save new horoscope cards
     * @param {Object} horoscopeData - Horoscope data with cards object
     * @returns {Promise<Object>} Saved horoscope
     */
    async saveHoroscope({ walletAddress, cards, date = null }) {
        try {
            const horoscopeDate = date || this.getTodayDateString();

            logger.info('Saving horoscope cards:', { walletAddress, date: horoscopeDate });

            // Store cards as JSON string in horoscope_text column
            const cardsJson = JSON.stringify(cards);

            const { data, error } = await this.supabase
                .from('horoscopes')
                .insert({
                    wallet_address: walletAddress,
                    date: horoscopeDate,
                    horoscope_text: cardsJson
                })
                .select()
                .single();

            if (error) {
                // Check if it's a duplicate entry error
                if (error.code === '23505') { // Unique constraint violation
                    logger.warn('Horoscope already exists for today:', { walletAddress });
                    throw new Error('HOROSCOPE_ALREADY_EXISTS');
                }
                logger.error('Save horoscope error:', error);
                throw error;
            }

            logger.info('Horoscope cards saved successfully:', { id: data.id });
            return { ...data, cards };
        } catch (error) {
            logger.error('Save horoscope error:', error);
            throw error;
        }
    }

    /**
     * Parse stored horoscope text to cards object
     * @param {string} horoscopeText - Stored JSON string
     * @returns {Object|null} Cards object or null
     */
    parseCards(horoscopeText) {
        try {
            const cards = JSON.parse(horoscopeText);

            // Map ruling_planet to ruling_planet_theme for frontend compatibility
            if (cards && cards.ruling_planet && !cards.ruling_planet_theme) {
                cards.ruling_planet_theme = cards.ruling_planet;
            }

            return cards;
        } catch {
            // If it's not JSON, it's a legacy text format
            return null;
        }
    }

    /**
     * Get horoscope cards for a specific wallet and date
     * @param {string} walletAddress - User's wallet address
     * @param {string} date - Date in YYYY-MM-DD format
     * @returns {Promise<Object|null>} Horoscope with cards or null
     */
    async getHoroscope(walletAddress, date = null) {
        try {
            const queryDate = date || this.getTodayDateString();

            const { data, error } = await this.supabase
                .from('horoscopes')
                .select('*')
                .eq('wallet_address', walletAddress)
                .eq('date', queryDate)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
                logger.error('Get horoscope error:', error);
                throw error;
            }

            if (!data) return null;

            // Parse cards from stored JSON
            const cards = this.parseCards(data.horoscope_text);
            return { ...data, cards };
        } catch (error) {
            logger.error('Get horoscope error:', error);
            throw error;
        }
    }

    /**
     * Get all horoscopes for a wallet address
     * @param {string} walletAddress - User's wallet address
     * @param {number} limit - Number of results to return
     * @returns {Promise<Array>} Array of horoscopes
     */
    async getUserHoroscopes(walletAddress, limit = 10, afterDate = null) {
        try {
            let query = this.supabase
                .from('horoscopes')
                .select('*')
                .eq('wallet_address', walletAddress)
                .order('date', { ascending: false })
                .limit(limit);

            // Cursor-based pagination: only return rows older than afterDate
            if (afterDate) {
                query = query.lt('date', afterDate);
            }

            const { data, error } = await query;

            if (error) {
                logger.error('Get user horoscopes error:', error);
                throw error;
            }

            return data || [];
        } catch (error) {
            logger.error('Get user horoscopes error:', error);
            throw error;
        }
    }

    /**
     * Check if horoscope exists for today
     * @param {string} walletAddress - User's wallet address
     * @returns {Promise<boolean>} True if horoscope exists
     */
    async todayHoroscopeExists(walletAddress) {
        const horoscope = await this.getHoroscope(walletAddress);
        return !!horoscope;
    }

    /**
     * Get user's horoscope status
     * @param {string} walletAddress - User's wallet address
     * @returns {Promise<Object>} Status object
     */
    async getHoroscopeStatus(walletAddress) {
        try {
            const todayHoroscope = await this.getHoroscope(walletAddress);

            if (todayHoroscope && todayHoroscope.cards) {
                const cardData = todayHoroscope.cards;
                const verified = todayHoroscope.verified || false;
                // Handle both old format (dict of cards) and new format (single card)
                if (cardData.front && cardData.back) {
                    // New format: single card
                    return {
                        status: 'exists',
                        card: cardData,
                        verified,
                        date: todayHoroscope.date
                    };
                } else {
                    // Old format: dict of cards (backwards compatibility)
                    return {
                        status: 'exists',
                        cards: cardData,
                        verified,
                        date: todayHoroscope.date
                    };
                }
            }

            return {
                status: 'clear_to_pay',
                message: 'No horoscope for today. Payment required to generate.'
            };
        } catch (error) {
            logger.error('Get horoscope status error:', error);
            throw error;
        }
    }

    /**
     * Mark today's horoscope as verified by trade
     * @param {string} walletAddress - User's wallet address
     * @returns {Promise<Object>} Updated horoscope row
     */
    async verifyHoroscope(walletAddress) {
        try {
            const today = this.getTodayDateString();

            const { data, error } = await this.supabase
                .from('horoscopes')
                .update({ verified: true })
                .eq('wallet_address', walletAddress)
                .eq('date', today)
                .select()
                .single();

            if (error) {
                logger.error('Verify horoscope error:', error);
                throw error;
            }

            logger.info('Horoscope verified successfully:', { walletAddress, date: today });
            return data;
        } catch (error) {
            logger.error('Verify horoscope error:', error);
            throw error;
        }
    }

    /**
     * Increment trade_attempts counter for today's horoscope.
     * Called before the trade verification check so every attempt is counted,
     * whether it succeeds or not. Uses a Postgres raw increment to avoid a
     * read-modify-write race condition.
     * @param {string} walletAddress - User's wallet address
     * @returns {Promise<number>} New trade_attempts value after increment
     */
    async incrementTradeAttempts(walletAddress) {
        try {
            const today = this.getTodayDateString();

            // Use Postgres raw SQL for atomic increment
            const { data, error } = await this.supabase.rpc('increment_trade_attempts', {
                p_wallet: walletAddress,
                p_date: today,
            });

            if (error) {
                // If the RPC doesn't exist yet (schema not migrated) log a warning
                // and fall back to a best-effort non-atomic update.
                if (error.code === 'PGRST202' || error.code === '42883') {
                    logger.warn('increment_trade_attempts RPC not found, using fallback');
                    const { data: row } = await this.supabase
                        .from('horoscopes')
                        .select('trade_attempts')
                        .eq('wallet_address', walletAddress)
                        .eq('date', today)
                        .single();
                    const current = row?.trade_attempts ?? 0;
                    await this.supabase
                        .from('horoscopes')
                        .update({ trade_attempts: current + 1 })
                        .eq('wallet_address', walletAddress)
                        .eq('date', today);
                    return current + 1;
                }
                logger.error('incrementTradeAttempts error:', error);
                throw error;
            }

            logger.info('Trade attempt counted', { walletAddress, date: today, attempts: data });
            return data;
        } catch (error) {
            // Non-fatal: don't let counter failure block the trade verification
            logger.error('incrementTradeAttempts failed (non-fatal):', error.message);
            return null;
        }
    }
}

module.exports = new HoroscopeService();
