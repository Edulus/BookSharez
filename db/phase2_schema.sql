-- BookSharez Phase 2 — shelf system, profiles, follow graph
-- Apply in Supabase SQL Editor AFTER the Phase 1 schema (schema.sql) is live.
-- Run this file in one shot; all statements are idempotent-safe.

-- ── profiles ──────────────────────────────────────────────────────────────────
-- One row per auth user; auto-created via trigger on signup.
-- Existing users get a row via the backfill INSERT at the bottom.

CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT UNIQUE CHECK (username ~ '^[a-zA-Z0-9_]{3,30}$'),
  bio         TEXT CHECK (char_length(bio) <= 300),
  avatar_url  TEXT,
  visibility  TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'friends_only', 'private')),
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- Auto-create a blank profile row when a new user signs up.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ── shelf_entries ─────────────────────────────────────────────────────────────

CREATE TABLE shelf_entries (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  book_id     UUID REFERENCES books(id) ON DELETE CASCADE NOT NULL,
  shelf_type  TEXT NOT NULL CHECK (shelf_type IN ('have', 'want')),
  visibility  TEXT DEFAULT 'public' CHECK (visibility IN ('public', 'hidden')),
  added_at    TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, book_id, shelf_type)
);

CREATE INDEX idx_shelf_entries_user_id    ON shelf_entries(user_id);
CREATE INDEX idx_shelf_entries_book_id    ON shelf_entries(book_id);
CREATE INDEX idx_shelf_entries_user_shelf ON shelf_entries(user_id, shelf_type);

-- ── follows ───────────────────────────────────────────────────────────────────

CREATE TABLE follows (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  followed_id  UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  created_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE (follower_id, followed_id),
  CHECK (follower_id != followed_id)
);

CREATE INDEX idx_follows_follower ON follows(follower_id);
CREATE INDEX idx_follows_followed ON follows(followed_id);

-- ── listings: add shelf_entry_id FK ──────────────────────────────────────────
-- Nullable: pre-Phase-2 listings have no shelf entry; new ones will.

ALTER TABLE listings
  ADD COLUMN shelf_entry_id UUID REFERENCES shelf_entries(id) ON DELETE SET NULL;

CREATE INDEX idx_listings_shelf_entry ON listings(shelf_entry_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE shelf_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows       ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Anyone can view profiles"
  ON profiles FOR SELECT USING (true);

CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- shelf_entries: owner sees all their own rows; others see only public entries
CREATE POLICY "Users see their own or public shelf entries"
  ON shelf_entries FOR SELECT
  USING (auth.uid() = user_id OR visibility = 'public');

CREATE POLICY "Users can add to their own shelf"
  ON shelf_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own shelf entries"
  ON shelf_entries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can remove their own shelf entries"
  ON shelf_entries FOR DELETE
  USING (auth.uid() = user_id);

-- follows: public read; owner inserts/deletes
CREATE POLICY "Anyone can view follows"
  ON follows FOR SELECT USING (true);

CREATE POLICY "Users can follow others"
  ON follows FOR INSERT
  WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow"
  ON follows FOR DELETE
  USING (auth.uid() = follower_id);

-- ── Backfill: create profile rows for users who signed up before Phase 2 ─────
INSERT INTO public.profiles (id)
SELECT id FROM auth.users
ON CONFLICT (id) DO NOTHING;
