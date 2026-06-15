-- BookSharez Phase 1 — Database schema
-- Source of truth: docs/PHASE_1_MVP_SPEC.md (tables/indexes/RLS are copied verbatim).
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query → Run).
--
-- NOTE: The spec uses uuid_generate_v4(), which requires the uuid-ossp extension.
-- The line below enables it so the spec SQL runs as-is. (Supabase also ships
-- gen_random_uuid() via pgcrypto if you ever prefer that instead.)
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

-- Books table
CREATE TABLE books (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  isbn VARCHAR(13) UNIQUE NOT NULL,
  isbn10 VARCHAR(10),
  title TEXT NOT NULL,
  author TEXT,
  publisher TEXT,
  publish_date DATE,
  cover_url TEXT,
  page_count INTEGER,
  language VARCHAR(10) DEFAULT 'en',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Listings table
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE NOT NULL,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0.01),
  condition TEXT NOT NULL CHECK (condition IN ('like_new', 'very_good', 'good', 'fair', 'poor')),
  description TEXT CHECK (char_length(description) <= 500),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'sold', 'removed')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Listing photos table
CREATE TABLE listing_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE NOT NULL,
  photo_url TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_listings_user_id ON listings(user_id);
CREATE INDEX idx_listings_book_id ON listings(book_id);
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_created_at ON listings(created_at DESC);
CREATE INDEX idx_books_isbn ON books(isbn);
CREATE INDEX idx_listing_photos_listing_id ON listing_photos(listing_id);

-- Full text search (for book titles/authors)
CREATE INDEX idx_books_title_search ON books USING gin(to_tsvector('english', title));
CREATE INDEX idx_books_author_search ON books USING gin(to_tsvector('english', author));

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_photos ENABLE ROW LEVEL SECURITY;

-- books: deliberate deviation from the verbatim spec (which left books without
-- RLS). With RLS off, the anon key could WRITE to books, not just read. Instead
-- we enable RLS and grant PUBLIC READ. (June 14, 2026)
-- Writes: anon cannot write. Authenticated users may INSERT (Step 2, June 15) so
-- the browser sell flow can add a catalog book for a new ISBN before the
-- isbn-lookup Edge Function exists — a documented Phase-1 simplification, to be
-- moved server-side later. UPDATE/DELETE on books remain unavailable to clients.
ALTER TABLE books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read books"
  ON books FOR SELECT
  USING (true);

CREATE POLICY "Authenticated users can add books"
  ON books FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can insert their own listings"
  ON listings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view all active listings"
  ON listings FOR SELECT
  USING (status = 'active' OR auth.uid() = user_id);

CREATE POLICY "Users can update their own listings"
  ON listings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own listings"
  ON listings FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view listing photos for active listings"
  ON listing_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM listings
      WHERE listings.id = listing_photos.listing_id
      AND (listings.status = 'active' OR listings.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert photos for their listings"
  ON listing_photos FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM listings
      WHERE listings.id = listing_photos.listing_id
      AND listings.user_id = auth.uid()
    )
  );

-- ============================================================
-- STORAGE POLICIES  (source: docs/SECURITY_CHECKLIST.md)
-- ============================================================
-- PREREQUISITE: first create a Storage bucket named `listing-photos`
--   (Dashboard → Storage → New bucket), with these settings (June 14, 2026):
--     • Public bucket:      OFF  (private — reads governed by the RLS policy
--                                 below, which limits them to active listings;
--                                 a public bucket would bypass that)
--     • Restrict file size: ON, 5 MB (5242880 bytes) — matches the spec's cap
--     • Restrict MIME types: ON — allow only image/jpeg, image/png, image/webp
--   Then run the two policies below.
--   Note: because the bucket is private, the app serves photos via the
--   authenticated Supabase client or signed URLs, not plain public URLs.
-- The `books` table has RLS enabled with a public read-only policy (see above):
-- metadata is publicly readable, but only the service-role Edge Function writes.

CREATE POLICY "Public read access to listing photos"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'listing-photos' AND
  EXISTS (
    SELECT 1 FROM listings
    WHERE listings.id::text = (storage.foldername(name))[1]
    AND listings.status = 'active'
  )
);

CREATE POLICY "Users can upload to their listings"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'listing-photos' AND
  EXISTS (
    SELECT 1 FROM listings
    WHERE listings.id::text = (storage.foldername(name))[1]
    AND listings.user_id = auth.uid()
  )
);
