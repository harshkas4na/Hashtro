"use client";

import { useLogin } from "@privy-io/react-auth";
import { useSearchParams } from "next/navigation";
import { FC, Suspense, useCallback, useEffect, useState } from "react";
import { StarBackground } from "@/components/StarBackground";
import { usePrivyWallet } from "@/app/hooks/use-privy-wallet";
import { ApiError, api } from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Normalize what the user typed into the canonical "HSTRO-XXXX-XXXX" form. */
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
	const { publicKey, connected } = usePrivyWallet();
	const { login } = useLogin();

	const [code, setCode] = useState("");
	const [agentName, setAgentName] = useState<string | null>(null);
	const [lookupError, setLookupError] = useState<string | null>(null);
	const [isLookingUp, setIsLookingUp] = useState(false);
	const [isClaiming, setIsClaiming] = useState(false);
	const [claimError, setClaimError] = useState<string | null>(null);
	const [claimed, setClaimed] = useState(false);

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

	const handleClaim = useCallback(async () => {
		if (!publicKey || !isValidCode(code)) return;
		setIsClaiming(true);
		setClaimError(null);
		try {
			await api.claimPairing(publicKey, code);
			setClaimed(true);
		} catch (err) {
			const msg = err instanceof ApiError ? err.message : "Could not approve pairing";
			setClaimError(msg);
		} finally {
			setIsClaiming(false);
		}
	}, [publicKey, code]);

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
						<a
							href="/agent"
							className="inline-block text-sm text-purple-300 hover:text-purple-100 underline"
						>
							manage paired agents →
						</a>
					</div>
				) : (
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
