import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";

function getSecret(): string {
	return process.env.IMAGE_SIGN_SECRET || process.env.JWT_SECRET || "dev-secret";
}

function sign(payload: string): string {
	return crypto.createHmac("sha256", getSecret()).update(payload).digest("hex").slice(0, 32);
}

function verify(payload: string, sig: string | null): boolean {
	if (!sig) return false;
	const expected = sign(payload);
	const a = Buffer.from(expected);
	const b = Buffer.from(sig);
	if (a.length !== b.length) return false;
	return crypto.timingSafeEqual(a, b);
}

type PlanetKey = "sun" | "moon" | "mars" | "mercury" | "jupiter" | "venus" | "saturn";

const PLANET_COLORS: Record<PlanetKey, { from: string; to: string; accent: string }> = {
	sun: { from: "#F59E0B", to: "#EA580C", accent: "#FCD34D" },
	moon: { from: "#3B82F6", to: "#6366F1", accent: "#A5B4FC" },
	mars: { from: "#DC2626", to: "#EF4444", accent: "#FCA5A5" },
	mercury: { from: "#10B981", to: "#059669", accent: "#6EE7B7" },
	jupiter: { from: "#8B5CF6", to: "#A855F7", accent: "#C4B5FD" },
	venus: { from: "#EC4899", to: "#F43F5E", accent: "#FBCFE8" },
	saturn: { from: "#6B7280", to: "#4B5563", accent: "#9CA3AF" },
};

function resolvePlanet(name?: string): PlanetKey {
	const k = (name || "").toLowerCase();
	if (k in PLANET_COLORS) return k as PlanetKey;
	return "jupiter";
}

export async function GET(req: NextRequest) {
	const url = new URL(req.url);
	const w = url.searchParams.get("w");
	const d = url.searchParams.get("d");
	const s = url.searchParams.get("s");

	if (!w || !d || !s) {
		return new Response("Missing params", { status: 400 });
	}
	if (!verify(`card:${w}:${d}`, s)) {
		return new Response("Invalid signature", { status: 403 });
	}

	const fetchUrl = `${API_BASE}/horoscope/public/card?w=${encodeURIComponent(w)}&d=${encodeURIComponent(d)}&s=${encodeURIComponent(s)}`;
	const res = await fetch(fetchUrl, { cache: "no-store" });
	if (!res.ok) {
		return new Response("Card not found", { status: 404 });
	}
	const body = await res.json();
	const card = body?.card;
	const verified: boolean = body?.verified ?? false;

	const front = card?.front ?? {};
	const back = card?.back ?? {};
	const title: string = front.title || "Daily Card";
	const summary: string = front.summary || front.horoscope || "";
	const luckScore: number = typeof front.luck_score === "number" ? front.luck_score : 50;
	const vibe: string = front.vibe || (luckScore > 50 ? "LONG" : "SHORT");
	const planet = resolvePlanet(front.dominant_planet || front.planet);
	const theme = PLANET_COLORS[planet];
	const ticker: string = back?.lucky_assets?.ticker || "—";
	const leverage: number = back?.lucky_assets?.max_leverage || 0;
	const powerHour: string = back?.lucky_assets?.power_hour || "";
	const direction = luckScore > 50 ? "LONG" : "SHORT";

	return new ImageResponse(
		(
			<div
				style={{
					width: "1200px",
					height: "630px",
					display: "flex",
					flexDirection: "column",
					background: `linear-gradient(135deg, #0a0a1a 0%, #1a0a2e 50%, #0a0a1a 100%)`,
					color: "white",
					fontFamily: "system-ui, sans-serif",
					position: "relative",
					padding: "48px",
				}}
			>
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						height: "8px",
						background: `linear-gradient(90deg, ${theme.from} 0%, ${theme.to} 100%)`,
						display: "flex",
					}}
				/>

				<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
					<div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
						<div style={{ fontSize: "48px", display: "flex" }}>🔮</div>
						<div style={{ display: "flex", flexDirection: "column" }}>
							<div style={{ fontSize: "14px", letterSpacing: "4px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase" }}>
								hastrology
							</div>
							<div style={{ fontSize: "18px", color: "rgba(255,255,255,0.7)" }}>{d}</div>
						</div>
					</div>
					{verified && (
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: "8px",
								padding: "8px 16px",
								borderRadius: "9999px",
								background: "rgba(34,197,94,0.15)",
								border: "1px solid rgba(34,197,94,0.4)",
								color: "#86efac",
								fontSize: "18px",
							}}
						>
							✓ verified
						</div>
					)}
				</div>

				<div style={{ display: "flex", flexDirection: "column", marginTop: "32px", flex: 1 }}>
					<div style={{ fontSize: "16px", letterSpacing: "3px", color: theme.accent, textTransform: "uppercase", display: "flex" }}>
						{planet} · {vibe}
					</div>
					<div style={{ fontSize: "64px", fontWeight: 800, lineHeight: 1.1, marginTop: "8px", display: "flex" }}>
						{title}
					</div>
					<div style={{ fontSize: "24px", color: "rgba(255,255,255,0.75)", marginTop: "24px", lineHeight: 1.4, display: "flex", maxWidth: "1000px" }}>
						{summary.slice(0, 180)}
					</div>
				</div>

				<div
					style={{
						display: "flex",
						gap: "16px",
						marginTop: "24px",
					}}
				>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							padding: "20px 24px",
							borderRadius: "16px",
							background: "rgba(255,255,255,0.05)",
							border: "1px solid rgba(255,255,255,0.1)",
							flex: 1,
						}}
					>
						<div style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", display: "flex" }}>
							luck score
						</div>
						<div style={{ fontSize: "40px", fontWeight: 700, color: theme.accent, display: "flex", marginTop: "4px" }}>
							{luckScore}
						</div>
					</div>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							padding: "20px 24px",
							borderRadius: "16px",
							background: "rgba(255,255,255,0.05)",
							border: "1px solid rgba(255,255,255,0.1)",
							flex: 1,
						}}
					>
						<div style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", display: "flex" }}>
							signal
						</div>
						<div
							style={{
								fontSize: "40px",
								fontWeight: 700,
								display: "flex",
								marginTop: "4px",
								color: direction === "LONG" ? "#4ade80" : "#f87171",
							}}
						>
							{direction} {ticker}
						</div>
					</div>
					<div
						style={{
							display: "flex",
							flexDirection: "column",
							padding: "20px 24px",
							borderRadius: "16px",
							background: "rgba(255,255,255,0.05)",
							border: "1px solid rgba(255,255,255,0.1)",
							flex: 1,
						}}
					>
						<div style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", display: "flex" }}>
							{leverage ? "max leverage" : "power hour"}
						</div>
						<div style={{ fontSize: "40px", fontWeight: 700, color: "white", display: "flex", marginTop: "4px" }}>
							{leverage ? `${leverage}x` : powerHour || "—"}
						</div>
					</div>
				</div>
			</div>
		),
		{
			width: 1200,
			height: 630,
			headers: {
				"Cache-Control": "public, max-age=300",
			},
		},
	);
}
