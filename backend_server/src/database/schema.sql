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
CREATE POLICY "Service role has full access to users"
  ON users
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to horoscopes"
  ON horoscopes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow anonymous users to read their own data (if using auth)
CREATE POLICY "Users can read their own user data"
  ON users
  FOR SELECT
  TO anon
  USING (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

CREATE POLICY "Users can read their own horoscopes"
  ON horoscopes
  FOR SELECT
  TO anon
  USING (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Create a view for easier querying
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

-- Grant access to the view
GRANT SELECT ON user_horoscopes TO anon, service_role;

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

-- Index on verified for fast "show all unverified horoscopes today" queries.
CREATE INDEX IF NOT EXISTS idx_horoscopes_verified ON horoscopes(verified);

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