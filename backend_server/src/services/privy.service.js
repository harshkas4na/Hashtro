const { getConfig } = require('../config/environment');
const logger = require('../config/logger');

// CAIP-2 chain identifiers for Solana
const CAIP2 = {
    'mainnet-beta': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    devnet: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
};

let _client = null;

function getPrivyClient() {
    if (_client) return _client;

    // Lazy-load to avoid crashing the server on startup if @privy-io/node
    // has a broken transitive dependency in the current environment.
    const { PrivyClient } = require('@privy-io/node');

    const { privy } = getConfig();

    if (!privy.appId || !privy.appSecret) {
        throw new Error('PRIVY_APP_ID and PRIVY_APP_SECRET must be set for autonomous trading.');
    }

    _client = new PrivyClient({
        appId: privy.appId,
        appSecret: privy.appSecret,
    });

    return _client;
}

/**
 * Sign and broadcast a base64-encoded Solana transaction using Privy delegated actions.
 *
 * The transaction must already have any non-user signatures applied (e.g. Flash SDK
 * additionalSigners). Privy adds the user's embedded wallet signature and broadcasts.
 *
 * @param {string} privyWalletId  Internal Privy wallet UUID (stored in users.privy_wallet_id)
 * @param {string} base64Tx       Base64-encoded VersionedTransaction (partially signed)
 * @param {string} [network]      'mainnet-beta' | 'devnet'
 * @returns {Promise<string>}     Solana transaction signature (txSig)
 */
async function signAndSendTransaction(privyWalletId, base64Tx, network = 'mainnet-beta') {
    const privy = getPrivyClient();
    const caip2 = CAIP2[network] ?? CAIP2['mainnet-beta'];
    const { privy: privyConfig } = getConfig();

    logger.info('Privy: signing and sending transaction', { privyWalletId, network, caip2 });

    // Build authorization context — required when a key quorum is added as signer.
    // PRIVY_AUTHORIZATION_PRIVATE_KEY is the base64-encoded PKCS8 private key shown
    // once when creating the authorization key in Privy Dashboard → Wallet infrastructure → Authorization keys.
    const authorization_context = privyConfig.authorizationPrivateKey
        ? { authorization_private_keys: [privyConfig.authorizationPrivateKey] }
        : {};

    try {
        const result = await privy.walletsService.solanaService.signAndSendTransaction(
            privyWalletId,
            {
                caip2,
                transaction: base64Tx,
                authorization_context,
            },
        );

        logger.info('Privy: raw result', { privyWalletId, result: JSON.stringify(result) });
        const txSig = result?.hash ?? result?.signature ?? result?.data?.hash ?? result?.data?.signature;
        logger.info('Privy: transaction broadcast', { privyWalletId, txSig });
        return txSig;
    } catch (err) {
        const detail = err?.message ?? err?.error ?? JSON.stringify(err);
        logger.error('Privy: signAndSendTransaction failed', {
            privyWalletId,
            error: detail,
            status: err?.status ?? err?.statusCode,
            body: err?.body ?? err?.response?.body ?? undefined,
        });
        throw err;
    }
}

/**
 * Check whether a specific wallet address is currently delegated for a Privy user.
 *
 * @param {string} privyUserId   Privy user DID (did:privy:...)
 * @param {string} walletAddress Solana wallet address
 * @returns {Promise<boolean>}
 */
async function isWalletDelegated(privyUserId, walletAddress) {
    const privy = getPrivyClient();

    try {
        const user = await privy.getUser(privyUserId);
        return (user.linkedAccounts ?? []).some(
            (acc) =>
                acc.type === 'wallet' &&
                acc.chainType === 'solana' &&
                acc.address === walletAddress &&
                acc.delegated === true,
        );
    } catch (err) {
        logger.warn('Privy: isWalletDelegated check failed', { privyUserId, error: err.message });
        return false;
    }
}

module.exports = { signAndSendTransaction, isWalletDelegated };
