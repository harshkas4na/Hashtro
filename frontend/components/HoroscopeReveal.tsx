"use client";

import { motion } from "framer-motion";
import { FC, useState } from "react";
import { useStore } from "@/store/useStore";
import type { AstroCard } from "@/types";
import { StarBackground } from "./StarBackground";

interface HoroscopeRevealProps {
	card: AstroCard;
	verified?: boolean;
	onVerifyTrade: () => void;
}

// Add this interface near the top with other interfaces
export interface CoinAllocation {
	symbol: string;
	minScore: number;
	maxScore: number;
	displayName: string;
}

// Add this constant after POOL_CONFIGS
export const COIN_ALLOCATIONS: CoinAllocation[] = [
	// 0-50 range (10 points each)
	{ symbol: "BNB", minScore: 0, maxScore: 10, displayName: "BNB" },
	{ symbol: "BTC", minScore: 10, maxScore: 20, displayName: "Bitcoin" },
	{ symbol: "ZEC", minScore: 20, maxScore: 30, displayName: "Zcash" },
	{ symbol: "ETH", minScore: 30, maxScore: 40, displayName: "Ethereum" },
	{ symbol: "SOL", minScore: 40, maxScore: 50, displayName: "Solana" },
	// 50-200 range (30 points each)
	{ symbol: "BNB", minScore: 50, maxScore: 60, displayName: "BNB" },
	{ symbol: "BTC", minScore: 60, maxScore: 70, displayName: "Bitcoin" },
	{ symbol: "SOL", minScore: 70, maxScore: 80, displayName: "Solana" },
	{ symbol: "ETH", minScore: 80, maxScore: 90, displayName: "Ethereum" },
	{ symbol: "ZEC", minScore: 90, maxScore: 100, displayName: "ZCash" },
];

// Add helper function to get coin from luck score
export const getCoinFromLuckScore = (luckScore: number): CoinAllocation => {
	// Normalize luck score to 0-200 range
	const normalizedScore = Math.max(0, Math.min(200, luckScore));

	const allocation = COIN_ALLOCATIONS.find(
		(coin) =>
			normalizedScore >= coin.minScore && normalizedScore < coin.maxScore,
	);

	// Fallback to last coin if score is exactly 200
	return allocation || COIN_ALLOCATIONS[COIN_ALLOCATIONS.length - 1];
};

// Map color names to CSS gradients
const colorGradients: Record<string, string> = {
	"fire red": "linear-gradient(135deg, #ef4444, #f97316)",
	red: "linear-gradient(135deg, #ef4444, #dc2626)",
	orange: "linear-gradient(135deg, #f97316, #ea580c)",
	yellow: "linear-gradient(135deg, #eab308, #ca8a04)",
	gold: "linear-gradient(135deg, #d4a017, #f5c842)",
	green: "linear-gradient(135deg, #22c55e, #16a34a)",
	blue: "linear-gradient(135deg, #3b82f6, #2563eb)",
	purple: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
	pink: "linear-gradient(135deg, #ec4899, #db2777)",
	white: "linear-gradient(135deg, #ffffff, #e5e5e5)",
	silver: "linear-gradient(135deg, #c0c0c0, #a8a8a8)",
	emerald: "linear-gradient(135deg, #10b981, #059669)",
	azure: "linear-gradient(135deg, #0ea5e9, #0284c7)",
	crimson: "linear-gradient(135deg, #dc143c, #b91c1c)",
	indigo: "linear-gradient(135deg, #6366f1, #4f46e5)",
	violet: "linear-gradient(135deg, #8b5cf6, #7c3aed)",
	teal: "linear-gradient(135deg, #14b8a6, #0d9488)",
	coral: "linear-gradient(135deg, #f97316, #ea580c)",
};

// Get zodiac symbol from sign name
const zodiacSymbols: Record<string, string> = {
	aries: "♈",
	taurus: "♉",
	gemini: "♊",
	cancer: "♋",
	leo: "♌",
	virgo: "♍",
	libra: "♎",
	scorpio: "♏",
	sagittarius: "♐",
	capricorn: "♑",
	aquarius: "♒",
	pisces: "♓",
};

// Derive trade direction from mood/vibe
function deriveDirection(vibeStatus: string): "LONG" | "SHORT" {
	const positiveKeywords = [
		"confident",
		"optimistic",
		"energetic",
		"creative",
		"happy",
		"excited",
		"bold",
		"adventurous",
		"passionate",
		"lucky",
		"stellar",
		"ascending",
	];
	const vibe = vibeStatus.toLowerCase();
	return positiveKeywords.some((kw) => vibe.includes(kw)) ? "LONG" : "SHORT";
}

// Extract number from lucky number string
function extractNumber(numStr: string): number {
	const match = numStr.match(/\d+/);
	return match ? parseInt(match[0], 10) : 42;
}

export const HoroscopeReveal: FC<HoroscopeRevealProps> = ({
	card,
	verified = false,
	onVerifyTrade,
}) => {
	const [isFlipped, setIsFlipped] = useState(false);
	const [showEducation, setShowEducation] = useState(false);
	const { user } = useStore();
	const verifiedToday = isVerifiedToday(user?.tradeMadeAt);

	const today = new Date().toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	const zodiacSign = card.front.zodiac_sign || "Aries";
	const zodiacSymbol = zodiacSymbols[zodiacSign.toLowerCase()] || "♈";
	const luckyNumber = extractNumber(card.back.lucky_assets.number);
	const luckyColor = card.back.lucky_assets.color || "Gold";
	const vibeStatus = card.front.vibe_status || "Confident";
	const energyEmoji = card.front.energy_emoji || "✨";
	const reading = `${card.front.hook_1}\n${card.front.hook_2}`;
	const direction = card.front.luck_score > 50 ? "LONG" : "SHORT";

	// Get color gradient
	const colorKey = luckyColor.toLowerCase();
	const colorGradient =
		colorGradients[colorKey] ||
		colorGradients[
		Object.keys(colorGradients).find((k) => colorKey.includes(k)) || "gold"
		];

	const handleFlip = () => {
		setIsFlipped(!isFlipped);
	};

	return (
		<section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-4 py-6 sm:py-10">
			<StarBackground />

			<div className="relative z-10 w-full max-w-[520px] screen-fade-in">
				{/* Header */}
				<div className="text-center mb-6 sm:mb-8">
					<p className="text-xs sm:text-sm text-white/50 uppercase tracking-[2px] mb-2">
						{today}
					</p>
					<h1 className="zodiac-title text-2xl sm:text-3xl md:text-4xl">
						<img
							src={`/zodiac/${zodiacSign.toLowerCase()}.svg`}
							alt={zodiacSign}
							className="w-20 h-20"
						/>
						{zodiacSign}
					</h1>
				</div>

				{/* Flip Container */}
				<div
					className="relative w-full cursor-pointer"
					style={{ perspective: "1200px" }}
					onClick={handleFlip}
				>
					<motion.div
						className="relative w-full"
						style={{ transformStyle: "preserve-3d" }}
						animate={{ rotateY: isFlipped ? 180 : 0 }}
						transition={{
							duration: 0.6,
							type: "spring",
							stiffness: 80,
							damping: 15,
						}}
					>
						{/* ==================== FRONT FACE ==================== */}
						<div
							className="card-glass"
							style={{
								backfaceVisibility: "hidden",
								WebkitBackfaceVisibility: "hidden",
							}}
						>
							{/* Verification badge */}
							<div className="flex justify-center mb-6">
								{verified || verifiedToday ? (
									<div className="badge-verified">
										<span className="w-2 h-2 rounded-full bg-[#22c55e]" />
										Verified for today
									</div>
								) : (
									<div className="badge-unverified">
										<span className="w-2 h-2 rounded-full bg-white/30" />
										Unverified
									</div>
								)}
							</div>

							{/* Lucky Grid */}
							<div className="lucky-grid mb-6">
								<div className="lucky-item">
									<p className="lucky-label">Lucky Number</p>
									<p className="lucky-value">{luckyNumber}</p>
								</div>
								<div className="lucky-item">
									<p className="lucky-label">Lucky Color</p>
									<div
										className="lucky-color-swatch"
										style={{ background: colorGradient }}
									/>
									<p className="lucky-color-name">{luckyColor}</p>
								</div>
								<div className="lucky-item">
									<p className="lucky-label">Mood</p>
									<p className="mood-emoji">{energyEmoji}</p>
									<p className="mood-text">{vibeStatus}</p>
								</div>
							</div>

							{/* Today's Reading */}
							<div className="mb-6 pb-6 border-b border-white/[0.08]">
								<p className="text-[10px] text-white/40 uppercase tracking-[1.5px] mb-3">
									Today's Reading
								</p>
								<p className="reading-text">"{reading}"</p>
							</div>

							{/* Trade Derivation */}
							<div className="mb-6">
								<p className="text-[10px] text-white/40 uppercase tracking-[1.5px] mb-4 text-center">
									How Your Trade is Derived
								</p>
								<div className="derivation-flow flex md:flex-row flex-row items-center justify-center gap-3 sm:gap-1">
									<div className="derivation-item">
										<span className="derivation-value">{luckyNumber}</span>
										<span className="derivation-label">Number</span>
									</div>

									<span className="mb-3 derivation-arrow ">→</span>

									<div className="derivation-item">
										<span className="derivation-value">{luckyNumber}x</span>
										<span className="derivation-label">Leverage</span>
									</div>
									<span className="mb-4 derivation-arrow hidden sm:block">
										|
									</span>

									<div className="derivation-item mt-2 sm:mt-0">
										<span className="derivation-value">{card.front.luck_score}</span>
										<span className="derivation-label">Luck Score</span>
									</div>

									<span className="mb-3 derivation-arrow ">→</span>
									<div className="derivation-item">
										<span className="derivation-value">
											{getCoinFromLuckScore(card.front.luck_score).symbol}
										</span>
										<span className="derivation-label">Ticker</span>
									</div>
									<span className="mb-4 derivation-arrow hidden sm:block">
										|
									</span>

									<div className="derivation-item mt-2 sm:mt-0">
										<span className="derivation-value">{vibeStatus}</span>
										<span className="derivation-label">Mood</span>
									</div>

									<span className="mb-3 derivation-arrow">→</span>
									<div className="derivation-item">
										<span className={`derivation-value highlight`}>
											{direction}
										</span>
										<span className="derivation-label">Direction</span>
									</div>
								</div>
							</div>

							{/* Trade Preview */}
							<div className="trade-preview mb-6">
								<div className="flex justify-between items-center mb-3">
									<span className="text-[10px] text-white/50 uppercase tracking-[1.5px]">
										Your Verification Trade
									</span>
									<span className="text-[10px] px-2.5 py-1 bg-[#d4a017]/20 text-[#f5c842] rounded-full">
										30 seconds
									</span>
								</div>
								<div className="flex items-center justify-center gap-3">
									<span className="font-display text-lg font-semibold">
										{getCoinFromLuckScore(card.front.luck_score).symbol}
									</span>
									<span className="text-white/20">•</span>
									<span className="font-display text-lg font-semibold">
										{luckyNumber}x
									</span>
									<span className="text-xs text-white/50">leverage</span>
									<span className="text-white/20">•</span>
									<span
										className={`font-display text-lg font-semibold ${direction === "LONG" ? "text-[#22c55e]" : "text-[#ef4444]"
											}`}
									>
										{direction}
									</span>
								</div>
							</div>

							{/* Flip Hint */}
							<div className="flex items-center justify-center gap-2 mb-4 text-white/40">
								<svg
									className="w-4 h-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									strokeWidth="2"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
									/>
								</svg>
								<span className="text-xs">Tap for deep insights</span>
							</div>

							{/* Trade Education */}
							{!(verified || verifiedToday) && (
								<div className="mb-4 text-center">
									{!showEducation ? (
										<button
											onClick={(e) => {
												e.stopPropagation();
												setShowEducation(true);
											}}
											className="text-xs text-white/30 hover:text-white/50 transition-colors underline decoration-dotted underline-offset-4"
										>
											What is verify with trade?
										</button>
									) : (
										<motion.div
											initial={{ opacity: 0, height: 0 }}
											animate={{ opacity: 1, height: "auto" }}
											className="text-xs text-white/60 px-4 cursor-pointer leading-relaxed"
											onClick={(e) => {
												e.stopPropagation();
												setShowEducation(false);
											}}
										>
											A quick 30-second leveraged trade on SOL will verify your
											horoscope. Position auto-closes. Profits are yours.
										</motion.div>
									)}
								</div>
							)}

							{/* Verify / Trade Again Button */}
							<button
								onClick={(e) => {
									e.stopPropagation();
									if (!(verified || verifiedToday)) onVerifyTrade();
								}}
								disabled={verified || verifiedToday}
								className={`btn-primary w-full text-sm sm:text-base ${verified || verifiedToday
									? "opacity-70 cursor-not-allowed"
									: ""
									}`}
							>
								{verified || verifiedToday ? (
									<>
										<svg
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											className="w-5 h-5"
										>
											<path d="M20 6 9 17l-5-5" />
										</svg>
										Verified for today
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
											<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
										</svg>
										Verify with Trade
									</>
								)}
							</button>

							<p className="text-center mt-4 text-[10px] sm:text-xs text-white/40">
								Minimum (0.04 SOL) required • Profits are yours to keep
							</p>

							{/* Share on X button — Twitter Web Intent, no API needed */}
							<button
								onClick={(e) => {
									e.stopPropagation();
									const text = `my cosmic reading for today on @tryhashtro\n\n"${card.front.tagline}"\n\n${card.front.hook_1}\n\n#Hashtro hashtro.fun`;
									window.open(
										`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
										"_blank",
										"noopener,noreferrer",
									);
								}}
								className="btn-share w-full justify-center mt-3 text-sm sm:text-base"
							>
								<svg
									viewBox="0 0 24 24"
									fill="currentColor"
									className="w-[18px] h-[18px]"
								>
									<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
								</svg>
								Share Reading on X
							</button>

							{/* Flash.trade CTA */}
							<a
								href="https://www.flash.trade/?referral=HASHTRO"
								target="_blank"
								rel="noopener noreferrer"
								onClick={(e) => e.stopPropagation()}
								className="flex items-center justify-center gap-1.5 mt-4 text-[11px] text-white/30 hover:text-white/60 transition-colors group"
							>
								<span>⚡</span>
								<span>Want to trade more perps?</span>
								<span className="text-[#d4a017]/60 group-hover:text-[#f5c842] transition-colors underline underline-offset-2 decoration-dotted">
									Try Flash.trade
								</span>
								<span className="group-hover:translate-x-0.5 transition-transform">↗</span>
							</a>
						</div>

						{/* ==================== BACK FACE ==================== */}
						<div
							className="card-glass absolute inset-0 w-full flex flex-col"
							style={{
								backfaceVisibility: "hidden",
								WebkitBackfaceVisibility: "hidden",
								transform: "rotateY(180deg)",
							}}
						>
							{/* Content Wrapper */}
							<div className="flex-1 overflow-y-auto custom-scrollbar no-visible-scrollbar">
								{/* Header */}
								<div className="flex items-center justify-between mb-6">
									<div className="flex items-center gap-3">
										<div className="w-10 h-10 rounded-xl bg-[#d4a017]/20 flex items-center justify-center">
											<span className="text-xl">{zodiacSymbol}</span>
										</div>
										<div>
											<h3 className="text-lg font-bold text-white">
												Deep Insights
											</h3>
											<p className="text-xs text-white/40 uppercase tracking-widest">
												{zodiacSign}
											</p>
										</div>
									</div>
									<div className="px-3 py-1.5 rounded-full text-xs font-bold bg-[#d4a017]/20 text-[#f5c842]">
										{vibeStatus}
									</div>
								</div>

								{/* Cosmic Insight */}
								<div className="mb-5">
									<div className="flex items-center gap-2 mb-2">
										<span className="text-base">🔮</span>
										<h4 className="text-xs font-bold text-white/70 uppercase tracking-widest">
											Cosmic Insight
										</h4>
									</div>
									<p className="text-sm leading-relaxed text-white/80 pl-6">
										{card.back.detailed_reading}
									</p>
								</div>

								{/* Hustle Alpha */}
								<div className="mb-5 p-4 rounded-2xl bg-white/[0.04] border border-white/10">
									<div className="flex items-center gap-2 mb-2">
										<span className="text-base">💼</span>
										<h4 className="text-xs font-bold text-white/60 uppercase tracking-widest">
											Hustle Alpha
										</h4>
									</div>
									<p className="text-sm text-white/90 font-medium leading-relaxed pl-6">
										{card.back.hustle_alpha}
									</p>
								</div>

								{/* Shadow Warning */}
								<div className="mb-5 p-4 rounded-2xl bg-gradient-to-br from-red-500/[0.08] to-orange-500/[0.05] border border-red-500/20">
									<div className="flex items-center gap-2 mb-2">
										<span className="text-base">⚠️</span>
										<h4 className="text-xs font-bold text-red-300/70 uppercase tracking-widest">
											Shadow Warning
										</h4>
									</div>
									<p className="text-sm text-white/85 leading-relaxed pl-6">
										{card.back.shadow_warning}
									</p>
								</div>
							</div>

							{/* Lucky Assets */}
							<div className="mb-5">
								<div className="flex items-center gap-2 mb-2">
									<span className="text-base">🍀</span>
									<h4 className="text-xs font-bold text-white/70 uppercase tracking-widest">
										Lucky Assets
									</h4>
								</div>
								<div className="grid grid-cols-2 gap-2">
									{/* Asset */}
									<div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-center">
										<div className="flex items-center justify-center gap-1 mb-1 opacity-60">
											<span className="text-sm">
												{card.back.lucky_assets.emoji || "💎"}
											</span>
											<span className="text-[9px] uppercase font-bold">
												Asset
											</span>
										</div>
										<div className="font-bold text-white truncate">
											{card.back.lucky_assets.ticker || "CRYPTO"}
										</div>
										{card.back.lucky_assets.name && (
											<div className="text-[10px] text-white/40 truncate">
												{card.back.lucky_assets.name}
											</div>
										)}
									</div>

									{/* Leverage */}
									<div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-center">
										<div className="flex items-center justify-center gap-1 mb-1 opacity-60">
											<span className="text-sm">🚀</span>
											<span className="text-[9px] uppercase font-bold">
												Max Lev
											</span>
										</div>
										<div className="text-sm md:text-lg font-bold text-white leading-tight truncate">
											{luckyNumber}x
										</div>
									</div>

									{/* Color */}
									<div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-center">
										<div className="flex items-center justify-center gap-1 mb-1 opacity-60">
											<span className="text-sm">🎨</span>
											<span className="text-[9px] uppercase font-bold">
												Color
											</span>
										</div>
										<div className="font-bold text-white text-xs truncate">
											{card.back.lucky_assets.color}
										</div>
									</div>

									{/* Power Hour */}
									<div className="p-3 rounded-xl bg-white/[0.04] border border-white/10 text-center">
										<div className="flex items-center justify-center gap-1 mb-1 opacity-60">
											<span className="text-sm">⚡</span>
											<span className="text-[9px] uppercase font-bold">
												Power Hour
											</span>
										</div>
										<div className="font-bold text-white text-xs truncate">
											{card.back.lucky_assets.power_hour}
										</div>
									</div>
								</div>
							</div>

							{/* Flip Back Hint */}
							<div className="flex items-center justify-center gap-2 text-white/40 pt-3 border-t border-white/10 mt-auto shrink-0">
								<svg
									className="w-4 h-4"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									strokeWidth="2"
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
									/>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M3 3v5h5"
									/>
								</svg>
								<span className="text-xs font-medium">Tap to flip back</span>
							</div>
						</div>
					</motion.div>
				</div>
			</div>
		</section>
	);
};

function isSameLocalDay(a: Date, b: Date) {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

function isVerifiedToday(tradeMadeAt?: string | null) {
	if (!tradeMadeAt) return false;
	const madeAt = new Date(tradeMadeAt);
	if (Number.isNaN(madeAt.getTime())) return false;
	return isSameLocalDay(madeAt, new Date());
}
