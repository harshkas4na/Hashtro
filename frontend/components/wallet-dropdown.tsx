"use client";

import { useExportWallet, useFundWallet } from "@privy-io/react-auth/solana";
import { useRouter } from "next/navigation";
import { FC, useRef, useState } from "react";
import { usePrivyWallet } from "@/app/hooks/use-privy-wallet";
import { useStore } from "@/store/useStore";
import { Toast } from "./toast";

type Props = {
	variant?: "desktop" | "mobile";
};

export const WalletDropdown: FC<Props> = ({ variant = "desktop" }) => {
	const { publicKey, disconnect } = usePrivyWallet();
	const { reset } = useStore();
	const { fundWallet } = useFundWallet();
	const { exportWallet } = useExportWallet();
	const router = useRouter();
	const [toastMessage, setToastMessage] = useState<string | null>(null);

	const [showDropdown, setShowDropdown] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	const handleDisconnect = async () => {
		try {
			reset();
			await disconnect();
			setShowDropdown(false);
			router.push("/");
		} catch (error) {
			console.error("Error disconnecting:", error);
		}
	};

	const copyAddress = async () => {
		if (!publicKey) return;

		try {
			await navigator.clipboard.writeText(publicKey);
			setToastMessage("Address copied to clipboard!");
			setShowDropdown(false);
		} catch (error) {
			console.error("Failed to copy address:", error);
		}
	};

	const formatAddress = (address?: string) => {
		if (!address) return "";
		return `${address.slice(0, 4)}...${address.slice(-4)}`;
	};

	if (!publicKey) return null;

	const dropdownPosition =
		variant === "desktop"
			? "absolute top-full right-0 mt-2"
			: "absolute bottom-full left-1/2 -translate-x-1/2 mb-2";

	return (
		<>
			<div ref={dropdownRef} className="relative font-display">
				<button
					onClick={() => setShowDropdown(!showDropdown)}
					className="
          flex items-center gap-2 cursor-pointer
          bg-inherit border border-neutral-700 text-white
          px-4 py-2 rounded-xl font-medium
          hover:bg-[#262626] hover:scale-105
          hover:shadow-[0_0_20px_rgba(252,84,17,0.35)]
          transition-all duration-200
          min-w-[140px] justify-center
        "
					type="button"
				>
					<img
						alt="Solana Logo"
						className="w-4 h-5"
						src="https://solana.com/src/img/branding/solanaLogoMark.svg"
					/>

					<span>{formatAddress(publicKey)}</span>

					<svg
						className={`w-4 h-4 transition-transform duration-200 ${showDropdown ? "rotate-180" : ""
							}`}
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<title>svg</title>
						<path strokeWidth={2} d="M19 9l-7 7-7-7" />
					</svg>
				</button>

				{/* Dropdown */}
				{showDropdown && (
					<div
						className={`${dropdownPosition} w-full min-w-[200px]
            md:bg-inherit bg-[#141414] border border-neutral-700
            rounded-xl shadow-lg overflow-hidden z-50 text-xs`}
					>
						<div className="py-1">
							{/* Copy */}
							<button
								onClick={copyAddress}
								className="w-full px-4 py-3 text-left text-white hover:bg-[#262626] transition-colors duration-150 flex items-center gap-2"
								type="button"
							>
								<svg
									className="w-4 h-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<title>svg</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
									/>
								</svg>
								<span>Copy Address</span>
							</button>

							{/* Fund */}
							<button
								onClick={() =>
									fundWallet({
										address: publicKey ?? "",
										options: {
											chain: "solana:mainnet",
											amount: "0.5",
										},
									})
								}
								className="w-full px-4 py-3 text-left text-white hover:bg-[#262626] transition-colors duration-150 flex items-center gap-2"
								type="button"
							>
								<svg
									className="w-4 h-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<title>Dollar</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M12 3v18m4-14a4 4 0 00-8 0c0 2.21 1.79 3 4 3s4 .79 4 3a4 4 0 01-8 0"
									/>
								</svg>

								<span>Fund Wallet</span>
							</button>

							{/* Export */}
							<button
								onClick={() => exportWallet()}
								className="w-full px-4 py-3 text-left text-white hover:bg-[#262626] transition-colors duration-150 flex items-center gap-2"
								type="button"
							>
								<svg
									className="w-4 h-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<title>Export Wallet</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M17 8V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-1"
									/>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M21 12H10m0 0l3-3m-3 3l3 3"
									/>
								</svg>

								<span>Export Wallet Key</span>
							</button>

							{/* Agent Keys */}
							<button
								onClick={() => {
									setShowDropdown(false);
									router.push("/agent");
								}}
								className="w-full px-4 py-3 text-left text-white hover:bg-[#262626] transition-colors duration-150 flex items-center gap-2"
								type="button"
							>
								<svg
									className="w-4 h-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<title>Agent Keys</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
									/>
								</svg>
								<span>Agent Keys</span>
							</button>

							{/* Explorer */}
							<a
								href={`https://orbmarkets.io/address/${publicKey}?cluster=mainnet&hideSpam=true`}
								target="_blank"
								rel="noopener noreferrer"
								className="w-full px-4 py-3 text-left text-white hover:bg-[#262626] transition-colors duration-150 flex items-center gap-2"
							>
								<svg
									className="w-4 h-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<title>svg</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
									/>
								</svg>
								<span>View on Explorer</span>
							</a>

							{/* Disconnect */}
							<button
								onClick={handleDisconnect}
								className="w-full px-4 py-3 text-left text-red-400 hover:bg-red-500/10 transition-colors duration-150 flex items-center gap-2"
								type="button"
							>
								<svg
									className="w-4 h-4"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<title>svg</title>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
									/>
								</svg>
								<span>Logout</span>
							</button>
						</div>
					</div>
				)}
			</div>
			<Toast
				message={toastMessage}
				type={"success"}
				duration={4000}
				onClose={() => setToastMessage(null)}
			/>
		</>
	);
};
