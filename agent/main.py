#!/usr/bin/env python3
"""
General-Purpose Hastrology Agent
----------------------------------
A Gemini agent that operates Hastrology using ONLY:
  1. The system prompt from the /agent page (identical text the user copies)
  2. A single generic http_request tool

No hardcoded endpoint logic — Gemini reads the API context in the system
prompt and decides which calls to make and in what order.

This is the canonical test of whether the OpenAPI spec + system prompt is
self-sufficient for any general-purpose AI agent.

Setup:
    cp .env.example .env      # fill in HASTROLOGY_API_KEY and GEMINI_API_KEY
    pip install -r requirements.txt
    python main.py

Flags:
    --dry-run    Fetch signal and reason, but skip all trade execution
    --loop       Re-run every 60 seconds (long-running autonomous agent)
    --amount N   SOL collateral per trade (default: 0.1)
"""

import os
import sys
import time
import argparse
from datetime import datetime

import httpx
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

API_BASE     = os.getenv("HASTROLOGY_API_URL", "https://api.hashtro.fun/api")
API_KEY      = os.getenv("HASTROLOGY_API_KEY", "")
GEMINI_KEY   = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-2.5-flash"

# Derive server root from API_BASE (strips /api suffix) so we can build
# full URLs from absolute paths like /api/agent/signal.
# e.g. "http://localhost:5001/api" → "http://localhost:5001"
_base = API_BASE.rstrip("/")
SERVER_ROOT = _base[:-4] if _base.endswith("/api") else _base

# ── Terminal colours ───────────────────────────────────────────────────────────
RESET  = "\033[0m"; BOLD = "\033[1m"; DIM = "\033[2m"
GREEN  = "\033[92m"; RED  = "\033[91m"; YELLOW = "\033[93m"
CYAN   = "\033[96m"; ORANGE = "\033[38;5;208m"

def hr():   print(f"{DIM}{'─' * 64}{RESET}")
def dim(s): return f"{DIM}{s}{RESET}"


def banner():
    print(f"""
{ORANGE}{BOLD}
  ██╗  ██╗ █████╗ ███████╗████████╗██████╗  ██████╗
  ██║  ██║██╔══██╗██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗
  ███████║███████║███████╗   ██║   ██████╔╝██║   ██║
  ██╔══██║██╔══██║╚════██║   ██║   ██╔══██╗██║   ██║
  ██║  ██║██║  ██║███████║   ██║   ██║  ██║╚██████╔╝
  ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝
{RESET}{DIM}  General-Purpose Agent — spec-driven via Gemini{RESET}
""")


# ── System prompt ──────────────────────────────────────────────────────────────
# This is byte-for-byte the same text that buildSystemPrompt() generates on
# the /agent frontend page. The agent knows nothing else about Hastrology.

def build_system_prompt(amount: float) -> str:
    return f"""You are a trading assistant connected to Hastrology, an astrological trading signal app on Solana.

API base: {API_BASE}
Authorization: Bearer {API_KEY}

Every morning (or when asked), call GET /api/agent/signal to get today's trading signal. The response tells you:
- should_trade: whether to trade today
- direction: LONG or SHORT (luck_score >50 = LONG, ≤50 = SHORT)
- ticker: which asset to trade — always one of: SOL, BTC, ETH, BNB, ZEC (derived from luck_score)
- luck_score: 0–100
- leverage_suggestion: recommended leverage (capped by has_warning and asset max)
- power_hour: best entry time window
- has_warning: if true, reduce position size or skip
- already_verified: today's horoscope is already confirmed profitable
- autonomous_trading_enabled: true if the user has granted permission for server-side trade execution
- trade_url: direct link for the user to execute the trade manually

Rules:
1. If should_trade is false or already_verified is true — report status and stop.
2. If has_warning is true — mention it and suggest caution.
3. If autonomous_trading_enabled is false:
   Summarise the signal and send the user to the trade_url to execute manually.
4. If autonomous_trading_enabled is true:
   Call POST /api/agent/execute-trade with {{"amount": {amount}}} (SOL collateral).
   The API handles direction, ticker, and leverage automatically from today's signal.
   The position opens and auto-closes after 30 seconds.
5. After a trade is confirmed (execute-trade returns a txSig), call POST /api/agent/trade-attempt with:
   txSig, direction (from signal), leverage (from leverage_suggestion), asset (from ticker).

Use the http_request tool to make all API calls."""


# ── Generic HTTP tool ─────────────────────────────────────────────────────────
# The agent has exactly ONE tool: a generic HTTP request.
# It figures out what to call from the system prompt above.

HTTP_TOOL = types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name="http_request",
        description=(
            "Make an HTTP request to the Hastrology API. "
            "Paths are absolute from server root (e.g. /api/agent/signal). "
            "Authorization header is injected automatically."
        ),
        parameters={
            "type": "object",
            "properties": {
                "method": {
                    "type": "string",
                    "enum": ["GET", "POST", "PATCH", "DELETE"],
                    "description": "HTTP method",
                },
                "path": {
                    "type": "string",
                    "description": "Full path from server root, e.g. /api/agent/signal",
                },
                "body": {
                    "type": "object",
                    "description": "JSON body for POST/PATCH requests (omit for GET)",
                },
            },
            "required": ["method", "path"],
        },
    )
])


def call_http(args: dict, dry_run: bool) -> dict:
    """Execute an http_request tool call from Gemini."""
    method = str(args.get("method", "GET")).upper()
    path   = str(args.get("path", ""))
    body   = args.get("body") or {}

    url = SERVER_ROOT + path

    if dry_run and method in ("POST", "PATCH", "DELETE"):
        print(f"  {YELLOW}[dry-run] SKIP {method} {path}{RESET}")
        if "execute-trade" in path:
            return {
                "skipped": True,
                "reason": "dry-run mode — trade not executed",
                "would_have_sent": body,
            }
        return {"skipped": True, "reason": "dry-run mode"}

    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }

    print(f"  {DIM}→ {method} {path}{RESET}", flush=True)
    try:
        if method == "GET":
            r = httpx.get(url, headers=headers, timeout=30)
        elif method == "POST":
            r = httpx.post(url, headers=headers, json=body, timeout=60)
        elif method == "PATCH":
            r = httpx.patch(url, headers=headers, json=body, timeout=10)
        elif method == "DELETE":
            r = httpx.delete(url, headers=headers, timeout=10)
        else:
            return {"error": f"Unsupported method: {method}"}

        print(f"  {DIM}← {r.status_code}{RESET}", flush=True)

        try:
            return {"status": r.status_code, "body": r.json()}
        except Exception:
            return {"status": r.status_code, "body": r.text}

    except httpx.RequestError as e:
        return {"error": str(e)}


# ── Agent run ─────────────────────────────────────────────────────────────────

def run_agent(amount: float = 0.1, dry_run: bool = False):
    if not GEMINI_KEY:
        print(f"{RED}✗ GEMINI_API_KEY not set. Add it to .env{RESET}")
        sys.exit(1)

    client = genai.Client(api_key=GEMINI_KEY)
    today  = datetime.now().strftime("%A, %B %d, %Y")

    hr()
    print(f"  {BOLD}Hastrology Agent{RESET}   {dim(today)}")
    if dry_run:
        print(f"  {YELLOW}Dry-run: POST/PATCH/DELETE calls are skipped{RESET}")
    hr()
    print()

    chat = client.chats.create(
        model=GEMINI_MODEL,
        config=types.GenerateContentConfig(
            system_instruction=build_system_prompt(amount),
            tools=[HTTP_TOOL],
            temperature=0.3,
        ),
    )

    # This is the only thing we tell the agent — same as a user asking their
    # AI assistant each morning. No hints about which endpoints to call.
    seed = (
        f"Today is {today}. "
        "Check today's trading signal and follow your instructions. "
        "Tell me what you find and what action you're taking."
    )

    response = chat.send_message(seed)

    for _ in range(12):  # safety cap on turns
        func_calls = []
        text_parts = []

        for part in response.candidates[0].content.parts:
            if part.function_call:
                func_calls.append(part.function_call)
            elif part.text and part.text.strip():
                text_parts.append(part.text.strip())

        # Print any text Gemini emitted this turn
        for text in text_parts:
            print(f"\n{BOLD}Agent:{RESET}")
            for line in text.split("\n"):
                print(f"  {line}")
            print()

        # No tool calls → agent is done
        if not func_calls:
            break

        # Execute all tool calls and feed results back in one message
        tool_responses = []
        for fc in func_calls:
            result = call_http(dict(fc.args), dry_run)
            tool_responses.append(
                types.Part.from_function_response(
                    name=fc.name,
                    response=result,
                )
            )

        response = chat.send_message(tool_responses)

    else:
        print(f"{YELLOW}⚠ Reached max-turn safety limit.{RESET}")

    hr()
    print()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Hastrology General-Purpose Agent",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python main.py                   # run once, auto-execute if delegation enabled\n"
            "  python main.py --dry-run         # read signal only, no trades\n"
            "  python main.py --loop            # run every 60s\n"
            "  python main.py --amount 0.25     # use 0.25 SOL collateral\n"
        ),
    )
    parser.add_argument("--dry-run", action="store_true",
                        help="Read signal and reason, but skip all trade execution")
    parser.add_argument("--loop",    action="store_true",
                        help="Re-run every 60 seconds (long-running agent)")
    parser.add_argument("--amount",  type=float, default=0.1,
                        help="SOL collateral per trade (default: 0.1)")
    args = parser.parse_args()

    if not API_KEY or not API_KEY.startswith("hstro_sk_"):
        print(f"{RED}✗ HASTROLOGY_API_KEY not set or invalid. Check .env{RESET}")
        sys.exit(1)

    banner()

    if args.loop:
        print(f"{DIM}Running in loop mode. Ctrl+C to stop.{RESET}\n")
        try:
            while True:
                run_agent(amount=args.amount, dry_run=args.dry_run)
                print(f"{DIM}Sleeping 60s...{RESET}\n")
                time.sleep(60)
        except KeyboardInterrupt:
            print(f"\n{DIM}Stopped.{RESET}\n")
    else:
        run_agent(amount=args.amount, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
