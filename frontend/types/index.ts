export interface BirthDetails {
	walletAddress: string;
	username: string;
	dob?: string;
	birthTime?: string;
	birthPlace?: string;
	latitude?: number;
	longitude?: number;
	timezoneOffset?: number;
	twitterId?: string;
	twitterUsername?: string;
	twitterProfileUrl?: string;
}

export interface UpdateBirth {
	walletAddress: string;
	dob: string;
	birthTime?: string | null;
	birthPlace?: string | null;
	latitude?: number | null;
	longitude?: number | null;
	timezoneOffset?: number | null;
}

// Card type identifiers
export type CardType =
	| "overall_vibe"
	| "shine"
	| "health"
	| "wealth"
	| "career"
	| "love"
	| "social"
	| "growth"
	| "luck"
	| "wild_card";

// Individual astro card structure
// Breakdown of the new card structure
export interface LuckyAssets {
	number: string;
	color: string;
	power_hour: string;
	ticker?: string;
	name?: string;
	max_leverage?: number;
	emoji?: string;
	category?: string;
}

export interface TelescopeCardFront {
	tagline: string;
	hook_1: string;
	hook_2: string;
	luck_score: number;
	vibe_status: string;
	energy_emoji: string;
	zodiac_sign: string;
}

export interface TelescopeCardBack {
	detailed_reading: string;
	hustle_alpha: string;
	shadow_warning: string;
	lucky_assets: LuckyAssets;
}

// Complete astro card structure
export interface AstroCard {
	front: TelescopeCardFront;
	back: TelescopeCardBack;
	ruling_planet_theme: string;
}

// Single card response from API
export interface AstroCardResponse {
	card: AstroCard;
	date?: string;
	cached?: boolean;
}

// Legacy cards data from API (for backwards compatibility)
export interface AstroCardsData {
	cards: Record<CardType, AstroCard>;
	cached?: boolean;
}

// Card with type and color info for frontend rendering
export interface AstroCardWithMeta extends AstroCard {
	type: CardType;
	color: string;
	gradient: string;
}

// Color mapping for each card type - Spotify Wrapped inspired
export const CARD_COLORS: Record<
	CardType,
	{ color: string; gradient: string }
> = {
	overall_vibe: {
		color: "#9333EA",
		gradient: "linear-gradient(135deg, #9333EA 0%, #7C3AED 100%)",
	},
	shine: {
		color: "#F59E0B",
		gradient: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)",
	},
	health: {
		color: "#EAB308",
		gradient: "linear-gradient(135deg, #EAB308 0%, #CA8A04 100%)",
	},
	wealth: {
		color: "#7C3AED",
		gradient: "linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)",
	},
	career: {
		color: "#3B82F6",
		gradient: "linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)",
	},
	love: {
		color: "#EF4444",
		gradient: "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)",
	},
	social: {
		color: "#06B6D4",
		gradient: "linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)",
	},
	growth: {
		color: "#22C55E",
		gradient: "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)",
	},
	luck: {
		color: "#EC4899",
		gradient: "linear-gradient(135deg, #EC4899 0%, #DB2777 100%)",
	},
	wild_card: {
		color: "#F97316",
		gradient: "linear-gradient(135deg, #F97316 0%, #EA580C 100%)",
	},
};

// Order of cards to display
export const CARD_ORDER: CardType[] = [
	"overall_vibe",
	"shine",
	"health",
	"wealth",
	"career",
	"love",
	"social",
	"growth",
	"luck",
	"wild_card",
];

export interface HoroscopeStatus {
	status: "new_user" | "clear_to_pay" | "paid" | "exists";
	horoscope?: string;
	card?: AstroCard; // New format: single card
	cards?: Record<CardType, AstroCard>; // Old format: backwards compatibility
	verified?: boolean;
	date?: string;
}

export interface HoroscopeResponse {
	card: AstroCard; // New format: single card
	verified?: boolean;
	date?: string;
}

export interface User {
	id: string;
	walletAddress: string;
	dob: string;
	birthTime: string;
	birthPlace: string;
	createdAt: string;
	username?: string;
	zodiacSign?: string;
	twitterId?: string;
	twitterProfileUrl?: string;
	twitterUsername?: string;
	twitterAccessToken?: string;
	twitterRefreshToken?: string;
	twitterTokenExpiresAt?: string;
	tradeMadeAt?: string;
}

export interface HistoryEntry {
	date: string;
	horoscopeText: string;
	verified: boolean;
	createdAt: string;
}

export interface HistoryResponse {
	count: number;
	next_cursor: string | null;
	horoscopes: HistoryEntry[];
}

export interface AppState {
	wallet: string | null;
	user: User | null;
	card: AstroCard | null; // New format: single card
	cards: Record<CardType, AstroCard> | null; // Old format: backwards compatibility
	loading: boolean;
	showFundWallet: boolean;
	setWallet: (wallet: string | null) => void;
	setUser: (user: User | null) => void;
	setCard: (card: AstroCard | null) => void; // New setter for single card
	setCards: (cards: Record<CardType, AstroCard> | null) => void; // Old setter: backwards compatibility
	setLoading: (loading: boolean) => void;
	setShowFundWallet: (value: boolean) => void;
	reset: () => void;
	balance: number | null;
	setBalance: (balance: number | null) => void;
	refreshBalance: (wallet: string) => Promise<void>;
}

export interface XDetails {
	id: string;
	twitterId: string;
	username: string;
	twitterUsername: string;
	twitterProfileUrl: string;
	twitterAccessToken: string;
	twitterRefreshToken: string;
	twitterTokenExpiresAt: string;
}

export interface TwitterUserData {
	data: {
		id: string;
		name: string;
		username: string;
		profile_image_url: string;
	};
}

export interface fetchUserInput {
	code: string;
	url: URL;
	path: string;
}

export interface FetchUserResult {
	userData: TwitterUserData;
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
}

export interface TradeTimeData {
	walletAddress: string;
	tradeMadeAt: string;
}

export interface ApiKey {
	id: string;
	key_prefix: string;
	label: string;
	created_at: string;
	last_used_at: string | null;
	revoked: boolean;
}

export type WebhookEvent = 'horoscope_ready' | 'trade_verified';

export interface Webhook {
	id: string;
	url: string;
	events: WebhookEvent[];
	active: boolean;
	created_at: string;
}
