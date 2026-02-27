"use client";

import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { useRouter } from "next/navigation";
import {
	type FC,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { WalletBalance } from "@/components/balance";
import { HoroscopeReveal } from "@/components/HoroscopeReveal";
import LoadingSpinner from "@/components/LoadingSpinner";
import { type TradeResult } from "@/components/TradeExecution";
import { TradeResults } from "@/components/TradeResults";
import { UserXDetails } from "@/components/TwitterDetails";
import { TradeModal } from "@/components/trade-modal";
import { WalletDropdown } from "@/components/wallet-dropdown";
import { api } from "@/lib/api";
import { useStore } from "@/store/useStore";
import { usePrivyWallet } from "../hooks/use-privy-wallet";

type Screen =
	| "loading"
	| "reveal"
	| "execute"
	| "results";

const CardsPage: FC = () => {
	const {
		publicKey,
		connected,
		isReady,
	} = usePrivyWallet();
	const { card, setCard, setWallet, setUser, loading, setLoading } = useStore();
	const router = useRouter();

	const [currentScreen, setCurrentScreen] = useState<Screen>("loading");
	const [tradeResult, setTradeResult] = useState<TradeResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [verified, setVerified] = useState(false);
	const [balance, setBalance] = useState<number | null>(null);

	const wasConnected = useRef(false);
	const hasCheckedRef = useRef(false);
	// Track which publicKey we last ran the status check for so we detect
	// wallet switches even when connected remains true.
	const lastCheckedPublicKey = useRef<string | null>(null);

	// Single stable Connection shared by Flash service init and balance poller.
	// Created once per component mount; avoids opening multiple WebSocket
	// connections to the same RPC endpoint.
	const connectionRef = useRef<Connection>(
		new Connection(
			process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://solana-rpc.publicnode.com",
			"confirmed",
		),
	);

	// Redirect if disconnected
	useEffect(() => {
		if (wasConnected.current && !publicKey) {
			router.push("/");
		}
		wasConnected.current = !!publicKey;
	}, [publicKey, router]);

	const generateFreeHoroscope = useCallback(async () => {
		if (!publicKey) return;
		setLoading(true);
		setError(null);
		try {
			const result = await api.confirmHoroscope(publicKey, "FREE_HOROSCOPE");
			setCard(result.card);
			setCurrentScreen("reveal");
		} catch (genErr) {
			console.error("Error generating horoscope:", genErr);
			setError("Failed to generate horoscope. Please try again.");
			// Stay on error screen
		} finally {
			setLoading(false);
		}
	}, [publicKey, setCard, setLoading]);

	// Check user profile and horoscope status
	useEffect(() => {
		const checkStatus = async () => {
			if (!connected || !publicKey || !isReady) {
				hasCheckedRef.current = false;
				return;
			}

			// Reset if the user switched to a different wallet while staying
			// connected (Privy can change publicKey without toggling connected).
			if (publicKey !== lastCheckedPublicKey.current) {
				hasCheckedRef.current = false;
			}

			if (hasCheckedRef.current) return;
			hasCheckedRef.current = true;
			lastCheckedPublicKey.current = publicKey;

			setWallet(publicKey);

			try {
				// Check user profile
				const profileResponse = await api.getUserProfile(publicKey); // Use publicKey directly

				if (!profileResponse?.user) {
					console.warn("User profile not found. Redirecting to home.");
					router.push("/");
					return;
				}

				setUser(profileResponse.user);

				// Check horoscope status
				const status = await api.getStatus(publicKey);

				if (status.status === "exists" && status.card) {
					setCard(status.card);
					if (status.verified) setVerified(true);
					setCurrentScreen("reveal");
				} else {
					// FREE HOROSCOPE: Auto-generate without payment
					await generateFreeHoroscope();
				}
			} catch (err) {
				console.error("Error checking status:", err);
				setError("Failed to load your cosmic status.");
			}
		};

		checkStatus();
	}, [
		connected,
		publicKey,
		isReady,
		setCard,
		setUser,
		setWallet,
		generateFreeHoroscope,
		router,
	]);

	// Fetch balance
	useEffect(() => {
		const fetchBalance = async () => {
			if (!publicKey) {
				setBalance(null);
				return;
			}

			try {
				const pubKey = new PublicKey(publicKey);
				const lamports = await connectionRef.current.getBalance(pubKey);
				setBalance(lamports / LAMPORTS_PER_SOL);
			} catch (err) {
				console.error("Error fetching balance:", err);
			}
		};

		fetchBalance();
		const interval = setInterval(fetchBalance, 30000);
		return () => clearInterval(interval);
	}, [publicKey]);

	// Handle verify trade click
	const handleVerifyTrade = () => {
		setCurrentScreen("execute");
	};



	// Handle trade completion
	const handleTradeComplete = (result: TradeResult) => {
		setTradeResult(result);
		setCurrentScreen("results");

		// Persist verification for profitable trades (fire-and-forget)
		if (result.pnlPercent >= 0 && publicKey && result.txSig) {
			setVerified(true);
			api.verifyHoroscope(publicKey, result.txSig, result.pnlPercent).catch((err) => {
				console.error("Failed to persist verification:", err);
			});
		}
	};

	// Handle return to home
	const handleReturnHome = () => {
		router.push("/");
	};

	const handleTryAgain = () => {
		setCurrentScreen("reveal");
	};

	// Loading screen
	if (!isReady || currentScreen === "loading") {
		return <LoadingSpinner fullScreen />;
	}

	// Not connected
	if (!publicKey) {
		return (
			<section className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a0f] text-white">
				<div className="text-center">
					<h2 className="text-3xl font-bold mb-4">Wallet Not Connected</h2>
					<p className="text-white/50 mb-8">
						Please connect your wallet to access your cosmic reading
					</p>
					<button
						onClick={() => router.push("/")}
						className="btn-primary"
						type="button"
					>
						Go to Home
					</button>
				</div>
			</section>
		);
	}

	// Error / Retry Screen (Replaces Payment)
	if (error) {
		return (
			<section className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a0f] text-white px-4">
				<div className="card-glass text-center max-w-md">
					<h2 className="font-display text-2xl font-semibold mb-4 text-red-400">
						Cosmic Interruption
					</h2>
					<p className="text-white/50 mb-6">{error}</p>

					<button
						onClick={generateFreeHoroscope}
						disabled={loading}
						className="btn-primary w-full"
						type="button"
					>
						{loading ? "Aligning Stars..." : "Try Again"}
					</button>
				</div>
			</section>
		);
	}

	// Screen 3: Horoscope Reveal
	if (currentScreen === "reveal" && card) {
		return (
			<>
				<UserXDetails />
				<WalletBalance />
				<div className="absolute top-0 md:top-6 right-5 md:right-6 z-50">
					<WalletDropdown variant="desktop" />
				</div>
				<HoroscopeReveal card={card} verified={verified} onVerifyTrade={handleVerifyTrade} />
			</>
		);
	}

	// Screen 4: Trade Execution
	if (currentScreen === "execute" && card) {
		return (
			<>
				<UserXDetails />
				<WalletBalance />
				<div className="absolute top-0 md:top-6 right-5 md:right-6 z-50">
					<WalletDropdown variant="desktop" />
				</div>
				<TradeModal
					card={card}
					onClose={() => {
						setCurrentScreen("reveal");
					}}
					direction={card.front.luck_score > 50 ? "LONG" : "SHORT"}
					onComplete={handleTradeComplete}
					balance={balance}
				/>
			</>
		);
	}

	// Screen 5: Trade Results
	if (currentScreen === "results" && card && tradeResult) {
		return (
			<>
				<UserXDetails />
				<WalletBalance />
				<div className="absolute top-0 md:top-6 right-5 md:right-6 z-50">
					<WalletDropdown variant="desktop" />
				</div>
				<TradeResults
					card={card}
					result={tradeResult}
					onReturnHome={handleReturnHome}
					handleTryAgain={handleTryAgain}
				/>
			</>
		);
	}

	// Fallback
	return (
		<section className="min-h-screen flex flex-col items-center justify-center bg-[#0a0a0f] text-white">
			<p className="text-white/50">Loading...</p>
		</section>
	);
};

export default CardsPage;
