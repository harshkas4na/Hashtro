import {
	AstroCard,
	BirthDetails,
	CardType,
	HoroscopeResponse,
	HoroscopeStatus,
	TradeTimeData,
	UpdateBirth,
	XDetails,
} from "@/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

/** Error thrown by api.* methods; carries the HTTP status so callers can
 *  distinguish 404 Not Found from 429 Rate Limit from 500 Server Error. */
export class ApiError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.name = "ApiError";
		this.status = status;
	}
}

/** Parse an error response body and throw an ApiError with the status code. */
async function throwApiError(res: Response, fallback: string): Promise<never> {
	let message = fallback;
	try {
		const body = await res.json();
		if (body?.message) message = body.message;
	} catch {
		// body isn't JSON — use fallback
	}
	throw new ApiError(message, res.status);
}

export const api = {
	/**
	 * Get user profile by wallet address
	 */
	async getUserProfile(walletAddress: string) {
		const res = await fetch(`${API_BASE}/user/profile/${walletAddress}`);

		if (!res.ok) {
			if (res.status === 404) {
				return null; // User not found
			}
			await throwApiError(res, "Failed to get user profile");
		}

		return res.json();
	},

	/**
	 * Register a new user with birth details
	 */
	async registerUser(data: BirthDetails) {
		const res = await fetch(`${API_BASE}/user/register`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});

		if (!res.ok) {
			await throwApiError(res, "Failed to register user");
		}

		return res.json();
	},

	/**
	 * Check horoscope status for a wallet
	 */
	async getStatus(walletAddress: string): Promise<HoroscopeStatus> {
		const res = await fetch(
			`${API_BASE}/horoscope/status?walletAddress=${walletAddress}`,
		);

		if (!res.ok) {
			await throwApiError(res, "Failed to get horoscope status");
		}

		return res.json();
	},

	/**
	 * Confirm payment and generate horoscope cards
	 */
	async confirmHoroscope(
		walletAddress: string,
		signature: string,
	): Promise<HoroscopeResponse> {
		const res = await fetch(`${API_BASE}/horoscope/confirm`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ walletAddress, signature }),
		});

		if (!res.ok) {
			await throwApiError(res, "Failed to generate horoscope");
		}

		return res.json();
	},

	/**
	 * Get horoscope history
	 */
	async getHistory(walletAddress: string, limit = 10) {
		const res = await fetch(
			`${API_BASE}/horoscope/history/${walletAddress}?limit=${limit}`,
		);

		if (!res.ok) {
			await throwApiError(res, "Failed to get horoscope history");
		}

		return res.json();
	},

	/**
	 * Verify horoscope via a profitable trade
	 */
	async verifyHoroscope(
		walletAddress: string,
		txSig: string,
		pnlPercent: number,
	): Promise<{ verified: boolean }> {
		const res = await fetch(`${API_BASE}/horoscope/verify`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ walletAddress, txSig, pnlPercent }),
		});

		if (!res.ok) {
			await throwApiError(res, "Failed to verify horoscope");
		}

		return res.json();
	},

	/**
	 * Add twitter details to an existing user
	 */
	async registerX(data: XDetails) {
		const res = await fetch(`${API_BASE}/user/x-account`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});

		if (!res.ok) {
			await throwApiError(res, "Failed to register user X account");
		}

		return res.json();
	},

	/**
	 * Update Twitter OAuth tokens for a user
	 */
	async updateTwitterTokens(data: {
		walletAddress: string; // Changed from userId
		accessToken: string;
		refreshToken: string;
		expiresAt: string;
	}) {
		const res = await fetch(`${API_BASE}/user/twitter-tokens`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});

		if (!res.ok) {
			await throwApiError(res, "Failed to update Twitter tokens");
		}

		return res.json();
	},

	/**
	 * Update birth details for a user
	 */
	async updateBirthDetails(data: UpdateBirth) {
		const res = await fetch(`${API_BASE}/user/birth-details`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});

		if (!res.ok) {
			await throwApiError(res, "Failed to update Birth details");
		}

		return res.json();
	},

	/**
	 * Add or update trade timestamp for a user
	 */
	async addTradeTime(data: TradeTimeData) {
		const res = await fetch(`${API_BASE}/user/trade-time`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(data),
		});

		if (!res.ok) {
			await throwApiError(res, "Failed to update trade time");
		}

		return res.json();
	},
};
