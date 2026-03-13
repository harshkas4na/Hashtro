-- Hastrology Database Schema for Supabase
-- Run this in Supabase SQL Editor after creating your project

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT UNIQUE NOT NULL,
  username TEXT,
  dob TEXT,
  birth_time TEXT,
  birth_place TEXT,
  twitter_id TEXT,
  twitter_username TEXT,
  twitter_profile_url TEXT,
  twitter_access_token TEXT,
  twitter_refresh_token TEXT,
  twitter_token_expires TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  timezone_offset NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- Create horoscopes table
CREATE TABLE IF NOT EXISTS horoscopes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  date DATE NOT NULL,
  horoscope_text TEXT NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure one horoscope per user per day
  UNIQUE(wallet_address, date)
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_horoscopes_wallet_date ON horoscopes(wallet_address, date);
CREATE INDEX IF NOT EXISTS idx_horoscopes_user_id ON horoscopes(user_id);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for users table
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
-- Enable RLS on tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE horoscopes ENABLE ROW LEVEL SECURITY;

-- Allow service role to do everything (for backend server)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'users' AND policyname = 'Service role has full access to users'
  ) THEN
    CREATE POLICY "Service role has full access to users"
      ON users FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'horoscopes' AND policyname = 'Service role has full access to horoscopes'
  ) THEN
    CREATE POLICY "Service role has full access to horoscopes"
      ON horoscopes FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Allow anonymous users to read their own data (if using auth)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'users' AND policyname = 'Users can read their own user data'
  ) THEN
    CREATE POLICY "Users can read their own user data"
      ON users FOR SELECT TO anon
      USING (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'horoscopes' AND policyname = 'Users can read their own horoscopes'
  ) THEN
    CREATE POLICY "Users can read their own horoscopes"
      ON horoscopes FOR SELECT TO anon
      USING (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');
  END IF;
END $$;

-- Drop view now so the JSONB migration below can alter horoscope_text freely.
-- It is recreated after the migration.
DROP VIEW IF EXISTS user_horoscopes;

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Hastrology schema created successfully!';
  RAISE NOTICE 'Tables created: users, horoscopes';
  RAISE NOTICE 'View created: user_horoscopes';
  RAISE NOTICE 'RLS policies enabled for security';
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS trade_made_at TIMESTAMP WITH TIME ZONE;

-- Migration: Convert horoscope_text from TEXT to JSONB.
-- JSONB allows querying inside the card (e.g. luck_score), compression, and
-- indexing. Requires all existing rows to contain valid JSON (they always
-- should since the backend writes them via JSON.stringify).
-- Run only once against an existing database; safe to skip if already JSONB.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'horoscopes' AND column_name = 'horoscope_text') = 'text' THEN
    ALTER TABLE horoscopes ALTER COLUMN horoscope_text TYPE JSONB
      USING horoscope_text::JSONB;
    RAISE NOTICE 'horoscope_text converted to JSONB';
  ELSE
    RAISE NOTICE 'horoscope_text is already JSONB — skipping migration';
  END IF;
END $$;

-- Recreate view now that horoscope_text is JSONB.
CREATE OR REPLACE VIEW user_horoscopes AS
SELECT
  h.id,
  h.wallet_address,
  h.date,
  h.horoscope_text,
  h.verified,
  h.created_at,
  u.dob,
  u.birth_time,
  u.birth_place
FROM horoscopes h
JOIN users u ON h.wallet_address = u.wallet_address;

GRANT SELECT ON user_horoscopes TO anon, service_role;

-- Index on verified for fast "show all unverified horoscopes today" queries.
CREATE INDEX IF NOT EXISTS idx_horoscopes_verified ON horoscopes(verified);

-- Migration: Enforce YYYY-MM-DD format on users.dob at the database level.
-- The birthDetailsUpdateSchema Joi validator already requires this pattern,
-- but a CHECK constraint prevents any direct inserts that bypass the API.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'users' AND constraint_name = 'users_dob_format'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_dob_format
      CHECK (dob IS NULL OR dob ~ '^\d{4}-\d{2}-\d{2}$');
  END IF;
END $$;

-- Migration: Enforce user_id NOT NULL on horoscopes.
-- user_id is a FK to users(id) but currently allows NULL, meaning the relation
-- is unenforced for old rows. Steps:
--   1. Backfill NULLs by joining on wallet_address (safe if all wallets exist in users)
--   2. Add NOT NULL constraint
-- Run manually after verifying no orphaned wallet_addresses:
-- UPDATE horoscopes h
--   SET user_id = u.id
--   FROM users u
--   WHERE h.wallet_address = u.wallet_address
--     AND h.user_id IS NULL;
-- ALTER TABLE horoscopes ALTER COLUMN user_id SET NOT NULL;

-- Migration: trade history table.
-- trade_made_at on users is overwritten on every trade — there is no history.
-- This dedicated table stores each individual trade event so we can show users
-- their full trade history and compute streaks / statistics.
CREATE TABLE IF NOT EXISTS trades (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address TEXT NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
  horoscope_date DATE NOT NULL,  -- the horoscope day this trade was made for
  traded_at      TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at     TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trades_wallet_date ON trades(wallet_address, horoscope_date);
CREATE INDEX IF NOT EXISTS idx_trades_wallet      ON trades(wallet_address);

-- RLS: service role full access; no anon read needed (backend always proxies)
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'trades'
      AND policyname = 'Service role has full access to trades'
  ) THEN
    CREATE POLICY "Service role has full access to trades"
      ON trades FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Migration: Soft deletes for users and horoscopes.
-- Adds a deleted_at timestamp column. NULL = active; non-NULL = soft-deleted.
-- Hard DELETE is replaced by UPDATE deleted_at = NOW() in the API.
-- Existing queries should add WHERE deleted_at IS NULL to exclude soft-deleted rows.
-- The partial indexes below make those filtered queries fast without a full scan.
ALTER TABLE users      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE horoscopes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE;

-- Partial indexes covering only active (non-deleted) rows.
CREATE INDEX IF NOT EXISTS idx_users_active
  ON users(wallet_address) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_horoscopes_active
  ON horoscopes(wallet_address, date) WHERE deleted_at IS NULL;

-- Migration: trade_attempts tracking per horoscope.
-- Tracks how many times the user has attempted to verify a trade for a given
-- day's horoscope. Allows the backend to enforce a per-day retry cap without
-- a separate table.
ALTER TABLE horoscopes ADD COLUMN IF NOT EXISTS trade_attempts INTEGER NOT NULL DEFAULT 0;

-- Atomic increment helper used by horoscope.service.js to avoid a read-modify-write race.
-- Returns the new trade_attempts value.
CREATE OR REPLACE FUNCTION increment_trade_attempts(p_wallet TEXT, p_date DATE)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new INTEGER;
BEGIN
  UPDATE horoscopes
    SET trade_attempts = trade_attempts + 1
    WHERE wallet_address = p_wallet
      AND date = p_date
    RETURNING trade_attempts INTO v_new;
  RETURN v_new;
END;
$$;

-- Grant execute to service role (the backend uses the service key)
GRANT EXECUTE ON FUNCTION increment_trade_attempts(TEXT, DATE) TO service_role;

-- Migration: last_trade_attempt_at on horoscopes.
-- Records when the most recent trade attempt was made for a given day's horoscope,
-- so agents can display "last attempted at 3:14 PM" without querying trades history.
ALTER TABLE horoscopes ADD COLUMN IF NOT EXISTS last_trade_attempt_at TIMESTAMP WITH TIME ZONE;

-- Migration: Agent Webhooks table.
-- Agents register a URL here; the backend pushes events (horoscope_ready,
-- trade_verified, trade_failed) to that URL signed with a per-webhook secret.
CREATE TABLE IF NOT EXISTS agent_webhooks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key_id      UUID NOT NULL REFERENCES agent_api_keys(id) ON DELETE CASCADE,
  wallet_address  TEXT NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
  url             TEXT NOT NULL,
  secret          TEXT NOT NULL,          -- HMAC-SHA256 signing secret (stored raw — needed for signing)
  events          TEXT[] NOT NULL,        -- e.g. ARRAY['horoscope_ready','trade_verified']
  active          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_wallet  ON agent_webhooks(wallet_address);
CREATE INDEX IF NOT EXISTS idx_webhooks_key     ON agent_webhooks(api_key_id);

ALTER TABLE agent_webhooks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_webhooks'
      AND policyname = 'Service role has full access to agent_webhooks'
  ) THEN
    CREATE POLICY "Service role has full access to agent_webhooks"
      ON agent_webhooks FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Migration: Privy delegated-action columns on users.
-- privy_user_id   : Privy's DID string (did:privy:...) — needed to look up the user in Privy.
-- privy_wallet_id : Internal Privy wallet UUID — required by @privy-io/node signAndSendTransaction().
-- trading_delegated: Set to true after the user approves delegateWallet() in the frontend.
--                    execute-trade endpoint enforces this flag before signing anything.
ALTER TABLE users ADD COLUMN IF NOT EXISTS privy_user_id     TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privy_wallet_id   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trading_delegated BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_users_privy_wallet ON users(privy_wallet_id)
  WHERE privy_wallet_id IS NOT NULL;

-- Migration: Agent API Keys table.
-- Agents (e.g. OpenClaw) authenticate with a bearer token so they can read
-- horoscope signals on behalf of a user without needing the user's private key.
-- The raw key is NEVER stored — only its SHA-256 hex digest.
CREATE TABLE IF NOT EXISTS agent_api_keys (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_hash        TEXT UNIQUE NOT NULL,          -- SHA-256 of the raw key (never store raw)
  key_prefix      TEXT NOT NULL,                  -- First 13 chars for display e.g. "hstro_sk_V2f8"
  wallet_address  TEXT NOT NULL REFERENCES users(wallet_address) ON DELETE CASCADE,
  label           TEXT NOT NULL DEFAULT 'My Agent',
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at    TIMESTAMP WITH TIME ZONE,
  revoked         BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_agent_keys_wallet ON agent_api_keys(wallet_address);
CREATE INDEX IF NOT EXISTS idx_agent_keys_hash   ON agent_api_keys(key_hash);

ALTER TABLE agent_api_keys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_api_keys'
      AND policyname = 'Service role has full access to agent_api_keys'
  ) THEN
    CREATE POLICY "Service role has full access to agent_api_keys"
      ON agent_api_keys FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;