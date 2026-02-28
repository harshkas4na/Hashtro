/**
 * flash-trade.service.js
 *
 * Server-side Flash Protocol perpetuals transaction builder.
 * Mirrors the logic in frontend/lib/flash-trade.ts but runs in Node.js.
 *
 * Key difference from the frontend version:
 *   - No wallet signing here. We build an unsigned VersionedTransaction
 *     (partially signed only by Flash's additionalSigners / ephemeral keypairs).
 *   - The serialized base64 is handed to privy.service.js, which adds the
 *     user's embedded-wallet signature and broadcasts via Privy's enclave.
 */

const {
    Connection,
    PublicKey,
    VersionedTransaction,
    TransactionMessage,
    ComputeBudgetProgram,
} = require('@solana/web3.js');
const { AnchorProvider }    = require('@coral-xyz/anchor');
const { HermesClient }      = require('@pythnetwork/hermes-client');
const { getMint }           = require('@solana/spl-token');
const BN                    = require('bn.js');
const {
    PerpetualsClient,
    PoolConfig,
    PoolAccount,
    CustodyAccount,
    PoolDataClient,
    OraclePrice,
    Side,
    Privilege,
    uiDecimalsToNative,
    BN_ZERO,
} = require('flash-sdk');
const { getConfig }         = require('../config/environment');
const logger                = require('../config/logger');

// ─── Pool & Token Config ─────────────────────────────────────────────────────

const POOL_NAMES = [
    'Crypto.1', 'Virtual.1', 'Governance.1',
    'Community.1', 'Community.2', 'Trump.1', 'Ore.1', 'Remora.1',
];

// Build these once at module load (same as frontend ALL_TOKENS map)
let _poolConfigs     = null;
let _allMarketConfigs = null;
let _tokenMap        = null;

function getPoolConfigs(network) {
    if (_poolConfigs) return _poolConfigs;
    _poolConfigs = POOL_NAMES.map((name) =>
        PoolConfig.fromIdsByName(name, network === 'devnet' ? 'devnet' : 'mainnet-beta'),
    );
    _allMarketConfigs = _poolConfigs.map((p) => p.markets).flat();
    _tokenMap = new Map();
    for (const token of _poolConfigs.map((p) => p.tokens).flat()) {
        _tokenMap.set(token.symbol, token);
    }
    return _poolConfigs;
}

// ─── Hermes / Oracle Price Fetching ──────────────────────────────────────────

async function fetchPrices(poolConfig) {
    const hermes    = new HermesClient('https://hermes.pyth.network', {});
    const priceIds  = poolConfig.tokens.map((t) => t.pythPriceId.toString());
    const updates   = await hermes.getLatestPriceUpdates(priceIds);

    if (!updates?.parsed) {
        throw new Error('Failed to fetch Pyth price updates from Hermes');
    }

    const priceMap = new Map();

    for (const token of poolConfig.tokens) {
        let idStr = token.pythPriceId.toString();
        if (idStr.startsWith('0x')) idStr = idStr.slice(2);

        const feed = updates.parsed.find((f) => f.id === idStr);
        if (!feed) throw new Error(`Price feed not found for ${token.symbol}`);

        priceMap.set(token.symbol, {
            price: new OraclePrice({
                price:      new BN(feed.price.price),
                exponent:   new BN(feed.price.expo),
                confidence: new BN(feed.price.conf),
                timestamp:  new BN(feed.price.publish_time),
            }),
            emaPrice: new OraclePrice({
                price:      new BN(feed.ema_price.price),
                exponent:   new BN(feed.ema_price.expo),
                confidence: new BN(feed.ema_price.conf),
                timestamp:  new BN(feed.price.publish_time),
            }),
        });
    }

    return priceMap;
}

// ─── Main: Build Open-Position Transaction ────────────────────────────────────

/**
 * Build a Flash Protocol swapAndOpen (open perpetual position) transaction.
 *
 * Returns the transaction serialized as base64 with only Flash's internal
 * additionalSigners applied. The user's wallet signature is NOT included —
 * call privy.service.signAndSendTransaction() with the result.
 *
 * @param {Object} params
 * @param {string} params.walletAddress    User's Solana address (fee payer)
 * @param {'long'|'short'} params.side     Trade direction
 * @param {number} params.inputAmountUsd   USDC collateral amount (UI units, e.g. 50)
 * @param {number} params.leverage         Leverage multiplier (e.g. 3)
 * @param {string} [params.symbol]         Target token symbol, e.g. 'SOL' (default: 'SOL')
 * @param {string} [params.network]        'mainnet-beta' | 'devnet'
 * @returns {Promise<{base64Tx: string, blockhash: string, lastValidBlockHeight: number, estimatedPrice: number}>}
 */
async function buildOpenPositionTx({
    walletAddress,
    side,
    inputAmountUsd,
    leverage,
    symbol = 'SOL',
    network,
}) {
    const { solana } = getConfig();
    const net = network ?? solana.network ?? 'mainnet-beta';

    logger.info('Flash: building open-position transaction', {
        walletAddress, side, inputAmountUsd, leverage, symbol, net,
    });

    const connection    = new Connection(solana.rpcUrl, 'confirmed');
    const walletPubkey  = new PublicKey(walletAddress);

    // A read-only wallet adapter — provider needs a publicKey but signing
    // is skipped entirely; Privy handles it afterward.
    const readOnlyWallet = {
        publicKey:           walletPubkey,
        signTransaction:     async () => { throw new Error('Use Privy to sign'); },
        signAllTransactions: async () => { throw new Error('Use Privy to sign'); },
    };

    const provider = new AnchorProvider(connection, readOnlyWallet, {
        commitment:           'confirmed',
        preflightCommitment:  'confirmed',
        skipPreflight:        false,
    });

    // ── Pool setup ────────────────────────────────────────────────────────────
    const poolConfigs = getPoolConfigs(net);
    const POOL_CONFIG = PoolConfig.fromIdsByName('Crypto.1', net === 'devnet' ? 'devnet' : 'mainnet-beta');

    const flashClient = new PerpetualsClient(
        provider,
        POOL_CONFIG.programId,
        POOL_CONFIG.perpComposibilityProgramId,
        POOL_CONFIG.fbNftRewardProgramId,
        POOL_CONFIG.rewardDistributionProgram.programId,
        { prioritizationFee: 100000 },
    );

    // ── Resolve tokens ────────────────────────────────────────────────────────
    const inputTokenSymbol  = 'USDC';
    const outputTokenSymbol = symbol.toUpperCase();

    const inputToken  = POOL_CONFIG.tokens.find((t) => t.symbol === inputTokenSymbol);
    const outputToken = POOL_CONFIG.tokens.find((t) => t.symbol === outputTokenSymbol);

    if (!inputToken)  throw new Error(`Input token ${inputTokenSymbol} not found in pool`);
    if (!outputToken) throw new Error(`Target token ${outputTokenSymbol} not found in pool`);

    // ── Fetch oracle prices ───────────────────────────────────────────────────
    const priceMap = await fetchPrices(POOL_CONFIG);

    const inputTokenPrice    = priceMap.get(inputToken.symbol).price;
    const inputTokenPriceEma = priceMap.get(inputToken.symbol).emaPrice;
    const outputTokenPrice   = priceMap.get(outputToken.symbol).price;
    const outputTokenPriceEma = priceMap.get(outputToken.symbol).emaPrice;

    const estimatedPrice =
        Number(outputTokenPrice.price.toString()) /
        10 ** Math.abs(outputTokenPrice.exponent.toNumber());

    // ── Load ALTs ─────────────────────────────────────────────────────────────
    await flashClient.loadAddressLookupTable(POOL_CONFIG);

    // ── Slippage & collateral ─────────────────────────────────────────────────
    const slippageBps   = 800; // 8%
    const flashSide     = side === 'long' ? Side.Long : Side.Short;

    const priceAfterSlippage = flashClient.getPriceAfterSlippage(
        true,
        new BN(slippageBps),
        outputTokenPrice,
        flashSide,
    );

    const collateralWithFee = uiDecimalsToNative(
        inputAmountUsd.toString(),
        inputToken.decimals,
    );

    // ── Custody accounts ──────────────────────────────────────────────────────
    const inputCustodyConfig  = POOL_CONFIG.custodies.find((c) => c.symbol === inputToken.symbol);
    const outputCustodyConfig = POOL_CONFIG.custodies.find((c) => c.symbol === outputToken.symbol);

    if (!inputCustodyConfig || !outputCustodyConfig) {
        throw new Error('Custody config not found for tokens');
    }

    const custodies = await flashClient.program.account.custody.fetchMultiple([
        inputCustodyConfig.custodyAccount,
        outputCustodyConfig.custodyAccount,
    ]);

    const poolAccountData = PoolAccount.from(
        POOL_CONFIG.poolAddress,
        await flashClient.program.account.pool.fetch(POOL_CONFIG.poolAddress),
    );

    const allCustodies = await flashClient.program.account.custody.all();

    const lpMintData = await getMint(
        flashClient.provider.connection,
        POOL_CONFIG.stakedLpTokenMint,
    );

    const poolDataClient = new PoolDataClient(
        POOL_CONFIG,
        poolAccountData,
        lpMintData,
        allCustodies.map((c) => CustodyAccount.from(c.publicKey, c.account)),
    );

    const lpStats = poolDataClient.getLpStats(priceMap);

    const inputCustodyAccount  = CustodyAccount.from(inputCustodyConfig.custodyAccount,  custodies[0]);
    const outputCustodyAccount = CustodyAccount.from(outputCustodyConfig.custodyAccount, custodies[1]);

    // ── Size calculation ──────────────────────────────────────────────────────
    const size = flashClient.getSizeAmountWithSwapSync(
        collateralWithFee,
        leverage.toString(),
        flashSide,
        poolAccountData,
        inputTokenPrice,
        inputTokenPriceEma,
        inputCustodyAccount,
        outputTokenPrice,
        outputTokenPriceEma,
        outputCustodyAccount,
        outputTokenPrice,
        outputTokenPriceEma,
        outputCustodyAccount,
        outputTokenPrice,
        outputTokenPriceEma,
        outputCustodyAccount,
        lpStats.totalPoolValueUsd,
        POOL_CONFIG,
        uiDecimalsToNative('0', 2),
    );

    // ── Build swapAndOpen instructions ────────────────────────────────────────
    const openPositionData = await flashClient.swapAndOpen(
        outputToken.symbol,
        outputToken.symbol,
        inputToken.symbol,
        collateralWithFee,
        priceAfterSlippage,
        size,
        flashSide,
        POOL_CONFIG,
        Privilege.None,
    );

    // ── Assemble instructions ─────────────────────────────────────────────────
    const instructions = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        ...openPositionData.instructions,
    ];

    // ── Fetch ALTs ────────────────────────────────────────────────────────────
    const { addressLookupTables } = await flashClient.getOrLoadAddressLookupTable(POOL_CONFIG);

    // ── Blockhash ─────────────────────────────────────────────────────────────
    const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash('confirmed');

    // ── Build VersionedTransaction ────────────────────────────────────────────
    const messageV0 = new TransactionMessage({
        payerKey:       walletPubkey,
        recentBlockhash: blockhash,
        instructions,
    }).compileToV0Message(addressLookupTables);

    const transaction = new VersionedTransaction(messageV0);

    // Sign with Flash SDK's ephemeral keypairs (e.g. new position accounts).
    // The user's wallet signature is intentionally omitted — Privy provides it.
    if (openPositionData.additionalSigners?.length > 0) {
        transaction.sign(openPositionData.additionalSigners);
    }

    const base64Tx = Buffer.from(transaction.serialize()).toString('base64');

    logger.info('Flash: transaction built', {
        walletAddress, symbol, side, leverage, estimatedPrice,
        additionalSigners: openPositionData.additionalSigners?.length ?? 0,
    });

    return { base64Tx, blockhash, lastValidBlockHeight, estimatedPrice };
}

module.exports = { buildOpenPositionTx };
