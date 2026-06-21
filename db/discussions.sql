-- Phase 2: Per-book flat discussion posts
-- Run in Supabase SQL Editor (no dependencies beyond the Phase 2 schema).

CREATE TABLE discussion_posts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id    UUID REFERENCES books(id) ON DELETE CASCADE NOT NULL,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  body       TEXT NOT NULL CHECK (char_length(body) >= 1 AND char_length(body) <= 2000),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_discussion_posts_book_id ON discussion_posts(book_id);
CREATE INDEX idx_discussion_posts_user_id ON discussion_posts(user_id);

ALTER TABLE discussion_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Discussion posts are publicly readable"
  ON discussion_posts FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can post"
  ON discussion_posts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own posts"
  ON discussion_posts FOR DELETE
  USING (auth.uid() = user_id);
