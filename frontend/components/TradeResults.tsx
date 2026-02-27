"use client";

import * as htmlToImage from "html-to-image";
import Image from "next/image";
import { FC, useRef, useState } from "react";
import type { AstroCard } from "@/types";
import { Confetti } from "./Confetti";
import { StarBackground } from "./StarBackground";
import type { TradeResult } from "./TradeExecution";
import { getCoinFromLuckScore } from "./HoroscopeReveal";

interface TradeResultsProps {
	card: AstroCard;
	result: TradeResult;
	onReturnHome: () => void;
	handleTryAgain: () => void;
}

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

export const TradeResults: FC<TradeResultsProps> = ({
	card,
	result,
	onReturnHome,
	handleTryAgain,
}) => {
	const today = new Date().toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	const zodiacSign = card.front.zodiac_sign || "Aries";
	const zodiacSymbol = zodiacSymbols[zodiacSign.toLowerCase()] || "♈";
	const luckyNumber = result.leverage;
	const luckyColor = card.back.lucky_assets.color || "Gold";
	const vibeStatus = card.front.vibe_status || "Confident";
	const energyEmoji = card.front.energy_emoji || "✨";
	const reading = `${card.front.hook_1} ${card.front.hook_2}`;

	const colorKey = luckyColor.toLowerCase();
	const colorGradient =
		colorGradients[colorKey] ||
		colorGradients[
		Object.keys(colorGradients).find((k) => colorKey.includes(k)) || "gold"
		];

	const handleShareX = async () => {
		const text = `my daily horoscope verified by a trade on @tryhashtro\n\n“${reading}”\n\nhashtro.fun`;
		const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;

		if (cardRef.current && !isCopying) {
			try {
				setIsCopying(true);
				setCopyStatus("copying");
				const blob = await htmlToImage.toBlob(cardRef.current, {
					pixelRatio: 2,
					backgroundColor: "#000",
					cacheBust: true,
					style: { borderRadius: "0" },
				});

				if (blob) {
					await navigator.clipboard.write([
						new ClipboardItem({ "image/png": blob }),
					]);
					setCopyStatus("success");
					setTimeout(() => setCopyStatus("idle"), 2000);
				}
			} catch (err) {
				console.error("Failed to copy image for sharing:", err);
				setCopyStatus("error");
				setTimeout(() => setCopyStatus("idle"), 2000);
			} finally {
				setIsCopying(false);
			}
		}

		window.open(url, "_blank");
	};

	const [isCopying, setIsCopying] = useState(false);
	const [copyStatus, setCopyStatus] = useState<
		"idle" | "copying" | "success" | "error"
	>("idle");
	const cardRef = useRef<HTMLDivElement>(null);

	const handleCopyImage = async () => {
		if (!cardRef.current || isCopying) return;

		try {
			setIsCopying(true);
			setCopyStatus("copying");

			const blob = await htmlToImage.toBlob(cardRef.current, {
				pixelRatio: 2,
				backgroundColor: "#000",
				cacheBust: true,
				style: {
					borderRadius: "0",
				},
			});

			if (!blob) throw new Error("Failed to generate image");

			await navigator.clipboard.write([
				new ClipboardItem({
					"image/png": blob,
				}),
			]);

			setCopyStatus("success");
			setTimeout(() => setCopyStatus("idle"), 2000);
		} catch (err) {
			console.error("Failed to copy image:", err);
			setCopyStatus("error");
			setTimeout(() => setCopyStatus("idle"), 2000);
		} finally {
			setIsCopying(false);
		}
	};

	return (
		<section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden px-4 py-6 sm:py-10">
			<StarBackground showSuccessOrb={result.success} />
			{result.success && <Confetti />}

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

				{/* Card */}
				<div ref={cardRef} className="card-glass relative overflow-hidden">
					{/* Top gradient bar */}
					<div
						className="absolute top-0 left-0 right-0 h-1"
						style={{
							background:
								result.pnlPercent >= 0
									? "linear-gradient(90deg, #22c55e, #10b981, #d4a017)"
									: "linear-gradient(90deg, #ef4444, #dc2626, #7f1d1d)",
						}}
					/>

					{/* Verified badge */}
					<div className="flex justify-center mb-6 pt-2">
						{result.pnlPercent >= 0 ? (
							<div className="badge-verified">
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<path d="M20 6L9 17l-5-5" />
								</svg>
								<span>Verified by Trade</span>
							</div>
						) : (
							<div className="badge-unverified">
								<svg
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
								>
									<path d="M6 18L18 6M6 6l12 12" />
								</svg>
								<span>Not Verified</span>
							</div>
						)}
					</div>

					<div className="text-center mb-6 pb-6 border-b border-white/[0.08]">
						{result.pnlPercent >= 0 ? (
							<p className="reading-text">"{reading}"</p>
						) : (
							<>
								<p className="reading-text text-[#ef4444]/80">
									"The stars weren't aligned this time. Your horoscope remains
									unverified."
								</p>
								<p className="text-xs text-white/50 mt-3">
									Try again to verify your cosmic predictions
								</p>
							</>
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

					{/* Trade Result */}
					<div
						className={`${result.pnlPercent >= 0 ? "trade-result" : "trade-result-failed"} mb-6`}
					>
						<div className="flex justify-between items-center mb-4">
							<span className="text-[10px] text-white/50 uppercase tracking-[1.5px]">
								Verification Trade
							</span>
							<span
								className={`text-[10px] px-2.5 py-1 rounded-full font-semibold ${result.pnl >= 0
									? "bg-[#22c55e]/20 text-[#22c55e]"
									: "bg-[#ef4444]/20 text-[#ef4444]"
									}`}
							>
								{result.pnl >= 0 ? "Profitable" : "Loss"}
							</span>
						</div>
						<div className="flex items-center justify-center gap-2 sm:gap-4 flex-wrap">
							<div className="text-center">
								<p className="font-display text-lg font-semibold">{getCoinFromLuckScore(card.front.luck_score).symbol}</p>
								<p className="text-[10px] text-white/40 uppercase mt-1">
									Ticker
								</p>
							</div>
							<span className="text-white/20">•</span>
							<div className="text-center">
								<p className="font-display text-lg font-semibold">
									{result.leverage}x
								</p>
								<p className="text-[10px] text-white/40 uppercase mt-1">
									Leverage
								</p>
							</div>
							<span className="text-white/20">•</span>
							<div className="text-center">
								<p
									className={`font-display text-lg font-semibold ${result.direction === "LONG"
										? "text-[#22c55e]"
										: "text-[#ef4444]"
										}`}
								>
									{result.direction}
								</p>
								<p className="text-[10px] text-white/40 uppercase mt-1">
									Direction
								</p>
							</div>
							<span className="text-white/20">•</span>
							<div className="text-center">
								<p
									className={`font-display text-lg font-semibold ${result.pnlPercent >= 0 ? "text-[#22c55e]" : "text-[#ef4444]"
										}`}
								>
									{result.pnlPercent >= 0 ? "+" : ""}
									{result.pnlPercent.toFixed(2)}%
								</p>
								<p className="text-[10px] text-white/40 uppercase mt-1">
									PnL(%)
								</p>
							</div>
						</div>
					</div>

					{/* Footer */}
					<div className="flex justify-between items-center pt-5 border-t border-white/[0.08]">
						<span className="font-display text-lg font-bold bg-gradient-to-r from-white to-[#d4a017] bg-clip-text text-transparent">
							<Image src="/logo/hast.png" alt="Logo" width={70} height={70} />
						</span>
						<span className="text-sm text-white/40">hashtro.fun</span>
					</div>
				</div>

				<button onClick={handleTryAgain} className="btn-copy bg-white/5 py-4 mt-5 w-full justify-center">

					Trade Again
				</button>


				{/* Action buttons */}
				<div className="flex flex-col sm:flex-row gap-3 mt-7">
					<button
						onClick={handleShareX}
						className="btn-share w-full justify-center"
					>
						<svg
							viewBox="0 0 24 24"
							fill="currentColor"
							className="w-[18px] h-[18px]"
						>
							<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
						</svg>
						Share on X
					</button>
					<button
						onClick={handleCopyImage}
						disabled={isCopying}
						className={`btn-copy w-full sm:w-auto justify-center transition-all ${copyStatus === "success" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40" : ""}`}
					>
						{copyStatus === "copying" ? (
							<div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
						) : copyStatus === "success" ? (
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								className="w-[18px] h-[18px]"
							>
								<path d="M20 6L9 17l-5-5" />
							</svg>
						) : (
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								className="w-[18px] h-[18px]"
							>
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
								<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
							</svg>
						)}
						{copyStatus === "copying"
							? "Copying..."
							: copyStatus === "success"
								? "Copied!"
								: copyStatus === "error"
									? "Error!"
									: "Copy Image"}
					</button>
				</div>
				<p className="text-sm uppercase text-white/30 text-center mt-3 font-mono">
					press <span className="text-white/50">cmd/ctrl + v</span> to
					paste image in your post draft
				</p>


				{/* Flash.trade CTA */}
				<a
					href="https://www.flash.trade/?referral=HASHTRO"
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center justify-between mt-6 px-5 py-4 rounded-2xl bg-white/[0.04] border border-white/10 hover:border-[#d4a017]/40 hover:bg-[#d4a017]/[0.06] transition-all group"
				>
					<div className="flex flex-col gap-0.5">
						<span className="text-xs text-white/40 uppercase tracking-widest">
							Trade more perps
						</span>
						<span className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">
							Try Flash.trade ↗
						</span>
					</div>
					<span className="text-2xl">⚡</span>
				</a>

				<button
					onClick={onReturnHome}
					className="w-full mt-5 py-3.5 text-sm text-white/50 hover:text-white transition-colors"
				>
					Return to Home
				</button>
			</div>
		</section>
	);
};
