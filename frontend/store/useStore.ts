import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { AppState } from "@/types";

export const useStore = create<AppState>()(
  persist(
	(set) => ({
	wallet: null,
	user: null,
	card: null, // New format: single card
	cards: null, // Old format: backwards compatibility
	loading: false,
	showFundWallet: false,
	balance: null,

	setWallet: (wallet) => set({ wallet }),
	setUser: (user) => set({ user }),
	setCard: (card) => set({ card, cards: null }), // Set single card, clear old cards
	setCards: (cards) => set({ cards, card: null }), // Set old cards, clear new card
	setLoading: (loading) => set({ loading }),

	setShowFundWallet: (value) => set({ showFundWallet: value }),

	setBalance: (balance) => set({ balance }),

	refreshBalance: async (wallet: string) => {
		try {
			// NEXT_PUBLIC_SOLANA_RPC_URL should be set to a dedicated paid RPC
			// (Helius, QuickNode, Alchemy) in production. The publicnode fallback
			// is a shared free endpoint with rate limits and no uptime SLA.
			const endpoint =
				process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
				"https://solana-rpc.publicnode.com";
			const connection = new Connection(endpoint, "confirmed");
			const pubKey = new PublicKey(wallet);
			const lamports = await connection.getBalance(pubKey);
			const solBalance = lamports / LAMPORTS_PER_SOL;

			set({ balance: solBalance });
		} catch (error) {
			console.error("Error fetching balance:", error);
		}
	},

	reset: () =>
		set({
			wallet: null,
			user: null,
			card: null,
			cards: null,
			loading: false,
		}),
  }),
  {
    name: "hastrology-session",
    storage: createJSONStorage(() => sessionStorage),
    // Only persist the card, user, and wallet — not loading/balance/UI flags.
    // sessionStorage is cleared on tab close, which is appropriate for
    // wallet-scoped data that shouldn't survive a fresh browser session.
    partialize: (state) => ({
      card: state.card,
      user: state.user,
      wallet: state.wallet,
    }),
  }
));
