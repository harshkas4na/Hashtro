import {
	ApiKey,
	AstroCard,
	Webhook,
	WebhookEvent,
	BirthDetails,
	CardType,
	HistoryResponse,
	HoroscopeResponse,
	HoroscopeStatus,
	TradeTimeData,
	UpdateBirth,
	User,
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
	async getUserProfile(walletAddress: string): Promise<{ user: User } | null> {
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
	 * Register a new user with birth details.
	 * privyUserId and privyWalletId are stored so the backend can sign
	 * transactions server-side via Privy delegated actions.
	 */
	async registerUser(data: BirthDetails & { privyUserId?: string; privyWalletId?: string }): Promise<{ user: User }> {
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
	async getHistory(walletAddress: string, limit = 10): Promise<HistoryResponse> {
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
	async registerX(data: XDetails): Promise<{ user: User }> {
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
		walletAddress: string;
		accessToken: string;
		refreshToken: string;
		expiresAt: string;
	}): Promise<{ message: string }> {
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
	async updateBirthDetails(data: UpdateBirth): Promise<{ user: User }> {
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
	async addTradeTime(data: TradeTimeData): Promise<{ message: string }> {
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

	// ─── Autonomous trading ───────────────────────────────────────────────────────

	/**
	 * Enable or disable autonomous (server-side) trading for a wallet.
	 * Call this after the user approves/revokes Privy's delegateWallet().
	 */
	async setTradingDelegated(
		walletAddress: string,
		delegated: boolean,
	): Promise<{ trading_delegated: boolean; message: string }> {
		const res = await fetch(`${API_BASE}/user/trading-delegated`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ walletAddress, delegated }),
		});
		if (!res.ok) await throwApiError(res, "Failed to update trading delegation");
		return res.json();
	},

	/**
	 * Execute a trade autonomously using the agent's API key.
	 * The backend builds the Flash transaction, signs via Privy, and broadcasts.
	 */
	async executeAgentTrade(
		apiKey: string,
		amount: number,
	): Promise<{
		executed: boolean;
		txSig: string;
		direction: string;
		ticker: string;
		leverage: number;
		collateral_usd: number;
		estimated_price: number;
		explorer_url: string;
	}> {
		const res = await fetch(`${API_BASE}/agent/execute-trade`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
			body: JSON.stringify({ amount }),
		});
		if (!res.ok) await throwApiError(res, "Failed to execute trade");
		return res.json();
	},

	// ─── Agent API Key Management ────────────────────────────────────────────────

	/**
	 * Generate a new agent API key for a wallet.
	 * The raw key is returned ONCE — caller must save it immediately.
	 */
	async generateAgentKey(
		walletAddress: string,
		label: string,
	): Promise<{ key: string; keyPrefix: string; id: string; message: string }> {
		const res = await fetch(`${API_BASE}/agent/keys`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ walletAddress, label }),
		});

		if (!res.ok) {
			await throwApiError(res, "Failed to generate API key");
		}

		return res.json();
	},

	/**
	 * List all agent API keys for a wallet (masked — no raw key returned).
	 */
	async listAgentKeys(walletAddress: string): Promise<{ keys: ApiKey[] }> {
		const res = await fetch(`${API_BASE}/agent/keys/${walletAddress}`);

		if (!res.ok) {
			await throwApiError(res, "Failed to list API keys");
		}

		return res.json();
	},

	/**
	 * Revoke an agent API key by its UUID.
	 */
	async revokeAgentKey(
		keyId: string,
		walletAddress: string,
	): Promise<{ message: string }> {
		const res = await fetch(`${API_BASE}/agent/keys/${keyId}`, {
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ walletAddress }),
		});

		if (!res.ok) {
			await throwApiError(res, "Failed to revoke API key");
		}

		return res.json();
	},

	// ─── Webhook Management ───────────────────────────────────────────────────────

	async listWebhooks(apiKey: string): Promise<{ webhooks: Webhook[] }> {
		const res = await fetch(`${API_BASE}/agent/webhooks`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) await throwApiError(res, "Failed to list webhooks");
		return res.json();
	},

	async registerWebhook(
		apiKey: string,
		url: string,
		events: WebhookEvent[],
	): Promise<{ webhook_id: string; secret: string; message: string }> {
		const res = await fetch(`${API_BASE}/agent/webhook`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
			body: JSON.stringify({ url, events }),
		});
		if (!res.ok) await throwApiError(res, "Failed to register webhook");
		return res.json();
	},

	async deleteWebhook(apiKey: string, webhookId: string): Promise<{ message: string }> {
		const res = await fetch(`${API_BASE}/agent/webhook/${webhookId}`, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) await throwApiError(res, "Failed to delete webhook");
		return res.json();
	},

	async testWebhook(apiKey: string, webhookId: string): Promise<{ delivered: boolean; http_status: number }> {
		const res = await fetch(`${API_BASE}/agent/webhook/${webhookId}/test`, {
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!res.ok) await throwApiError(res, "Test delivery failed");
		return res.json();
	},
};
