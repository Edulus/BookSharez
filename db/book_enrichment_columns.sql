-- Hardcover enrichment columns for the books table.
-- Run in Supabase SQL Editor after reviewing.
--
-- All columns are nullable: enrichment is optional and lazy. The book-enrichment
-- Edge Function fills these from the Hardcover API on first detail-page view and
-- re-fetches when hc_enriched_at is older than 30 days.

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS description      TEXT,
  ADD COLUMN IF NOT EXISTS hc_rating        DECIMAL(3,2),
  ADD COLUMN IF NOT EXISTS hc_rating_count  INTEGER,
  ADD COLUMN IF NOT EXISTS hc_users_read    INTEGER,
  ADD COLUMN IF NOT EXISTS hc_genres        JSONB,
  ADD COLUMN IF NOT EXISTS hc_series_name   TEXT,
  ADD COLUMN IF NOT EXISTS hc_series_pos    DECIMAL(5,1),
  ADD COLUMN IF NOT EXISTS hc_slug          TEXT,
  ADD COLUMN IF NOT EXISTS hc_book_category TEXT,
  ADD COLUMN IF NOT EXISTS hc_enriched_at   TIMESTAMPTZ;

-- No index needed on hc_enriched_at — it is only read per-row during a detail view.
