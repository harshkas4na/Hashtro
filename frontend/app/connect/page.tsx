"use client";

import { useLogin } from "@privy-io/react-auth";
import { useSearchParams } from "next/navigation";
import { FC, Suspense, useCallback, useEffect, useState } from "react";
import { StarBackground } from "@/components/StarBackground";
import { usePrivyWallet } from "@/app/hooks/use-privy-wallet";
import { PlaceAutocomplete } from "@/components/place-autocomplete";
import { geocodePlace, getTimezoneOffset } from "@/lib/geocoding";
import { ApiError, api } from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeCode(raw: string): string {
	const cleaned = raw.toUpperCase().trim().replace(/\s+/g, "");
	if (!cleaned.startsWith("HSTRO")) return cleaned;
	const rest = cleaned.slice(5).replace(/-/g, "");
	if (rest.length !== 8) return cleaned;
	return `HSTRO-${rest.slice(0, 4)}-${rest.slice(4, 8)}`;
}

function isValidCode(code: string): boolean {
	return /^HSTRO-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const ConnectPageInner: FC = () => {
	const searchParams = useSearchParams();
	const { publicKey, connected, userId, walletId } = usePrivyWallet();
	const { login } = useLogin();

	const [code, setCode] = useState("");
	const [agentName, setAgentName] = useState<string | null>(null);
	const [lookupError, setLookupError] = useState<string | null>(null);
	const [isLookingUp, setIsLookingUp] = useState(false);
	const [isClaiming, setIsClaiming] = useState(false);
	const [claimError, setClaimError] = useState<string | null>(null);
	const [claimed, setClaimed] = useState(false);

	// ── Registration (for new users) ─────────────────────────────────────────
	const [needsRegistration, setNeedsRegistration] = useState(false);
	const [dob, setDob] = useState("");
	const [birthTime, setBirthTime] = useState("");
	const [birthPlace, setBirthPlace] = useState("");
	const [isRegistering, setIsRegistering] = useState(false);
	const [registerError, setRegisterError] = useState<string | null>(null);

	// Prefill from ?code= in the URL
	useEffect(() => {
		const fromUrl = searchParams.get("code");
		if (fromUrl) setCode(normalizeCode(fromUrl));
	}, [searchParams]);

	// Auto-lookup whenever the code becomes valid
	useEffect(() => {
		if (!isValidCode(code)) {
			setAgentName(null);
			setLookupError(null);
			return;
		}
		let cancelled = false;
		setIsLookingUp(true);
		setLookupError(null);
		api
			.lookupPairing(code)
			.then((meta) => {
				if (cancelled) return;
				if (meta.status === "pending") {
					setAgentName(meta.agentName);
				} else if (meta.status === "approved") {
					setAgentName(meta.agentName);
					setLookupError("This code has already been approved and is waiting for the agent to pick up the key.");
				} else if (meta.status === "consumed") {
					setAgentName(meta.agentName);
					setLookupError("This code was already used. Ask your agent to start a new pairing.");
				} else {
					setAgentName(meta.agentName);
					setLookupError("This code has expired. Ask your agent to start a new pairing.");
				}
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				const msg = err instanceof ApiError ? err.message : "Could not find that code";
				setLookupError(msg);
				setAgentName(null);
			})
			.finally(() => {
				if (!cancelled) setIsLookingUp(false);
			});
		return () => {
			cancelled = true;
		};
	}, [code]);

	// Claim pairing — detects "not registered" and switches to registration mode
	const handleClaim = useCallback(async () => {
		if (!publicKey || !isValidCode(code)) return;
		setIsClaiming(true);
		setClaimError(null);
		try {
			await api.claimPairing(publicKey, code);
			setClaimed(true);
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : "Could not approve pairing";
			if (msg.toLowerCase().includes("not registered") || msg.toLowerCase().includes("sign up")) {
				setNeedsRegistration(true);
				setClaimError(null);
			} else {
				setClaimError(msg);
			}
		} finally {
			setIsClaiming(false);
		}
	}, [publicKey, code]);

	// Register new user, then auto-retry claim
	const handleRegister = useCallback(async () => {
		if (!publicKey || !dob) return;
		setIsRegistering(true);
		setRegisterError(null);
		try {
			let latitude: number | undefined;
			let longitude: number | undefined;
			let timezoneOffset: number | undefined;

			if (birthPlace.trim()) {
				const geo = await geocodePlace(birthPlace.trim());
				if (geo.success) {
					latitude = geo.latitude;
					longitude = geo.longitude;
					timezoneOffset = getTimezoneOffset(birthPlace, geo.longitude);
				}
			}

			await api.registerUser({
				walletAddress: publicKey,
				username: publicKey.slice(0, 8),
				dob,
				birthTime: birthTime || undefined,
				birthPlace: birthPlace.trim() || undefined,
				latitude,
				longitude,
				timezoneOffset,
				privyUserId: userId,
				privyWalletId: walletId,
			});

			// Registration succeeded — now claim the pairing automatically
			setNeedsRegistration(false);
			try {
				await api.claimPairing(publicKey, code);
				setClaimed(true);
			} catch (err) {
				const msg = err instanceof ApiError ? err.message : "Could not approve pairing";
				setClaimError(msg);
			}
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : "Registration failed";
			// If wallet already exists, skip registration and try claim directly
			const isDuplicate = msg.toLowerCase().includes("already") ||
				msg.toLowerCase().includes("duplicate") ||
				msg.toLowerCase().includes("unique") ||
				msg.toLowerCase().includes("exists");
			if (isDuplicate) {
				setNeedsRegistration(false);
				try {
					await api.claimPairing(publicKey, code);
					setClaimed(true);
				} catch (claimErr) {
					const claimMsg = claimErr instanceof ApiError ? claimErr.message : "Could not approve pairing";
					setClaimError(claimMsg);
				}
			} else {
				setRegisterError(msg);
			}
		} finally {
			setIsRegistering(false);
		}
	}, [publicKey, dob, birthTime, birthPlace, userId, walletId, code]);

	// ─── Rendering ──────────────────────────────────────────────────────────────

	const canClaim =
		connected && publicKey && agentName && !lookupError && !isLookingUp && isValidCode(code);

	return (
		<div className="relative min-h-screen flex items-center justify-center px-4 py-12 text-white">
			<StarBackground />

			<div className="relative z-10 w-full max-w-md">
				<div className="mb-8 text-center">
					<div className="inline-block text-5xl mb-4">🔮</div>
					<h1 className="text-3xl font-bold tracking-tight">connect your agent</h1>
					<p className="mt-2 text-sm text-white/70">
						your AI agent asked to pair with hashtro. paste the code it gave you below.
					</p>
				</div>

				{claimed ? (
					<div className="rounded-2xl border border-green-400/30 bg-green-500/10 p-6 backdrop-blur">
						<div className="text-3xl mb-3">✅</div>
						<h2 className="text-xl font-semibold mb-1">
							{agentName || "Your agent"} is paired
						</h2>
						<p className="text-sm text-white/80 mb-4">
							you can close this tab. your agent will pick up its key on its next check.
						</p>
						<div className="flex items-center gap-4">
							<a
								href="/agent"
								className="text-sm text-purple-300 hover:text-purple-100 underline"
							>
								manage paired agents →
							</a>
							<button
								type="button"
								onClick={() => {
									setClaimed(false);
									setCode("");
									setAgentName(null);
									setClaimError(null);
									setLookupError(null);
									setNeedsRegistration(false);
									setRegisterError(null);
								}}
								className="text-sm text-white/50 hover:text-white/70 underline"
							>
								pair another agent
							</button>
						</div>
					</div>
				) : needsRegistration ? (
					/* ── Birth details form for new users ─────────────────────────── */
					<div className="rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur space-y-5">
						<div>
							<h2 className="text-lg font-semibold text-white">one more step</h2>
							<p className="mt-1 text-sm text-white/60">
								we need your birth details to generate personalized astrological signals.
							</p>
						</div>

						<div>
							<label htmlFor="dob" className="block text-xs uppercase tracking-wider text-white/60 mb-2">
								date of birth
							</label>
							<input
								id="dob"
								type="date"
								value={dob}
								onChange={(e) => setDob(e.target.value)}
								className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-white focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-400/30 [color-scheme:dark]"
							/>
						</div>

						<div>
							<label htmlFor="birth-time" className="block text-xs uppercase tracking-wider text-white/60 mb-2">
								birth time <span className="text-white/30">(optional)</span>
							</label>
							<input
								id="birth-time"
								type="time"
								value={birthTime}
								onChange={(e) => setBirthTime(e.target.value)}
								className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-white focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-400/30 [color-scheme:dark]"
							/>
						</div>

						<div>
							<label className="block text-xs uppercase tracking-wider text-white/60 mb-2">
								birth place <span className="text-white/30">(optional)</span>
							</label>
							<PlaceAutocomplete
								value={birthPlace}
								onChange={setBirthPlace}
								disabled={isRegistering}
								className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-white placeholder-white/30 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-400/30"
								dropdownClassName="absolute z-50 w-full bottom-full mb-2 bg-black/80 border border-white/15 rounded-lg shadow-lg max-h-60 overflow-y-auto backdrop-blur"
							/>
						</div>

						{registerError && (
							<p className="text-xs text-red-300">{registerError}</p>
						)}

						<button
							type="button"
							onClick={handleRegister}
							disabled={!dob || isRegistering}
							className="w-full rounded-lg bg-purple-500 px-4 py-3 font-semibold text-white transition hover:bg-purple-400 disabled:cursor-not-allowed disabled:opacity-40"
						>
							{isRegistering ? "setting up…" : `sign up & approve ${agentName || "agent"}`}
						</button>

						<button
							type="button"
							onClick={() => { setNeedsRegistration(false); setClaimError(null); }}
							className="w-full text-xs text-white/40 hover:text-white/60 transition-colors"
						>
							go back
						</button>
					</div>
				) : (
					/* ── Normal pairing flow ──────────────────────────────────────── */
					<div className="rounded-2xl border border-white/10 bg-black/40 p-6 backdrop-blur space-y-5">
						<div>
							<label
								htmlFor="pair-code"
								className="block text-xs uppercase tracking-wider text-white/60 mb-2"
							>
								pairing code
							</label>
							<input
								id="pair-code"
								type="text"
								value={code}
								onChange={(e) => setCode(normalizeCode(e.target.value))}
								placeholder="HSTRO-XXXX-XXXX"
								autoComplete="off"
								spellCheck={false}
								className="w-full rounded-lg border border-white/15 bg-white/5 px-4 py-3 font-mono text-lg uppercase tracking-wider text-white placeholder-white/30 focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-400/30"
							/>
							<p className="mt-1.5 text-xs text-white/40">
								codes expire after 15 minutes and can only be used once.
							</p>
							{isLookingUp && (
								<p className="mt-2 text-xs text-white/50">checking code…</p>
							)}
							{lookupError && (
								<p className="mt-2 text-xs text-red-300">{lookupError}</p>
							)}
						</div>

						{agentName && !lookupError && (
							<div className="rounded-lg border border-purple-400/30 bg-purple-500/10 p-4">
								<p className="text-xs uppercase tracking-wider text-purple-200/70 mb-1">
									agent
								</p>
								<p className="text-lg font-semibold text-white">{agentName}</p>
								<p className="mt-2 text-xs text-white/60">
									wants to read your daily card and (if enabled) execute trades on your behalf.
								</p>
							</div>
						)}

						{!connected ? (
							<button
								type="button"
								onClick={() => login()}
								className="w-full rounded-lg bg-purple-500 px-4 py-3 font-semibold text-white transition hover:bg-purple-400"
							>
								connect wallet to continue
							</button>
						) : (
							<>
								<div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/60">
									wallet: <span className="font-mono text-white/80">{publicKey?.slice(0, 4)}…{publicKey?.slice(-4)}</span>
								</div>
								<button
									type="button"
									onClick={handleClaim}
									disabled={!canClaim || isClaiming}
									className="w-full rounded-lg bg-purple-500 px-4 py-3 font-semibold text-white transition hover:bg-purple-400 disabled:cursor-not-allowed disabled:opacity-40"
								>
									{isClaiming ? "approving…" : `approve ${agentName || "agent"}`}
								</button>
								{claimError && (
									<p className="text-xs text-red-300">{claimError}</p>
								)}
							</>
						)}

						<p className="text-xs text-white/40 text-center pt-2 border-t border-white/5">
							hashtro will never show your code to anyone. paste only codes you trust.
						</p>
					</div>
				)}
			</div>
		</div>
	);
};

const ConnectPage: FC = () => (
	<Suspense fallback={<div className="min-h-screen bg-black" />}>
		<ConnectPageInner />
	</Suspense>
);

export default ConnectPage;
