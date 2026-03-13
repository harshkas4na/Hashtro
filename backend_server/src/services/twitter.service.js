const axios = require('axios');
const logger = require('../config/logger');
const userService = require('./user.service');

/**
 * Twitter Service - Fetches user profile data and tweets using Twitter API v2
 * 
 * Uses OAuth 2.0 User Context (with user access tokens) to access user data.
 * Requires: TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET for token refresh.
 */
// Cache TTL for enriched X context: 2 hours (Twitter bio/tweets change rarely)
const X_CONTEXT_TTL_MS = 2 * 60 * 60 * 1000;

class TwitterService {
    constructor() {
        this.apiBaseUrl = 'https://api.twitter.com/2';
        this.clientId = process.env.TWITTER_CLIENT_ID;
        this.clientSecret = process.env.TWITTER_CLIENT_SECRET;
        // walletAddress → { data: xContext, expiresAt: number }
        this._xContextCache = new Map();
    }

    /**
     * Refresh the user's access token if it's expired
     * @param {Object} user - User object with Twitter tokens
     * @returns {Promise<string|null>} - New access token or null if refresh fails
     */
    async refreshAccessTokenIfNeeded(user) {
        if (!user.twitter_access_token) {
            return null;
        }

        // Check if token is expired (with 5 min buffer)
        const expiresAt = user.twitter_token_expires ? new Date(user.twitter_token_expires) : null;
        const now = new Date();
        const bufferMs = 5 * 60 * 1000; // 5 minutes

        if (expiresAt && expiresAt.getTime() - bufferMs > now.getTime()) {
            // Token is still valid
            return user.twitter_access_token;
        }

        // Token is expired or will expire soon, try to refresh
        if (!user.twitter_refresh_token || !this.clientId || !this.clientSecret) {
            logger.warn('Cannot refresh Twitter token: missing refresh token or client credentials');
            return null;
        }

        try {
            const response = await axios.post(
                'https://api.twitter.com/2/oauth2/token',
                new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: user.twitter_refresh_token,
                    client_id: this.clientId,
                }),
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`
                    },
                    timeout: 10000
                }
            );

            const { access_token, refresh_token, expires_in } = response.data;
            const newExpiresAt = new Date(Date.now() + expires_in * 1000);

            // Update tokens in database
            await userService.updateTwitterTokens({
                walletAddress: user.wallet_address,
                accessToken: access_token,
                refreshToken: refresh_token || user.twitter_refresh_token,
                expiresAt: newExpiresAt
            });

            logger.info('Twitter access token refreshed successfully');
            return access_token;
        } catch (error) {
            logger.error('Failed to refresh Twitter token:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Get user profile data from Twitter (bio, name, etc.)
     * @param {string} accessToken - User's OAuth 2.0 access token
     * @returns {Promise<Object|null>} - User profile or null if failed
     */
    async getUserProfile(accessToken) {
        if (!accessToken) {
            return null;
        }

        try {
            const response = await axios.get(
                `${this.apiBaseUrl}/users/me`,
                {
                    params: {
                        'user.fields': 'description,name,username,public_metrics,profile_image_url'
                    },
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    },
                    timeout: 10000
                }
            );

            const userData = response.data?.data;
            if (!userData) {
                return null;
            }

            return {
                id: userData.id,
                name: userData.name,
                username: userData.username,
                bio: userData.description || '',
                followers: userData.public_metrics?.followers_count || 0,
                following: userData.public_metrics?.following_count || 0,
                tweetCount: userData.public_metrics?.tweet_count || 0,
                profileImage: userData.profile_image_url
            };
        } catch (error) {
            logger.error('Failed to fetch Twitter profile:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Get user's recent tweets
     * @param {string} accessToken - User's OAuth 2.0 access token
     * @param {string} userId - Twitter user ID
     * @param {number} maxResults - Max tweets to fetch (5-100, default 5)
     * @returns {Promise<string[]|null>} - Array of tweet texts or null if failed
     */
    async getRecentTweets(accessToken, userId, maxResults = 5) {
        if (!accessToken || !userId) {
            return null;
        }

        try {
            const response = await axios.get(
                `${this.apiBaseUrl}/users/${userId}/tweets`,
                {
                    params: {
                        'max_results': Math.min(Math.max(maxResults, 5), 100),
                        'tweet.fields': 'text,created_at',
                        'exclude': 'retweets,replies' // Only original tweets
                    },
                    headers: {
                        'Authorization': `Bearer ${accessToken}`
                    },
                    timeout: 10000
                }
            );

            const tweets = response.data?.data;
            if (!tweets || tweets.length === 0) {
                return [];
            }

            // Extract just the tweet texts
            return tweets.map(tweet => tweet.text);
        } catch (error) {
            // 403 might mean the user hasn't enabled tweet access in their OAuth consent
            if (error.response?.status === 403) {
                logger.warn('No permission to access user tweets');
                return [];
            }
            logger.error('Failed to fetch recent tweets:', error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Get enriched X context for horoscope personalization.
     * Results are cached per wallet address for X_CONTEXT_TTL_MS to avoid
     * two Twitter API calls on every horoscope generation.
     * @param {Object} user - User object from database
     * @returns {Promise<Object>} - X context object
     */
    async getEnrichedXContext(user) {
        if (!user || !user.twitter_access_token) {
            return {
                available: false,
                handle: user?.twitter_username || null,
                bio: null,
                recentTweets: [],
                persona: null
            };
        }

        // Return cached result if fresh
        const cacheKey = user.wallet_address;
        const cached = this._xContextCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            logger.debug('X context cache hit', { handle: user.twitter_username });
            return cached.data;
        }

        // Try to refresh token if needed
        const accessToken = await this.refreshAccessTokenIfNeeded(user);
        if (!accessToken) {
            return {
                available: false,
                handle: user.twitter_username || null,
                bio: null,
                recentTweets: [],
                persona: null
            };
        }

        // Fetch profile and tweets in parallel
        const [profile, tweets] = await Promise.all([
            this.getUserProfile(accessToken),
            this.getRecentTweets(accessToken, user.twitter_id, 5)
        ]);

        // Infer persona from bio and tweets
        const persona = this.inferPersona(profile?.bio, tweets);

        const result = {
            available: true,
            handle: profile?.username || user.twitter_username,
            bio: profile?.bio || null,
            recentTweets: tweets || [],
            followers: profile?.followers || 0,
            persona: persona
        };

        // Cache for X_CONTEXT_TTL_MS so subsequent generations in the same
        // session skip the two Twitter API calls.
        this._xContextCache.set(cacheKey, {
            data: result,
            expiresAt: Date.now() + X_CONTEXT_TTL_MS
        });

        return result;
    }

    /**
     * Infer user persona from bio and tweets for CT-relevant personalization
     * @param {string} bio - User's Twitter bio
     * @param {string[]} tweets - Recent tweet texts
     * @returns {string} - Inferred persona type
     */
    inferPersona(bio, tweets) {
        const combined = [bio || '', ...(tweets || [])].join(' ').toLowerCase();

        // Define persona keywords
        const personaPatterns = {
            'degen': ['degen', 'ape', 'wagmi', 'ngmi', 'gm', 'gn', 'fomo', 'moon', 'lambo', '$', '100x', 'bags', 'meme', 'wen', 'ser', 'fren'],
            'builder': ['building', 'shipping', 'dev', 'developer', 'engineer', 'founder', 'ceo', 'cto', 'launched', 'built', 'code', 'product', 'startup'],
            'whale': ['investor', 'vc', 'portfolio', 'thesis', 'fund', 'capital', 'allocating', 'backing', 'seed', 'series'],
            'analyst': ['chart', 'ta', 'analysis', 'thread', 'data', '📊', '📈', 'alpha', 'research', 'macro', 'onchain'],
            'influencer': ['dm for', 'promo', 'collab', 'sponsor', 'shill', 'paid', 'ad', 'influencer']
        };

        // Score each persona
        const scores = {};
        for (const [persona, keywords] of Object.entries(personaPatterns)) {
            scores[persona] = keywords.filter(kw => combined.includes(kw)).length;
        }

        // Get highest scoring persona
        const topPersona = Object.entries(scores)
            .sort((a, b) => b[1] - a[1])
            .find(([_, score]) => score > 0);

        return topPersona ? topPersona[0] : 'observer'; // Default to 'observer' if no match
    }
}

module.exports = new TwitterService();
