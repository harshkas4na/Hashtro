"use client";

import { Connection } from "@solana/web3.js";
import { FC, useEffect, useState, useRef, useCallback } from "react";
import { usePrivyWallet } from "@/app/hooks/use-privy-wallet";
import { FlashPrivyService } from "@/lib/flash-trade";
import type { AstroCard } from "@/types";
import { StarBackground } from "./StarBackground";

interface TradeExecutionProps {
	card: AstroCard;
	amount: number;
	leverage: number;
	direction: "LONG" | "SHORT";
	onComplete: (result: TradeResult) => void;
}

export interface TradeResult {
	success: boolean;
	pnl: number;
	pnlPercent: number;
	entryPrice: number;
	exitPrice: number;
	direction: "LONG" | "SHORT";
	leverage: number;
	txSig?: string;
}

const TRADE_DURATION = 30; // seconds

