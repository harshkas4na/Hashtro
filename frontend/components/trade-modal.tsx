"use client";

import { Connection } from "@solana/web3.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { usePrivyWallet } from "@/app/hooks/use-privy-wallet";
import { api } from "@/lib/api";
import { FlashPrivyService } from "@/lib/flash-trade";
import type { AstroCard } from "@/types";
import { getCoinFromLuckScore } from "./HoroscopeReveal";
import { StarBackground } from "./StarBackground";
import { TradeResult } from "./TradeExecution";

interface TradeModalProps {
	card: AstroCard;
	onClose: () => void;
	onComplete: (result: TradeResult) => void;
	direction: "LONG" | "SHORT";
	balance: number | null;
}

type SuccessState = {
	type: "close" | "open";
	txSig: string;
	direction: "LONG" | "SHORT";
	leverage: number;
	pnl?: number;
	size?: number;
	entryPrice?: number;
	exitPrice?: number;
	message: string;
	closeAtTimestamp?: number;
	closeTxSig?: string;
};

const TRADE_DURATION = 30; // seconds
const MIN_TRADE_AMOUNT_SOL = 0.04;
const GAS_BUFFER_SOL = 0.015; // covers open + close tx fees + priority fees

const QUICK_AMOUNTS = [0.1, 0.25, 0.5, 1];

export const TradeModal: React.FC<TradeModalProps> = ({
	card,
	onClose,
	direction,
	onComplete,
	balance,
}) => {
	const [isTrading, setIsTrading] = useState(false);
	const [isFetchingPrice, setIsFetchingPrice] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<SuccessState | null>(null);
	const [amount, setTradeAmount] = useState(0.04);
	const [pnl, setPnl] = useState(0);
	const [pnlPercent, setPnlPercent] = useState(0);
	const [currentPrice, setCurrentPrice] = useState(0);
	const [entryPrice, setEntryPrice] = useState(0);
	// Use the asset-specific max_leverage cap from the card rather than the
	// lucky number (a numerology value unrelated to trading leverage limits).
	const leverage = Math.min(Number(card.back.lucky_assets.max_leverage ?? 2), 50);
	const [statusMessage, setStatusMessage] = useState("Opening position...");
	const [showEducation, setShowEducation] = useState(false);
	const [tradeDetails, setTradeDetails] = useState<{
		direction: "LONG" | "SHORT";
		size: number;
		estimatedPrice: number;
		collateral: string;
		outputToken: string;
		totalValue: string;
	} | null>(null);
	const flashServiceRef = useRef<FlashPrivyService | null>(null);
	const [flashReady, setFlashReady] = useState(false);
	type UserPosition = Awaited<
		ReturnType<FlashPrivyService["getUserPositions"]>
	>[number];

	const [latestPosition, setLatestPosition] = useState<UserPosition | null>(
		null,
	);
	const [isFetchingPosition, setIsFetchingPosition] = useState(false);
	const [countdown, setCountdown] = useState<number | null>(null);
	const autoCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
	const [phase, setPhase] = useState<"opening" | "active" | "closing" | "done">(
		"opening",
	);
	const [timeLeft, setTimeLeft] = useState(TRADE_DURATION);
	type PricePoint = { t: number; price: number };
	const [series, setSeries] = useState<PricePoint[]>([]);
	const chartIntervalRef = useRef<NodeJS.Timeout | null>(null);

	const wallet = usePrivyWallet(false);

	const loadLatestPosition = useCallback(async () => {
		if (!flashServiceRef.current) return;

		try {
			setIsFetchingPosition(true);

			const positions = await flashServiceRef.current.getUserPositions();

			if (positions.length > 0) {
				setEntryPrice(positions[0].entryPrice);
				setPnl(positions[0].unrealizedPnl);
				setPnlPercent(positions[0].pnlPercent);
				setCurrentPrice(positions[0].currentPrice);
				setLatestPosition(positions[0]);
			} else {
				setLatestPosition(null);
			}
		} catch (err) {
			console.error("Failed to load positions", err);
		} finally {
			setIsFetchingPosition(false);
		}
	}, []);

	useEffect(() => {
		if (!wallet.publicKey || flashServiceRef.current) return;

		const init = async () => {
			const endpoint =
				process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
				"https://solana-rpc.publicnode.com";

			const connection = new Connection(endpoint, "confirmed");

			const service = new FlashPrivyService({
				connection,
				wallet: {
					publicKey: wallet.publicKey as string,
					signTransaction: wallet.signTransaction,
					signAllTransactions: wallet.signAllTransactions,
					sendTransaction: wallet.sendTransaction,
				},
				env: "mainnet-beta",
			});

			await service.initialize();

			flashServiceRef.current = service;
			setFlashReady(true);

			await loadLatestPosition();
		};

		init().catch((err) => {
			console.error("Flash service init failed:", err);
			setError(
				"Failed to initialize trading service. Please refresh and try again.",
			);
		});
	}, [
		wallet.publicKey,
		wallet.signTransaction,
		wallet.signAllTransactions,
		wallet.sendTransaction,
		loadLatestPosition,
	]);

	const fetchSolPriceAndCalculateDetails = useCallback(async () => {
		try {
			setIsFetchingPrice(true);
			setError(null);

			let solPrice = 100;

			if (flashServiceRef.current) {
				solPrice = await flashServiceRef.current.getSolPrice();
			}

			const direction: "LONG" | "SHORT" =
				card.front.luck_score > 50 ? "LONG" : "SHORT";

			const luckDeviation = Math.abs(card.front.luck_score - 50);
			const size = (luckDeviation / 5).toFixed(2);

			setTradeDetails({
				direction,
				size: parseFloat(size),
				estimatedPrice: solPrice,
				collateral: "USDC",
				outputToken: "SOL-USDC",
				totalValue: (parseFloat(size) * solPrice).toFixed(2),
			});
		} catch (err) {
			console.error(err);
			setError("Failed to fetch market data.");
		} finally {
			setIsFetchingPrice(false);
		}
	}, [card.front.luck_score]);

	useEffect(() => {
		if (!wallet.publicKey || !flashReady) return;

		fetchSolPriceAndCalculateDetails();

		const interval = setInterval(fetchSolPriceAndCalculateDetails, 20000);
		return () => clearInterval(interval);
	}, [wallet.publicKey, flashReady, fetchSolPriceAndCalculateDetails]);

	const requiredBalance = amount + GAS_BUFFER_SOL;
	const insufficientBalance = balance !== null && balance < requiredBalance;

	const executeTrade = async () => {
		if (!wallet.connected || !flashServiceRef.current || !wallet.publicKey) {
			setError("Please connect your wallet first");
			return;
		}

		if (insufficientBalance) {
			setError(
				`Insufficient balance. You need at least ${requiredBalance.toFixed(4)} SOL.`,
			);
			return;
		}

		try {
			setIsTrading(true);
			setError(null);

			const result = await flashServiceRef.current.executeTradeWithAutoClose(
				{
					card,
					side: direction === "LONG" ? "long" : "short",
					inputAmount: amount,
					leverage,
					symbol: getCoinFromLuckScore(card.front.luck_score).symbol,
				},
				30,
			);

			setPhase("active");
			setSeries([{ t: Date.now(), price: result.estimatedPrice }]);

			chartIntervalRef.current = setInterval(async () => {
				try {
					const price = await flashServiceRef.current!.getSolPrice();

					setSeries((prev) => {
						const now = Date.now();
						const next = [...prev, { t: now, price }];

						return next.filter((p) => now - p.t <= 30_000);
					});
				} catch (priceErr) {
					console.warn("Price update failed:", priceErr);
				}
			}, 1000);
			setStatusMessage("Trade is live...");
			setTimeLeft(TRADE_DURATION);

			const initialCountdown = Math.ceil(
				(result.closeAtTimestamp - Date.now()) / 1000,
			);
			setCountdown(initialCountdown);

			setSuccess({
				type: "open",
				txSig: result.openTxSig,
				direction: result.direction,
				leverage,
				size: result.size,
				entryPrice: result.estimatedPrice,
				message: "Position opened! Auto-closing in 30s",
				closeAtTimestamp: result.closeAtTimestamp,
			});

			setTimeout(async () => {
				await loadLatestPosition();
			}, 3000);

			countdownIntervalRef.current = setInterval(() => {
				const remaining = Math.max(
					0,
					Math.ceil((result.closeAtTimestamp - Date.now()) / 1000),
				);

				setCountdown(remaining);
				setTimeLeft(remaining);

				if (remaining === 0 && countdownIntervalRef.current) {
					clearInterval(countdownIntervalRef.current);
				}
			}, 100);

			// Schedule auto-close with fallback
			const delay = result.closeAtTimestamp - Date.now();

			autoCloseTimeoutRef.current = setTimeout(async () => {
				let closeTxSig: string | null = null;
				let closeMethod: "pre-signed" | "manual" = "pre-signed";

				try {
					setPhase("closing");
					setStatusMessage("Closing position...");

					// Debug: set window.__FORCE_MANUAL_CLOSE = true in console to test fallback
					if (
						typeof window !== "undefined" &&
						(window as any).__FORCE_MANUAL_CLOSE
					) {
						console.log("🧪 DEBUG: Forcing manual close fallback");
						throw new Error(
							"[DEBUG] Forced pre-signed close failure to test fallback",
						);
					}

					// Try pre-signed transaction first
					closeTxSig =
						await flashServiceRef.current!.sendPreSignedCloseTransaction(
							result.signedCloseTransaction,
							result.blockhash,
							result.lastValidBlockHeight,
						);

					console.log("✅ Position closed via pre-signed transaction");
				} catch (preSignedError: any) {
					console.error("❌ Pre-signed close failed:", preSignedError);

					// Fallback: Try manual close after 4 second delay
					console.log("⏳ Attempting fallback manual close...");
					setStatusMessage("Retrying close position...");

					try {
						await new Promise((resolve) => setTimeout(resolve, 4000)); // 4 second delay

						const manualCloseResult = await flashServiceRef.current!.closeTrade(
							0,
							"SOL",
							{
								signDescription:
									"Your position needs to close. The auto-close expired — please approve a new close transaction.",
								sendDescription: "Sending close position transaction",
							},
						);
						closeTxSig = manualCloseResult.txSig;
						closeMethod = "manual";

						console.log("✅ Position closed via manual fallback");
					} catch (manualError: any) {
						console.error("❌ Manual close also failed:", manualError);
						throw new Error(
							`Both auto-close methods failed. Pre-signed: ${preSignedError.message}. Manual: ${manualError.message}`,
						);
					}
				}

				// If we got here, one of the close methods succeeded

				if (chartIntervalRef.current) {
					clearInterval(chartIntervalRef.current);
					chartIntervalRef.current = null;
				}
				if (countdownIntervalRef.current) {
					clearInterval(countdownIntervalRef.current);
					countdownIntervalRef.current = null;
				}

				// Get final price for PnL calculation
				const exitPrice = await flashServiceRef.current!.getCoinPrice(
					result.targetCoin,
				);

				// Calculate final PnL

				// Calculate final PnL
				const finalPriceDiff =
					direction === "LONG"
						? exitPrice - result.estimatedPrice
						: result.estimatedPrice - exitPrice;
				const finalPnl = finalPriceDiff * result.size;

				const positionValue = result.size * result.estimatedPrice;
				const finalPercent =
					positionValue > 0 ? (finalPnl / positionValue) * 100 : 0;
				if (finalPercent > 0) {
					try {
						await api.addTradeTime({
							walletAddress: wallet.publicKey ?? "",
							tradeMadeAt: new Date().toISOString(),
						});
					} catch (apiError) {
						console.error("Failed to record trade time:", apiError);
					}
				}

				setStatusMessage(`✨ Trade complete! (closed via ${closeMethod})`);

				// Complete with results

				onComplete({
					success: finalPercent > 0,
					pnl: finalPnl,
					pnlPercent: finalPercent,
					entryPrice: result.estimatedPrice,
					exitPrice: exitPrice,
					direction,
					leverage,
					txSig: closeTxSig!,
				});

				// Update success state with close info
				setSuccess((prev) => {
					if (!prev) return null;

					// Calculate PnL
					const priceDiff =
						prev.direction === "LONG"
							? exitPrice - (prev.entryPrice || 0)
							: (prev.entryPrice || 0) - exitPrice;
					const pnl = (prev.size || 0) * priceDiff;

					return {
						...prev,
						type: "close",
						closeTxSig,
						exitPrice,
						pnl,
						message: `Position closed! (${closeMethod})`,
					};
				});

				// Stop countdown
				setCountdown(null);
				if (countdownIntervalRef.current) {
					clearInterval(countdownIntervalRef.current);
				}

				// Reload positions to confirm closure
				await loadLatestPosition();
			}, delay);

			// Add an additional safety timeout for total failure
			// Debug: set window.__FORCE_EMERGENCY_CLOSE = true to trigger this after only 5s
			const safetyDelay =
				typeof window !== "undefined" && (window as any).__FORCE_EMERGENCY_CLOSE
					? delay + 5000
					: delay + 35000;
			const safetyTimeoutRef = setTimeout(async () => {
				// Check if position is still open
				const positions = await flashServiceRef.current!.getUserPositions();

				if (positions.length > 0) {
					console.log(
						"⚠️ Safety timeout triggered - position still open after 35s",
					);
					setStatusMessage("Final attempt to close position...");

					try {
						const emergencyClose = await flashServiceRef.current!.closeTrade(
							0,
							"SOL",
							{
								signDescription:
									"Emergency close: Your position is still open. Please approve to close it now.",
								sendDescription: "Sending emergency close transaction",
							},
						);
						console.log("✅ Emergency close successful:", emergencyClose.txSig);

						setError(null);
						setStatusMessage("✨ Position closed (emergency fallback)");

						// Clean up intervals
						if (chartIntervalRef.current) {
							clearInterval(chartIntervalRef.current);
							chartIntervalRef.current = null;
						}
						if (countdownIntervalRef.current) {
							clearInterval(countdownIntervalRef.current);
							countdownIntervalRef.current = null;
						}

						// Calculate final PnL and complete
						const exitPrice = await flashServiceRef.current!.getCoinPrice(
							result.targetCoin,
						);

						// Calculate final PnL

						// Calculate final PnL
						const finalPriceDiff =
							direction === "LONG"
								? exitPrice - result.estimatedPrice
								: result.estimatedPrice - exitPrice;
						const finalPnl = finalPriceDiff * result.size;

						const positionValue = result.size * result.estimatedPrice;
						const finalPercent =
							positionValue > 0 ? (finalPnl / positionValue) * 100 : 0;
						if (finalPercent > 0) {
							try {
								await api.addTradeTime({
									walletAddress: wallet.publicKey ?? "",
									tradeMadeAt: new Date().toISOString(),
								});
							} catch (apiError) {
								console.error("Failed to record trade time:", apiError);
							}
						}

						onComplete({
							success: finalPercent > 0,
							pnl: finalPnl,
							pnlPercent: finalPercent,
							entryPrice: result.estimatedPrice,
							exitPrice,
							direction,
							leverage,
							txSig: emergencyClose.txSig,
						});
					} catch (emergencyError: any) {
						console.error("❌ Emergency close failed:", emergencyError);
						setError(
							"Position may still be open. Please check your positions and close manually if needed.",
						);
					}
				}
			}, safetyDelay);

			// Clean up safety timeout when component unmounts
			return () => {
				if (safetyTimeoutRef) clearTimeout(safetyTimeoutRef);
			};
		} catch (err: any) {
			console.error("❌ Trade execution failed:", err);
			setError(err.message ?? "Trade failed");
		} finally {
			setIsTrading(false);
		}
	};

	const closePosition = async () => {
		if (!wallet.connected || !flashServiceRef.current || !latestPosition) {
			setError("Please connect your wallet first");
			return;
		}

		try {
			setIsTrading(true);
			setError(null);

			const result = await flashServiceRef.current.closeTrade(0, "USDC", {
				signDescription: "Close your open SOL position and receive proceeds",
				sendDescription: "Sending close position transaction",
			});

			const solPrice = await flashServiceRef.current.getSolPrice();

			// Create success state
			setSuccess({
				type: "close",
				txSig: result.txSig,
				direction: latestPosition.direction,
				leverage: Math.min(Number(card.back.lucky_assets.max_leverage ?? 2), 50),
				pnl: latestPosition.pnl,
				size: latestPosition.size,
				entryPrice: latestPosition.entryPrice,
				exitPrice: solPrice,
				message: "Position closed successfully!",
			});

			setLatestPosition(null);
		} catch (err: any) {
			console.error(err);
			setError(err.message ?? "Failed to close position");
		} finally {
			setIsTrading(false);
		}
	};

	const handleAction = () => {
		if (latestPosition) {
			closePosition();
		} else {
			executeTrade();
		}
	};

	const progress = ((TRADE_DURATION - timeLeft) / TRADE_DURATION) * 100;

	const timerClass =
		timeLeft <= 5 ? "critical" : timeLeft <= 10 ? "warning" : "";

	return (
		<>
			{(phase === "active" || phase === "closing") && (
				<section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-4 py-6 sm:py-10">
					<StarBackground />

					<div className="relative z-10 w-full max-w-[560px] screen-fade-in">
						<div className="flex justify-center mb-6">
							<div className="badge-live">
								<span className="live-dot" />
								<span className="live-text">
									{phase === "closing" ? "Closing" : "Trade Active"}
								</span>
							</div>
						</div>

						{/* Timer */}
						<div className="text-center mb-8">
							<p className="text-sm text-white/50 mb-2">Time Remaining</p>
							<div className={`timer-display ${timerClass}`}>{timeLeft}</div>
						</div>

						{/* Card */}
						<div className="card-glass w-full" style={{ maxWidth: "560px" }}>
							{/* Trade Header */}
							<div className="flex justify-between items-center pb-5 mb-5 border-b border-white/[0.08]">
								<div className="flex items-center gap-3">
									<span className="font-display text-2xl font-bold">
										{getCoinFromLuckScore(card.front.luck_score).symbol}
									</span>
									<div>
										<span
											className={`text-xs font-semibold ${direction === "LONG"
												? "text-[#22c55e]"
												: "text-[#ef4444]"
												}`}
										>
											{direction === "LONG" ? "↑" : "↓"} {direction}
										</span>
										<p className="text-[11px] text-white/50">
											{leverage}x Leverage
										</p>
									</div>
								</div>
								<div className="text-right">
									<p className="text-[10px] text-white/40 uppercase">
										Position
									</p>
									<p className="font-display text-lg font-semibold">
										${amount.toFixed(2)}
									</p>
								</div>
							</div>

							{/* Chart placeholder */}
							<div className="h-[180px] bg-white/[0.02] rounded-2xl p-3 mb-6">
								<SolPriceChart data={series} />
							</div>

							{/* PnL Section */}
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-6">
								<div className="pnl-card">
									<p className="pnl-label">Unrealized P&L</p>
									<p
										className={`pnl-value ${pnl >= 0 ? "positive" : "negative"}`}
									>
										{pnl >= 0 ? "+" : ""}${pnl.toFixed(5)}
									</p>
									<p
										className={`pnl-percent ${pnl >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
											}`}
									>
										{pnl >= 0 ? "+" : ""}
										({pnlPercent.toFixed(4)}%)
									</p>
								</div>
								<div className="pnl-card">
									<p className="pnl-label">Current Price</p>
									<p className="pnl-value" style={{ color: "#fff" }}>
										${currentPrice.toFixed(2)}
									</p>
									<p className="pnl-percent text-white/50">
										Entry: ${entryPrice.toFixed(2)}
									</p>
								</div>
							</div>

							{/* Progress bar */}
							<div className="mb-5">
								<div className="progress-bar-bg">
									<div
										className="progress-bar-fill"
										style={{ width: `${progress}%` }}
									/>
								</div>
								<div className="flex justify-between text-xs text-white/40 mt-2">
									<span>Started</span>
									<span>{timeLeft}s remaining</span>
								</div>
							</div>

							{/* Status message */}
							<div
								className={`text-center p-4 rounded-xl ${error
									? "bg-red-500/10 border border-red-500/20"
									: "bg-[#d4a017]/10 border border-[#d4a017]/20"
									}`}
							>
								<p className="text-sm text-white/70">{statusMessage}</p>
								{error && <p className="text-xs text-red-300 mt-2">{error}</p>}
							</div>
						</div>
					</div>
				</section>
			)}

			{phase === "opening" && (
				<section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-4 py-6 sm:py-10">
					<StarBackground />

					{/* Back button */}
					<button
						onClick={onClose}
						className="absolute top-4 left-33 sm:top-20 sm:left-12 flex items-center gap-2 text-white/60 text-xs sm:text-sm hover:text-white transition-colors z-20"
						type="button"
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							className="w-5 h-5"
						>
							<title>svg</title>
							<path d="M19 12H5M12 19l-7-7 7-7" />
						</svg>
						Back to Horoscope
					</button>

					<div className="relative z-10 w-full max-w-[520px] screen-fade-in">
						{/* Header */}
						<div className="text-center mb-6 sm:mb-8">
							<h1 className="font-display text-2xl sm:text-3xl font-semibold mb-3 bg-gradient-to-r from-white to-[#d4a017] bg-clip-text text-transparent">
								Confirm Your Trade
							</h1>
							<p className="text-xs sm:text-sm text-white/50">
								Review the details before verifying your horoscope
							</p>
						</div>

						{/* Card */}
						<div className="card-glass">
							{/* Trade Summary */}
							<div className="text-center pb-7 mb-7 border-b border-white/[0.08]">
								{/* Direction badge */}
								<div
									className={`inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold uppercase tracking-wider mb-4 ${direction === "LONG"
										? "bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/30"
										: "bg-[#ef4444]/15 text-[#ef4444] border border-[#ef4444]/30"
										}`}
								>
									<svg
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										className="w-4 h-4"
									>
										<title>svg</title>
										<path
											d={
												direction === "LONG"
													? "M12 19V5M5 12l7-7 7 7"
													: "M12 5v14M5 12l7 7 7-7"
											}
										/>
									</svg>
									{direction}
								</div>

								{/* Ticker */}
								<div className="font-display text-4xl sm:text-5xl font-bold mb-2">
									{getCoinFromLuckScore(card.front.luck_score).symbol}
								</div>
								<div className="text-base sm:text-xl text-white/60">
									at{" "}
									<span className="text-[#f5c842] font-semibold">
										{leverage}x
									</span>{" "}
									leverage
								</div>
							</div>

							{/* Amount Section */}
							<div className="mb-6">
								<p className="text-xs text-white/50 uppercase tracking-wider mb-3">
									Trade Amount (SOL)
								</p>
								<div className="relative">
									<span className="absolute left-5 top-1/2 -translate-y-1/2 text-2xl text-white/40 font-display">
										SOL
									</span>
									<input
										type="number"
										value={amount}
										onChange={(e) => setTradeAmount(Number(e.target.value))}
										min={10}
										className="w-full py-5 px-6 pl-17 bg-white/5 border border-white/10 rounded-xl text-2xl font-display font-semibold focus:outline-none focus:border-[#d4a017]/50"
									/>
								</div>
								<div className="flex flex-wrap gap-2 mt-3">
									{QUICK_AMOUNTS.map((qa) => (
										<button
											key={qa}
											onClick={() => setTradeAmount(qa)}
											className={`quick-btn flex-1 min-w-[60px] ${amount === qa ? "active" : ""}`}
											type="button"
										>
											{qa} SOL
										</button>
									))}
								</div>
							</div>

							{/* Trade Education */}
							<div className="mb-6 text-center">
								{!showEducation ? (
									<button
										onClick={(e) => {
											e.stopPropagation();
											setShowEducation(true);
										}}
										className="text-xs text-white/30 hover:text-white/50 transition-colors underline decoration-dotted underline-offset-4"
									>
										Understand what will happen
									</button>
								) : (
									<div
										className="text-xs text-white/60 px-4 cursor-pointer leading-relaxed"
										onClick={(e) => {
											e.stopPropagation();
											setShowEducation(false);
										}}
									>
										This opens a <strong>{direction.toLowerCase()}</strong>{" "}
										position on SOL at <strong>{leverage}x</strong> leverage
										using <strong>{amount} SOL</strong>. It auto-closes in 30
										seconds. You'll approve 2 transactions: open and pre-sign
										auto-close.
									</div>
								)}
							</div>

							{/* Warning Box */}
							<div className="warning-box mb-6">
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<title>svg</title>
									<path d="M12 9v4M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
								</svg>
								<p className="warning-text">
									<strong>High leverage warning:</strong> {leverage}x
									leverage means small price movements result in amplified gains
									or losses.
								</p>
							</div>

							{/* Balance validation warning */}
							{insufficientBalance && (
								<div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 mb-4">
									<p className="text-sm text-red-300">
										Insufficient balance. You need at least{" "}
										<strong>{requiredBalance.toFixed(4)} SOL</strong> ({amount}{" "}
										SOL + ~{GAS_BUFFER_SOL} SOL for fees).
										{balance !== null && (
											<>
												{" "}
												Current balance:{" "}
												<strong>{balance.toFixed(4)} SOL</strong>
											</>
										)}
									</p>
								</div>
							)}

							{/* Minimum amount warning */}
							{amount > 0 && amount < MIN_TRADE_AMOUNT_SOL && (
								<p className="text-xs text-red-400 mb-2 text-center">
									Minimum trade amount is {MIN_TRADE_AMOUNT_SOL} SOL
								</p>
							)}

							<button
								onClick={handleAction}
								disabled={
									isTrading ||
									amount < MIN_TRADE_AMOUNT_SOL ||
									insufficientBalance
								}
								className="btn-primary w-full mb-3 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
								type="button"
							>
								{isTrading ? (
									<>
										<span className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" />
										Preparing transaction...
									</>
								) : (
									<>
										<svg
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											className="w-5 h-5"
										>
											<title>svg</title>
											<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
										</svg>
										Confirm & Execute Trade
									</>
								)}
							</button>

							<button
								onClick={onClose}
								className="btn-secondary w-full"
								type="button"
							>
								Cancel
							</button>
							<div className="text-sm text-white/70 mt-4 text-center">
								Trade powered by{" "}
								<a
									href="https://www.flash.trade/USDC-SOL"
									target="_blank"
									rel="noopener noreferrer"
									className="underline"
								>
									flash.trade
								</a>
							</div>
						</div>
					</div>
				</section>
			)}
		</>
	);
};

// Extract number from lucky number string
function extractNumber(numStr: string): number {
	const match = numStr.match(/\d+/);
	return match ? parseInt(match[0], 10) : 42;
}

function SolPriceChart({ data }: { data: { t: number; price: number }[] }) {
	const min = data.length ? Math.min(...data.map((d) => d.price)) : 0;
	const max = data.length ? Math.max(...data.map((d) => d.price)) : 0;
	const pad = data.length ? (max - min) * 0.15 || 1 : 1;

	const lastIndex = data.length - 1;

	return (
		<ResponsiveContainer width="100%" height="100%">
			<LineChart data={data}>
				<YAxis hide domain={[min - pad, max + pad]} />
				<Tooltip
					contentStyle={{
						background: "rgba(0,0,0,0.6)",
						border: "1px solid rgba(255,255,255,0.1)",
						borderRadius: 12,
					}}
					labelFormatter={() => ""}
					formatter={(value: any) => [`$${Number(value).toFixed(2)}`, "SOL"]}
				/>
				<Line
					type="monotone"
					dataKey="price"
					stroke="#22c55e"
					strokeWidth={2}
					dot={(props: any) => {
						const { cx, cy, index, payload } = props;
						if (index !== lastIndex) return null;

						const price = payload.price;
						const text = `$${Number(price).toFixed(2)}`;

						return (
							<g>
								{/* End dot */}
								<circle cx={cx} cy={cy} r={4} fill="#22c55e" />
								<circle cx={cx} cy={cy} r={2} fill="#fff" />

								{/* Price label background */}
								<rect
									x={cx + 12}
									y={cy - 12}
									width={text.length * 6 + 20}
									height={24}
									rx={12}
									fill="rgba(34,197,94,0.2)"
									stroke="rgba(34,197,94,0.4)"
									strokeWidth={1}
								/>

								{/* Price text */}
								<text
									x={cx + 22}
									y={cy + 2}
									fill="#22c55e"
									fontSize={12}
									fontWeight="700"
									textAnchor="start"
								>
									{text}
								</text>
							</g>
						);
					}}
					isAnimationActive={false}
					style={{
						filter: "drop-shadow(0 0 6px rgba(34,197,94,0.6))",
					}}
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}
