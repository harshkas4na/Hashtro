#!/usr/bin/env python3
"""
Hastrology AI Agent
-------------------
A real agent that reads the astrological trading signal via the Hastrology API,
uses Claude to reason about it, and walks you through the full trade flow.

Setup:
    cp .env.example .env      # fill in your keys
    pip install -r requirements.txt
    python main.py

Flags:
    --loop     Re-run every 60 seconds (simulates a long-running agent)
    --silent   Skip the Claude commentary, just show raw signal
"""

import os
import sys
import time
import uuid
import argparse
from datetime import datetime

import httpx
from dotenv import load_dotenv
from google import genai

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

API_BASE    = os.getenv("HASTROLOGY_API_URL", "http://localhost:5001/api")
API_KEY     = os.getenv("HASTROLOGY_API_KEY", "")
GEMINI_KEY  = os.getenv("GEMINI_API_KEY", "")

HEADERS = {"Authorization": f"Bearer {API_KEY}"}

# ── Colours (terminal) ────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
ORANGE = "\033[38;5;208m"

def banner():
    print(f"""
{ORANGE}{BOLD}
  ██╗  ██╗ █████╗ ███████╗████████╗██████╗  ██████╗
  ██║  ██║██╔══██╗██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗
  ███████║███████║███████╗   ██║   ██████╔╝██║   ██║
  ██╔══██║██╔══██║╚════██║   ██║   ██╔══██╗██║   ██║
  ██║  ██║██║  ██║███████║   ██║   ██║  ██║╚██████╔╝
  ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝
{RESET}{DIM}  AI Trading Agent — powered by Hastrology + Claude{RESET}
""")

def hr():
    print(f"{DIM}{'─' * 60}{RESET}")

def label(text):
    return f"{DIM}{text}{RESET}"

# ── API calls ─────────────────────────────────────────────────────────────────

def get_signal() -> dict:
    r = httpx.get(f"{API_BASE}/agent/signal", headers=HEADERS, timeout=30)
    if r.status_code == 401:
        print(f"{RED}✗ Invalid API key. Check HASTROLOGY_API_KEY in .env{RESET}")
        sys.exit(1)
    if r.status_code == 422:
        print(f"{YELLOW}✗ Birth details not set for this wallet. Complete your profile first.{RESET}")
        sys.exit(1)
    if r.status_code == 503:
        print(f"{YELLOW}⚠ AI server unavailable. Try again in a few minutes.{RESET}")
        sys.exit(1)
    r.raise_for_status()
    return r.json()


def record_attempt(tx_sig: str, direction: str, leverage: float, asset: str) -> dict:
    r = httpx.post(
        f"{API_BASE}/agent/trade-attempt",
        headers=HEADERS,
        json={"txSig": tx_sig, "direction": direction, "leverage": leverage, "asset": asset},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def verify_trade(wallet_address: str, tx_sig: str, pnl_percent: float) -> dict:
    r = httpx.post(
        f"{API_BASE}/horoscope/verify",
        json={"walletAddress": wallet_address, "txSig": tx_sig, "pnlPercent": pnl_percent},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()

# ── Claude reasoning ──────────────────────────────────────────────────────────

def gemini_recommendation(signal: dict) -> str:
    if not GEMINI_KEY:
        return ""

    client = genai.Client(api_key=GEMINI_KEY)

    prompt = f"""You are an AI trading assistant for a Solana-based astrological trading app called Hastrology.
A user's daily horoscope has been translated into a machine-readable trading signal. Analyze it and give a
short, punchy recommendation (3-5 sentences max). Be direct. Mention the key factors — luck score,
direction, leverage, and any warning. Sound like a confident but cautious trading assistant, not an astrologer.

Signal data:
- Direction: {signal.get('direction')}
- Ticker: {signal.get('ticker') or 'unknown'}
- Luck score: {signal.get('luck_score')}/100
- Vibe status: {signal.get('vibe_status')}
- Leverage suggestion: {signal.get('leverage_suggestion') or 'N/A'}x (max {signal.get('leverage_max') or 'N/A'}x)
- Power hour: {signal.get('power_hour')}
- Zodiac sign: {signal.get('zodiac_sign')}
- Time lord: {signal.get('time_lord')}
- Has warning: {signal.get('has_warning')}
- Warning text: {signal.get('warning_text') or 'None'}
- Already verified today: {signal.get('already_verified')}
- Trade attempts today: {signal.get('trade_attempts_today')}/{signal.get('max_retries')}
- Rationale: {signal.get('rationale', '')[:300]}

Respond with just the recommendation text, no headers or bullet points."""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return response.text.strip()
    except Exception as e:
        err = str(e)
        if "429" in err or "RESOURCE_EXHAUSTED" in err:
            print(f"\n{YELLOW}⚠  Gemini quota exhausted — skipping AI commentary.{RESET}")
            print(f"{DIM}   Add billing at aistudio.google.com or try again tomorrow.{RESET}\n")
        else:
            print(f"\n{YELLOW}⚠  Gemini error: {err[:120]}{RESET}\n")
        return ""

# ── Display ───────────────────────────────────────────────────────────────────

def print_signal(signal: dict):
    direction = signal.get("direction", "—")
    luck      = signal.get("luck_score")
    ticker    = signal.get("ticker", "—")
    lev       = signal.get("leverage_suggestion")
    lev_max   = signal.get("leverage_max")
    power     = signal.get("power_hour", "—")
    vibe      = signal.get("vibe_status", "—")
    warning   = signal.get("warning_text")
    attempts  = signal.get("trade_attempts_today", 0)
    max_ret   = signal.get("max_retries", 2)
    last_at   = signal.get("last_trade_attempt_at")
    trade_url = signal.get("trade_url", "")

    dir_colour = GREEN if direction == "LONG" else RED
    luck_colour = GREEN if luck and luck > 65 else (YELLOW if luck and luck > 40 else RED)

    hr()
    print(f"  {BOLD}Today's Signal{RESET}   {label(signal.get('date', ''))}")
    hr()
    lev_str     = f"{lev}x suggested  (max {lev_max}x)" if lev is not None else "N/A"
    ticker_str  = ticker if ticker else "N/A  (horoscope may need refresh)"

    print(f"  {label('Direction')}     {dir_colour}{BOLD}{direction}{RESET}")
    print(f"  {label('Ticker')}        {CYAN}{ticker_str}{RESET}")
    print(f"  {label('Luck score')}    {luck_colour}{luck}/100{RESET}  ({vibe})")
    print(f"  {label('Leverage')}      {lev_str}")
    print(f"  {label('Power hour')}    {power}")

    if warning:
        print(f"\n  {YELLOW}⚠  {warning}{RESET}")

    print(f"\n  {label('Attempts')}      {attempts}/{max_ret}  ", end="")
    if last_at:
        ts = datetime.fromisoformat(last_at.replace("Z", "+00:00"))
        print(f"{DIM}(last: {ts.strftime('%H:%M UTC')}){RESET}", end="")
    print()

    print(f"\n  {label('Execute at')}    {ORANGE}{trade_url}{RESET}")
    hr()


def print_status(signal: dict):
    should  = signal.get("should_trade")
    verified = signal.get("already_verified")
    can_retry = signal.get("can_retry")

    if verified:
        print(f"\n{GREEN}✓ Today's horoscope is already verified — you won today!{RESET}\n")
    elif not should:
        print(f"\n{YELLOW}⊘ No trade signal today.{RESET}\n")
    elif not can_retry:
        print(f"\n{RED}✗ Max retries reached for today ({signal.get('max_retries')}).{RESET}\n")

# ── Interactive flow ──────────────────────────────────────────────────────────

def run(silent: bool = False):
    print(f"\n{DIM}Fetching signal...{RESET}")
    signal = get_signal()

    print_signal(signal)
    print_status(signal)

    # Gemini commentary
    if not silent and GEMINI_KEY:
        print(f"{DIM}Asking Gemini...{RESET}", end="\r")
        rec = gemini_recommendation(signal)
        if rec:
            print(f"\n{BOLD}Gemini says:{RESET}")
            for line in rec.split("\n"):
                print(f"  {line}")
            print()
    elif not GEMINI_KEY and not silent:
        print(f"{DIM}(Set GEMINI_API_KEY in .env to get Gemini's recommendation){RESET}\n")

    # If nothing to do, stop here
    if not signal.get("should_trade"):
        return

    # ── Step 1: confirm trade ────────────────────────────────────────────────
    direction = signal["direction"]
    ticker    = signal.get("ticker") or "?"
    lev       = signal.get("leverage_suggestion")
    lev_label = f"{lev}x" if lev is not None else "N/A"

    if ticker == "?":
        print(f"\n  {YELLOW}⚠  Ticker unknown — horoscope asset enrichment may need a refresh.{RESET}")
        print(f"  {DIM}See README: delete today's horoscope row in Supabase to force regen.{RESET}\n")

    print(f"  Recommended trade: {BOLD}{direction} {ticker} @ {lev_label}{RESET}")
    print(f"  Open {signal['trade_url']} to execute.\n")

    answer = input(f"  Did you place the trade? {DIM}[y/n]{RESET} ").strip().lower()
    if answer != "y":
        print(f"\n{DIM}No trade recorded. Run again when ready.{RESET}\n")
        return

    # ── Step 2: record attempt ───────────────────────────────────────────────
    tx_input = input(f"  Paste the transaction signature (or press Enter to use a test ID): ").strip()
    tx_sig = tx_input if tx_input else f"TEST_{uuid.uuid4().hex[:12].upper()}"

    print(f"\n{DIM}Recording trade attempt...{RESET}")
    result = record_attempt(tx_sig, direction, lev or 1, ticker or "unknown")
    attempts_now = result.get("trade_attempts_today", "?")
    max_ret = result.get("max_retries", 2)
    print(f"{GREEN}✓ Recorded.{RESET}  Attempt {attempts_now}/{max_ret}  txSig: {DIM}{tx_sig}{RESET}\n")

    # ── Step 3: verify (optional) ────────────────────────────────────────────
    answer2 = input(f"  Do you know the P&L result? {DIM}[y/n]{RESET} ").strip().lower()
    if answer2 != "y":
        print(f"\n{DIM}Call POST /api/horoscope/verify manually once you know the result.{RESET}\n")
        return

    wallet = signal.get("wallet_address", "")
    pnl_str = input(f"  Enter P&L % {DIM}(e.g. 4.8 for profit, -2.1 for loss){RESET}: ").strip()
    try:
        pnl = float(pnl_str)
    except ValueError:
        print(f"{RED}Invalid P&L. Skipping verification.{RESET}\n")
        return

    if pnl <= 0:
        print(f"\n{YELLOW}⊘ Loss trade ({pnl}%) — horoscope not verified. You can retry if can_retry is true.{RESET}\n")
        return

    print(f"\n{DIM}Verifying...{RESET}")
    vr = verify_trade(wallet, tx_sig, pnl)
    if vr.get("verified"):
        print(f"{GREEN}🌟 Horoscope verified! Profitable trade confirmed.{RESET}\n")
    else:
        print(f"{YELLOW}⚠  Verification returned unexpected response: {vr}{RESET}\n")


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Hastrology AI Agent")
    parser.add_argument("--loop",   action="store_true", help="Poll every 60s")
    parser.add_argument("--silent", action="store_true", help="Skip Claude commentary")
    args = parser.parse_args()

    if not API_KEY or not API_KEY.startswith("hstro_sk_"):
        print(f"{RED}✗ HASTROLOGY_API_KEY not set or invalid. Check your .env file.{RESET}")
        sys.exit(1)

    banner()

    if args.loop:
        print(f"{DIM}Running in loop mode. Press Ctrl+C to stop.{RESET}\n")
        try:
            while True:
                run(silent=args.silent)
                print(f"{DIM}Sleeping 60s...{RESET}\n")
                time.sleep(60)
        except KeyboardInterrupt:
            print(f"\n{DIM}Stopped.{RESET}\n")
    else:
        run(silent=args.silent)


if __name__ == "__main__":
    main()
