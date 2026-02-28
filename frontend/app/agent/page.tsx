"use client";

import { useSigners } from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { FC, useCallback, useEffect, useRef, useState } from "react";
import { WalletDropdown } from "@/components/wallet-dropdown";
import { Toast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { usePrivyWallet } from "@/app/hooks/use-privy-wallet";
import { ApiKey, Webhook, WebhookEvent } from "@/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api";
const FRONTEND_URL = process.env.NEXT_PUBLIC_APP_URL || "https://hashtro.fun";

const ALL_EVENTS: { value: WebhookEvent; label: string; description: string }[] = [
	{ value: "horoscope_ready", label: "horoscope_ready", description: "Fired when your daily card is generated" },
	{ value: "trade_verified", label: "trade_verified", description: "Fired when a profitable trade verifies your horoscope" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
	if (!iso) return "Never";
	return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatRelative(iso: string | null): string {
	if (!iso) return "Never";
	const diff = Date.now() - new Date(iso).getTime();
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

function buildSystemPrompt(apiKey: string): string {
	return `You are a trading assistant connected to Hastrology, an astrological trading signal app on Solana.

API base: ${API_BASE}
Authorization: Bearer ${apiKey || "YOUR_API_KEY"}

Every morning (or when asked), call GET /api/agent/signal to get today's trading signal. The response tells you:
- should_trade: whether to trade today
- direction: LONG or SHORT
- luck_score: 0–100 (higher = stronger signal)
- leverage_suggestion: recommended leverage
- power_hour: best entry time window
- has_warning: if true, reduce position size or skip
- already_verified: today's horoscope is already confirmed profitable
- trade_url: link for the user to execute the trade

Rules:
1. If should_trade is false or already_verified is true — tell the user and do nothing.
2. If has_warning is true — mention it and suggest caution.
3. When should_trade is true — summarise the signal and send the user this link to execute: [trade_url from response]
4. After the user confirms the trade happened, call POST /api/agent/trade-attempt with: txSig, direction, leverage, asset.
5. Never sign or execute trades yourself. Always direct the user to the trade_url.`;
}

// ─── One-time key reveal modal ─────────────────────────────────────────────────

interface KeyRevealModalProps {
	rawKey: string;
	prefix: string;
	label: string;
	onClose: () => void;
}

const KeyRevealModal: FC<KeyRevealModalProps> = ({ rawKey, prefix, label, onClose }) => {
	const [copied, setCopied] = useState(false);
	const [confirmed, setConfirmed] = useState(false);

	const copyKey = async () => {
		try {
			await navigator.clipboard.writeText(rawKey);
			setCopied(true);
			setTimeout(() => setCopied(false), 2500);
		} catch { /* ignore */ }
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
			<div className="bg-[#141414] border border-neutral-700 rounded-2xl w-full max-w-lg p-6 font-display">
				<div className="flex items-start justify-between mb-4">
					<div>
						<h2 className="text-lg font-semibold text-white">API Key Generated</h2>
						<p className="text-sm text-neutral-400 mt-0.5">
							<span className="text-orange-400 font-medium">{label}</span>
							{" · "}<span className="text-neutral-500">{prefix}…</span>
						</p>
					</div>
					<button onClick={onClose} disabled={!confirmed} className="text-neutral-500 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors ml-4 mt-0.5" type="button">
						<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><title>Close</title><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
					</button>
				</div>

				<div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 mb-4">
					<svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><title>Warning</title><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
					<p className="text-xs text-amber-300 leading-relaxed">This is the only time this key will be shown. Copy it and paste it into your agent platform immediately.</p>
				</div>

				<div className="bg-[#0a0a0f] border border-neutral-700 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
					<code className="text-sm text-green-400 font-mono flex-1 break-all select-all leading-relaxed">{rawKey}</code>
					<button onClick={copyKey} className="shrink-0 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium transition-colors" type="button">
						{copied ? <span className="text-green-400">Copied!</span> : <span className="text-white">Copy</span>}
					</button>
				</div>

				<label className="flex items-center gap-3 cursor-pointer mb-5">
					<input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="w-4 h-4 rounded accent-orange-500 cursor-pointer" />
					<span className="text-sm text-neutral-300">I have copied and saved the key safely</span>
				</label>

				<button onClick={onClose} disabled={!confirmed} className="w-full py-2.5 rounded-xl font-medium text-sm transition-all bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed" type="button">
					Done
				</button>
			</div>
		</div>
	);
};

// ─── Webhook secret reveal modal ──────────────────────────────────────────────

interface SecretRevealModalProps {
	secret: string;
	webhookId: string;
	url: string;
	onClose: () => void;
}

const SecretRevealModal: FC<SecretRevealModalProps> = ({ secret, webhookId, url, onClose }) => {
	const [copied, setCopied] = useState(false);
	const [confirmed, setConfirmed] = useState(false);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
			<div className="bg-[#141414] border border-neutral-700 rounded-2xl w-full max-w-lg p-6 font-display">
				<div className="mb-4">
					<h2 className="text-lg font-semibold text-white">Webhook Registered</h2>
					<p className="text-sm text-neutral-500 font-mono mt-0.5 truncate">{url}</p>
				</div>

				<div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 mb-4">
					<svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><title>Warning</title><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
					<p className="text-xs text-amber-300 leading-relaxed">Save this signing secret now. You'll use it to verify incoming webhook payloads. It will not be shown again.</p>
				</div>

				<div className="bg-[#0a0a0f] border border-neutral-700 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
					<code className="text-sm text-green-400 font-mono flex-1 break-all select-all">{secret}</code>
					<button onClick={async () => { await navigator.clipboard.writeText(secret); setCopied(true); setTimeout(() => setCopied(false), 2500); }} className="shrink-0 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium transition-colors" type="button">
						{copied ? <span className="text-green-400">Copied!</span> : <span className="text-white">Copy</span>}
					</button>
				</div>

				<p className="text-xs text-neutral-500 mb-4">
					Webhook ID: <span className="font-mono text-neutral-400">{webhookId}</span>
				</p>

				<label className="flex items-center gap-3 cursor-pointer mb-5">
					<input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="w-4 h-4 rounded accent-orange-500 cursor-pointer" />
					<span className="text-sm text-neutral-300">I have saved the signing secret</span>
				</label>

				<button onClick={onClose} disabled={!confirmed} className="w-full py-2.5 rounded-xl font-medium text-sm transition-all bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 disabled:cursor-not-allowed" type="button">
					Done
				</button>
			</div>
		</div>
	);
};

// ─── Main page ────────────────────────────────────────────────────────────────

const AgentPage: FC = () => {
	const { publicKey, walletId } = usePrivyWallet();
	const router = useRouter();
	const { addSigners, removeSigners } = useSigners();

	// ── Delegation state ──────────────────────────────────────────────────────
	const [isDelegated, setIsDelegated] = useState(false);
	const [delegating, setDelegating] = useState(false);
	const [revoking, setRevoking] = useState(false);

	// ── API keys ──────────────────────────────────────────────────────────────
	const [keys, setKeys] = useState<ApiKey[]>([]);
	const [loadingKeys, setLoadingKeys] = useState(true);
	const [keyError, setKeyError] = useState<string | null>(null);
	const [newLabel, setNewLabel] = useState("");
	const [generating, setGenerating] = useState(false);
	const [revokingId, setRevokingId] = useState<string | null>(null);
	const [revealKey, setRevealKey] = useState<{ raw: string; prefix: string; label: string } | null>(null);

	// ── Session key (for webhook calls) ──────────────────────────────────────
	const [sessionKey, setSessionKey] = useState("");
	const [sessionKeyInput, setSessionKeyInput] = useState("");
	const [promptCopied, setPromptCopied] = useState(false);

	// ── Webhooks ──────────────────────────────────────────────────────────────
	const [webhooks, setWebhooks] = useState<Webhook[]>([]);
	const [loadingWebhooks, setLoadingWebhooks] = useState(false);
	const [webhookUrl, setWebhookUrl] = useState("");
	const [selectedEvents, setSelectedEvents] = useState<WebhookEvent[]>(["horoscope_ready", "trade_verified"]);
	const [registeringWebhook, setRegisteringWebhook] = useState(false);
	const [deletingWebhookId, setDeletingWebhookId] = useState<string | null>(null);
	const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
	const [revealSecret, setRevealSecret] = useState<{ secret: string; webhookId: string; url: string } | null>(null);

	// ── Toast ─────────────────────────────────────────────────────────────────
	const [toastMessage, setToastMessage] = useState<string | null>(null);
	const [toastType, setToastType] = useState<"success" | "error">("success");

	const hasFetchedKeys = useRef(false);
	const wasConnected = useRef(false);

	const toast = (msg: string, type: "success" | "error" = "success") => {
		setToastMessage(msg);
		setToastType(type);
	};

	// ── Redirect on disconnect ────────────────────────────────────────────────
	useEffect(() => {
		if (wasConnected.current && !publicKey) router.push("/");
		wasConnected.current = !!publicKey;
	}, [publicKey, router]);

	// ── Load delegation status from profile ────────────────────────────────────
	useEffect(() => {
		if (!publicKey) return;
		api.getUserProfile(publicKey).then((res) => {
			if (res?.user) {
				// @ts-expect-error tradingDelegated is returned by backend but not yet in the User type
				setIsDelegated(res.user.tradingDelegated ?? false);
			}
		}).catch(() => { });
	}, [publicKey]);

	// ── Enable autonomous trading ─────────────────────────────────────────────
	const handleEnableDelegation = async () => {
		if (!publicKey || !walletId) {
			toast("Wallet not ready. Please reconnect.", "error");
			return;
		}
		setDelegating(true);
		try {
			await addSigners({ address: publicKey, signers: [{ signerId: "fozkxqh0gshzezpwf0wilmbf", policyIds: [] }] });
			await api.setTradingDelegated(publicKey, true);
			setIsDelegated(true);
			toast("Autonomous trading enabled");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Failed to enable delegation", "error");
		} finally {
			setDelegating(false);
		}
	};

	// ── Disable autonomous trading ────────────────────────────────────────────
	const handleRevokeDelegation = async () => {
		if (!publicKey) return;
		setRevoking(true);
		try {
			await removeSigners({ address: publicKey });
			await api.setTradingDelegated(publicKey, false);
			setIsDelegated(false);
			toast("Autonomous trading disabled");
		} catch (err) {
			toast(err instanceof Error ? err.message : "Failed to revoke delegation", "error");
		} finally {
			setRevoking(false);
		}
	};

	// ── Load keys ─────────────────────────────────────────────────────────────
	const fetchKeys = useCallback(async () => {
		if (!publicKey) return;
		setLoadingKeys(true);
		try {
			const { keys: fetched } = await api.listAgentKeys(publicKey);
			setKeys(fetched);
		} catch (err) {
			setKeyError(err instanceof ApiError ? err.message : "Failed to load keys");
		} finally {
			setLoadingKeys(false);
		}
	}, [publicKey]);

	useEffect(() => {
		if (publicKey && !hasFetchedKeys.current) {
			hasFetchedKeys.current = true;
			fetchKeys();
		}
	}, [publicKey, fetchKeys]);

	// ── Load webhooks (when session key is set) ───────────────────────────────
	const fetchWebhooks = useCallback(async (key: string) => {
		setLoadingWebhooks(true);
		try {
			const { webhooks: fetched } = await api.listWebhooks(key);
			setWebhooks(fetched);
		} catch (err) {
			console.error(err instanceof ApiError ? err.message : "Failed to load webhooks", "error");
		} finally {
			setLoadingWebhooks(false);
		}
	}, []);

	// ── Generate key ──────────────────────────────────────────────────────────
	const handleGenerate = async () => {
		if (!publicKey) return;
		const label = newLabel.trim() || "My Agent";
		setGenerating(true);
		try {
			const res = await api.generateAgentKey(publicKey, label);
			setRevealKey({ raw: res.key, prefix: res.keyPrefix, label });
			setNewLabel("");
			await fetchKeys();
		} catch (err) {
			toast(err instanceof ApiError ? err.message : "Failed to generate key", "error");
		} finally {
			setGenerating(false);
		}
	};

	// ── Revoke key ────────────────────────────────────────────────────────────
	const handleRevoke = async (keyId: string) => {
		if (!publicKey) return;
		setRevokingId(keyId);
		try {
			await api.revokeAgentKey(keyId, publicKey);
			toast("Key revoked");
			await fetchKeys();
		} catch (err) {
			toast(err instanceof ApiError ? err.message : "Failed to revoke key", "error");
		} finally {
			setRevokingId(null);
		}
	};

	// ── Session key unlock ────────────────────────────────────────────────────
	const handleUnlock = async () => {
		const key = sessionKeyInput.trim();
		if (!key.startsWith("hstro_sk_")) {
			toast("Key must start with hstro_sk_", "error");
			return;
		}
		setSessionKey(key);
		await fetchWebhooks(key);
	};

	// ── Register webhook ──────────────────────────────────────────────────────
	const handleRegisterWebhook = async () => {
		if (!sessionKey || !webhookUrl.trim()) return;
		setRegisteringWebhook(true);
		try {
			const res = await api.registerWebhook(sessionKey, webhookUrl.trim(), selectedEvents);
			setRevealSecret({ secret: res.secret, webhookId: res.webhook_id, url: webhookUrl.trim() });
			setWebhookUrl("");
			await fetchWebhooks(sessionKey);
		} catch (err) {
			toast(err instanceof ApiError ? err.message : "Failed to register webhook", "error");
		} finally {
			setRegisteringWebhook(false);
		}
	};

	// ── Delete webhook ────────────────────────────────────────────────────────
	const handleDeleteWebhook = async (webhookId: string) => {
		if (!sessionKey) return;
		setDeletingWebhookId(webhookId);
		try {
			await api.deleteWebhook(sessionKey, webhookId);
			toast("Webhook deleted");
			await fetchWebhooks(sessionKey);
		} catch (err) {
			toast(err instanceof ApiError ? err.message : "Failed to delete webhook", "error");
		} finally {
			setDeletingWebhookId(null);
		}
	};

	// ── Test webhook ──────────────────────────────────────────────────────────
	const handleTestWebhook = async (webhookId: string) => {
		if (!sessionKey) return;
		setTestingWebhookId(webhookId);
		try {
			const res = await api.testWebhook(sessionKey, webhookId);
			toast(`Test ping delivered (HTTP ${res.http_status})`);
		} catch (err) {
			toast(err instanceof ApiError ? err.message : "Test delivery failed", "error");
		} finally {
			setTestingWebhookId(null);
		}
	};

	const activeKeys = keys.filter((k) => !k.revoked);
	const revokedKeys = keys.filter((k) => k.revoked);
	const activeWebhooks = webhooks.filter((w) => w.active);

	if (!publicKey) return null;

	return (
		<div className="min-h-screen bg-[#0a0a0f] text-white font-display">
			{/* Nav */}
			<nav className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
				<button onClick={() => router.push("/cards")} className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors text-sm" type="button">
					<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><title>Back</title><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
					Back
				</button>
				<WalletDropdown />
			</nav>

			<main className="max-w-2xl mx-auto px-6 py-10 space-y-10">

				{/* ── Title ─────────────────────────────────────────────────────── */}
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">AI Agent</h1>
					<p className="text-sm text-neutral-400 mt-1">
						Connect any AI agent to read your signal and recommend trades on your behalf.
					</p>
				</div>

				{/* ── Section 0: Autonomous Trading ─────────────────────────────── */}
				<section>
					<h2 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">Autonomous Trading</h2>
					<div className="bg-[#141414] border border-neutral-700 rounded-2xl p-5">
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0">
								<div className="flex items-center gap-2 mb-1">
									<div className={`w-2 h-2 rounded-full shrink-0 ${isDelegated ? "bg-green-500" : "bg-neutral-600"}`} />
									<p className="text-sm font-medium text-white">
										{isDelegated ? "Enabled" : "Not enabled"}
									</p>
								</div>
								<p className="text-xs text-neutral-500 leading-relaxed">
									{isDelegated
										? "The agent can execute Flash Protocol trades on your behalf using your embedded wallet. You can revoke access at any time."
										: "Grant the agent one-time permission to sign trades server-side. Your private key never leaves Privy's secure enclave."}
								</p>
							</div>
							<div className="shrink-0">
								{isDelegated ? (
									<button
										onClick={handleRevokeDelegation}
										disabled={revoking}
										className="px-4 py-2 rounded-xl text-sm font-medium text-red-400 border border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
										type="button"
									>
										{revoking ? "Revoking…" : "Revoke"}
									</button>
								) : (
									<button
										onClick={handleEnableDelegation}
										disabled={delegating}
										className="px-4 py-2 rounded-xl text-sm font-medium bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
										type="button"
									>
										{delegating ? "Enabling…" : "Enable"}
									</button>
								)}
							</div>
						</div>
						{isDelegated && (
							<div className="mt-4 flex items-start gap-2 bg-green-500/5 border border-green-500/20 rounded-xl px-4 py-3">
								<svg className="w-4 h-4 text-green-400 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><title>Info</title><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
								<p className="text-xs text-green-300 leading-relaxed">
									Your agent can now call <code className="bg-green-900/30 px-1 rounded">POST /api/agent/execute-trade</code> with an <code className="bg-green-900/30 px-1 rounded">amount</code> (USDC). Direction, ticker, and leverage come from today's signal automatically.
								</p>
							</div>
						)}
					</div>
				</section>

				{/* ── Section 1: Connect your AI agent ──────────────────────────── */}
				<section>
					<h2 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">Connect your AI agent</h2>
					<div className="bg-[#141414] border border-neutral-700 rounded-2xl divide-y divide-neutral-800">

						{/* OpenAPI spec URL */}
						<div className="px-5 py-4">
							<p className="text-sm font-medium text-white mb-1">OpenAPI spec</p>
							<p className="text-xs text-neutral-500 mb-3">
								Point your agent platform (OpenClaw, n8n, etc.) at this URL to auto-discover all available endpoints.
							</p>
							<div className="flex items-center gap-2 bg-[#0a0a0f] border border-neutral-700 rounded-xl px-4 py-2.5">
								<code className="text-sm text-orange-400 font-mono flex-1 truncate">{API_BASE.replace("/api", "")}/api/openapi.json</code>
								<button
									onClick={async () => {
										await navigator.clipboard.writeText(`${API_BASE.replace("/api", "")}/api/openapi.json`);
										toast("Copied!");
									}}
									className="shrink-0 text-xs text-neutral-400 hover:text-white transition-colors"
									type="button"
								>
									Copy
								</button>
							</div>
						</div>

						{/* System prompt */}
						<div className="px-5 py-4">
							<p className="text-sm font-medium text-white mb-1">System prompt template</p>
							<p className="text-xs text-neutral-500 mb-3">
								Paste this into your agent's system instructions. Replace <code className="bg-neutral-800 px-1 rounded">YOUR_API_KEY</code> with an actual key from below.
							</p>
							<div className="relative bg-[#0a0a0f] border border-neutral-700 rounded-xl p-4">
								<pre className="text-xs text-neutral-300 font-mono whitespace-pre-wrap leading-relaxed overflow-auto max-h-48">
									{buildSystemPrompt("")}
								</pre>
								<button
									onClick={async () => {
										await navigator.clipboard.writeText(buildSystemPrompt("YOUR_API_KEY"));
										setPromptCopied(true);
										setTimeout(() => setPromptCopied(false), 2500);
									}}
									className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium transition-colors"
									type="button"
								>
									{promptCopied ? <span className="text-green-400">Copied!</span> : <span className="text-neutral-300">Copy</span>}
								</button>
							</div>
						</div>

					</div>
				</section>

				{/* ── Section 2: API Keys ────────────────────────────────────────── */}
				<section>
					<h2 className="text-xs font-medium text-neutral-500 uppercase tracking-wider mb-3">API Keys</h2>

					{/* Generate */}
					<div className="bg-[#141414] border border-neutral-700 rounded-2xl p-5 mb-3">
						<p className="text-sm font-medium text-neutral-300 mb-3">Generate new key</p>
						<div className="flex gap-3">
							<input
								type="text"
								value={newLabel}
								onChange={(e) => setNewLabel(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && !generating && handleGenerate()}
								placeholder="Label (e.g. OpenClaw, MyBot)"
								maxLength={50}
								className="flex-1 bg-[#0a0a0f] border border-neutral-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500/60 transition-colors"
							/>
							<button onClick={handleGenerate} disabled={generating} className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0" type="button">
								{generating ? "Generating…" : "Generate"}
							</button>
						</div>
						<p className="text-xs text-neutral-500 mt-2">The raw key is shown exactly once — paste it into your agent immediately.</p>
					</div>

					{/* Active keys list */}
					{loadingKeys ? (
						<div className="text-center py-8 text-neutral-500 text-sm">Loading…</div>
					) : keyError ? (
						<div className="text-center py-8 text-red-400 text-sm">{keyError}</div>
					) : activeKeys.length === 0 ? (
						<div className="bg-[#141414] border border-neutral-800 rounded-2xl px-5 py-8 text-center">
							<p className="text-neutral-500 text-sm">No active keys. Generate one above.</p>
						</div>
					) : (
						<div className="space-y-2">
							{activeKeys.map((key) => (
								<div key={key.id} className="bg-[#141414] border border-neutral-700 rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
									<div className="min-w-0">
										<div className="flex items-center gap-2 mb-0.5">
											<span className="text-sm font-medium text-white truncate">{key.label}</span>
											<span className="text-xs text-neutral-500 font-mono bg-neutral-800 px-2 py-0.5 rounded-md shrink-0">{key.key_prefix}…</span>
										</div>
										<div className="flex items-center gap-3 text-xs text-neutral-500">
											<span>Created {formatDate(key.created_at)}</span>
											{key.last_used_at && <><span>·</span><span>Last used {formatRelative(key.last_used_at)}</span></>}
										</div>
									</div>
									<button onClick={() => handleRevoke(key.id)} disabled={revokingId === key.id} className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 border border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors" type="button">
										{revokingId === key.id ? "Revoking…" : "Revoke"}
									</button>
								</div>
							))}
						</div>
					)}

					{/* Revoked */}
					{revokedKeys.length > 0 && (
						<div className="mt-4 space-y-2">
							{revokedKeys.map((key) => (
								<div key={key.id} className="border border-neutral-800 rounded-xl px-5 py-3 flex items-center justify-between opacity-40">
									<div className="flex items-center gap-2">
										<span className="text-sm text-neutral-400 line-through">{key.label}</span>
										<span className="text-xs text-neutral-600 font-mono">{key.key_prefix}…</span>
									</div>
									<span className="text-xs text-neutral-600">Revoked</span>
								</div>
							))}
						</div>
					)}
				</section>

				{/* ── Section 3: Webhooks ────────────────────────────────────────── */}
				<section>
					<div className="flex items-baseline gap-3 mb-3">
						<h2 className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Webhooks</h2>
						<span className="text-xs text-neutral-600">Optional — agents can poll /signal instead</span>
					</div>
					<div className="bg-[#141414] border border-neutral-700 rounded-2xl divide-y divide-neutral-800">

						{/* Session key unlock */}
						{!sessionKey ? (
							<div className="px-5 py-4">
								<p className="text-sm font-medium text-white mb-1">Unlock webhook management</p>
								<p className="text-xs text-neutral-500 mb-3">
									Paste one of your API keys to manage webhooks. We never store it — it's only used for this session.
								</p>
								<div className="flex gap-3">
									<input
										type="text"
										value={sessionKeyInput}
										onChange={(e) => setSessionKeyInput(e.target.value)}
										onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
										placeholder="hstro_sk_…"
										className="flex-1 bg-[#0a0a0f] border border-neutral-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-500 font-mono focus:outline-none focus:border-orange-500/60 transition-colors"
									/>
									<button onClick={handleUnlock} className="px-5 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white text-sm font-medium transition-colors shrink-0" type="button">
										Unlock
									</button>
								</div>
							</div>
						) : (
							<>
								{/* Unlocked badge */}
								<div className="px-5 py-3 flex items-center justify-between">
									<div className="flex items-center gap-2">
										<div className="w-2 h-2 rounded-full bg-green-500" />
										<span className="text-xs text-neutral-400">Using key <code className="text-neutral-300">{sessionKey.slice(0, 13)}…</code></span>
									</div>
									<button onClick={() => { setSessionKey(""); setSessionKeyInput(""); setWebhooks([]); }} className="text-xs text-neutral-500 hover:text-white transition-colors" type="button">Lock</button>
								</div>

								{/* Register form */}
								<div className="px-5 py-4">
									<p className="text-sm font-medium text-white mb-1">Register webhook</p>
									<p className="text-xs text-neutral-500 mb-3">
										Hastrology POSTs to this URL when an event fires — no polling needed.{" "}
										<span className="text-neutral-400">
											To test, get a free URL from{" "}
											<a
												href="https://webhook.site"
												target="_blank"
												rel="noopener noreferrer"
												className="text-orange-400 hover:text-orange-300 underline underline-offset-2"
											>
												webhook.site
											</a>
											, paste it here, then click Test — you&apos;ll see the live ping instantly.
											In production, use your agent server&apos;s URL.
										</span>
									</p>
									<input
										type="url"
										value={webhookUrl}
										onChange={(e) => setWebhookUrl(e.target.value)}
										placeholder="https://your-agent.com/hooks/hastrology"
										className="w-full bg-[#0a0a0f] border border-neutral-700 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-orange-500/60 transition-colors mb-3"
									/>
									<div className="flex flex-wrap gap-3 mb-4">
										{ALL_EVENTS.map((ev) => (
											<label key={ev.value} className="flex items-center gap-2 cursor-pointer">
												<input
													type="checkbox"
													checked={selectedEvents.includes(ev.value)}
													onChange={(e) => setSelectedEvents(e.target.checked ? [...selectedEvents, ev.value] : selectedEvents.filter((x) => x !== ev.value))}
													className="w-4 h-4 rounded accent-orange-500"
												/>
												<div>
													<span className="text-xs font-mono text-neutral-300">{ev.label}</span>
													<p className="text-xs text-neutral-500">{ev.description}</p>
												</div>
											</label>
										))}
									</div>
									<button
										onClick={handleRegisterWebhook}
										disabled={registeringWebhook || !webhookUrl.trim() || selectedEvents.length === 0}
										className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
										type="button"
									>
										{registeringWebhook ? "Registering…" : "Register"}
									</button>
								</div>

								{/* Webhook list */}
								<div className="px-5 py-4">
									{loadingWebhooks ? (
										<p className="text-sm text-neutral-500">Loading…</p>
									) : activeWebhooks.length === 0 ? (
										<p className="text-sm text-neutral-600">No webhooks registered yet.</p>
									) : (
										<div className="space-y-3">
											{activeWebhooks.map((wh) => (
												<div key={wh.id} className="bg-[#0a0a0f] border border-neutral-800 rounded-xl px-4 py-3">
													<div className="flex items-start justify-between gap-3 mb-2">
														<code className="text-xs text-neutral-300 font-mono break-all">{wh.url}</code>
														<div className="flex gap-2 shrink-0">
															<button
																onClick={() => handleTestWebhook(wh.id)}
																disabled={testingWebhookId === wh.id}
																className="px-2.5 py-1 rounded-lg text-xs font-medium text-blue-400 border border-blue-400/30 hover:bg-blue-400/10 disabled:opacity-50 transition-colors"
																type="button"
															>
																{testingWebhookId === wh.id ? "Sending…" : "Test"}
															</button>
															<button
																onClick={() => handleDeleteWebhook(wh.id)}
																disabled={deletingWebhookId === wh.id}
																className="px-2.5 py-1 rounded-lg text-xs font-medium text-red-400 border border-red-400/30 hover:bg-red-400/10 disabled:opacity-50 transition-colors"
																type="button"
															>
																{deletingWebhookId === wh.id ? "…" : "Delete"}
															</button>
														</div>
													</div>
													<div className="flex flex-wrap gap-1.5">
														{wh.events.map((ev) => (
															<span key={ev} className="text-xs font-mono bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded-md">{ev}</span>
														))}
													</div>
												</div>
											))}
										</div>
									)}
								</div>
							</>
						)}
					</div>
				</section>

			</main>

			{/* Modals */}
			{revealKey && <KeyRevealModal rawKey={revealKey.raw} prefix={revealKey.prefix} label={revealKey.label} onClose={() => setRevealKey(null)} />}
			{revealSecret && <SecretRevealModal secret={revealSecret.secret} webhookId={revealSecret.webhookId} url={revealSecret.url} onClose={() => setRevealSecret(null)} />}

			<Toast message={toastMessage} type={toastType} duration={4000} onClose={() => setToastMessage(null)} />
		</div>
	);
};

export default AgentPage;
