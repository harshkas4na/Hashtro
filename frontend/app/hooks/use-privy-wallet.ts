import { SendTransactionModalUIOptions, usePrivy } from "@privy-io/react-auth";
import {
	useSignAndSendTransaction,
	useSignMessage,
	useSignTransaction,
	useWallets,
} from "@privy-io/react-auth/solana";
import { Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { useCallback, useMemo } from "react";

export function usePrivyWallet(isTestnet = false) {
	const { user, authenticated, ready, logout: privyLogout } = usePrivy();
	const { wallets, ready: walletsReady } = useWallets();
	const { signMessage: signPrivyMessage } = useSignMessage();
	const { signTransaction: signPrivyTransaction } = useSignTransaction();
	const { signAndSendTransaction } = useSignAndSendTransaction();

	const wallet = useMemo(() => {
		if (!authenticated || !walletsReady || !wallets.length) return undefined;

		const hasEmbeddedAccount = user?.linkedAccounts?.some(
			(a: { type?: string; walletClientType?: string }) =>
				a.type === "wallet" && a.walletClientType === "privy",
		);

		if (hasEmbeddedAccount) {
			return wallets[0];
		}

		return wallets[0];
	}, [authenticated, wallets, walletsReady, user?.linkedAccounts]);

	const publicKey = useMemo(
		() => (wallet?.address ? wallet.address : undefined),
		[wallet],
	);

	const isConnected = Boolean(authenticated && wallet && publicKey);
	const isLoadingWallet = authenticated && walletsReady && !wallet;

	const chain = isTestnet ? "solana:devnet" : "solana:mainnet";

	const signMessage = useCallback(
		async (message: string | Uint8Array): Promise<Uint8Array> => {
			if (!wallet) throw new Error("No wallet connected");

			const messageBytes =
				typeof message === "string"
					? new TextEncoder().encode(message)
					: message;

			const signatureUint8Array = (
				await signPrivyMessage({
					message: messageBytes,
					wallet: wallet,
					options: {
						uiOptions: {
							title: "Sign this message",
						},
					},
				})
			).signature;

			return signatureUint8Array;
		},
		[wallet, signPrivyMessage],
	);

	const signTransaction = useCallback(
		async (
			transaction: Transaction | VersionedTransaction,
			options?: { uiOptions?: SendTransactionModalUIOptions },
		): Promise<Transaction | VersionedTransaction> => {
			if (!wallet) throw new Error("No wallet connected");

			const transactionBytes = transaction.serialize({
				requireAllSignatures: false,
				verifySignatures: false,
			});

			const { signedTransaction } = await signPrivyTransaction({
				transaction: transactionBytes,
				wallet: wallet,
				chain,
				options: options || {
					uiOptions: {
						description: "Sign this transaction",
					},
				},
			});

			try {
				return VersionedTransaction.deserialize(signedTransaction);
			} catch (e) {
				try {
					return Transaction.from(signedTransaction);
				} catch (e2) {
					console.error("Failed to deserialize transaction:", e, e2);
					throw new Error("Failed to deserialize signed transaction");
				}
			}
		},
		[wallet, signPrivyTransaction, chain],
	);

	const signAllTransactions = useCallback(
		async (
			transactions: (Transaction | VersionedTransaction)[],
		): Promise<(Transaction | VersionedTransaction)[]> => {
			if (!wallet) throw new Error("No wallet connected");

			const signedTransactions: (Transaction | VersionedTransaction)[] = [];

			for (const transaction of transactions) {
				const signedTx = await signTransaction(transaction);
				signedTransactions.push(signedTx);
			}

			return signedTransactions;
		},
		[wallet, signTransaction],
	);

	const sendTransaction = useCallback(
		async (
			transaction: Uint8Array,
			options?: { uiOptions?: SendTransactionModalUIOptions },
		): Promise<string> => {
			if (!wallet) throw new Error("No wallet connected");

			try {
				const result = await signAndSendTransaction({
					transaction: transaction,
					wallet: wallet,
					chain,
					options: options || {
						uiOptions: {
							description: "Sign this transaction",
						},
					},
				});

				const signatureBytes = result.signature;
				const signature = bs58.encode(signatureBytes);

				return signature;
			} catch (error) {
				console.error("Failed to send transaction:", error);
				throw error;
			}
		},
		[wallet, signAndSendTransaction, chain],
	);

	// Privy internal IDs — needed to link the wallet for server-side delegated actions.
	// userId   = Privy user DID  (did:privy:...)  → stored in users.privy_user_id
	// walletId = Privy wallet UUID                → stored in users.privy_wallet_id
	//
	// walletId comes from the linked accounts array because ConnectedStandardSolanaWallet
	// doesn't expose .id in its public TS types (the field exists at runtime).
	const userId = user?.id ?? undefined;
	const walletId = useMemo(() => {
		if (!user || !wallet) return undefined;
		const linked = user.linkedAccounts?.find(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(a: any) =>
				a.type === "wallet" &&
				a.walletClientType === "privy" &&
				a.address === wallet.address,
		);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return (linked as any)?.id as string | undefined;
	}, [user, wallet]);

	return {
		publicKey,
		address: publicKey,
		connected: isConnected,
		isReady: ready && walletsReady,
		isLoadingWallet,
		signMessage,
		signTransaction,
		signAllTransactions,
		sendTransaction,
		disconnect: privyLogout,
		wallet,
		userId,
		walletId,
	};
}
