-- BookSharez — catalog (books) write hardening (§6.1, July 7 2026)
-- Apply in the Supabase SQL Editor.
--
-- Threat model: `books` is SHARED data — one row per ISBN serves every seller
-- and every shelf. The Phase-1 simplification lets any authenticated user
-- INSERT catalog rows (so the sell/scanner flows work without an Edge
-- Function round-trip). What must never be possible from a browser:
--   • UPDATE/DELETE of existing rows (rewriting a canonical title/author/
--     cover/ISBN corrupts the catalog for everyone)
--   • garbage INSERTs (empty titles, malformed ISBNs)
--
-- RLS state after schema.sql: SELECT public, INSERT for authenticated,
-- and NO UPDATE/DELETE policies — with RLS enabled, absence of a policy
-- means DENIED, which is exactly what we want. This file therefore:
--   1. asserts that state (fails loudly if someone added a write policy),
--   2. adds CHECK constraints so INSERTs can't be garbage,
--   3. documents that all client code is append-only (the last client
--      upsert — scanner shelf-add — was replaced with select→insert July 7).
-- Server-side writers (isbn-lookup, book-enrichment Edge Functions) use the
-- service role and bypass RLS; they are unaffected.

-- ── 1. Assert: no client UPDATE/DELETE policies exist on books ───────────────
DO $$
DECLARE bad_policy TEXT;
BEGIN
  SELECT policyname INTO bad_policy
  FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'books'
    AND cmd IN ('UPDATE', 'DELETE', 'ALL')
  LIMIT 1;
  IF bad_policy IS NOT NULL THEN
    RAISE EXCEPTION 'books has a client write policy (%) — review before proceeding', bad_policy;
  END IF;
  RAISE NOTICE 'OK: books has no UPDATE/DELETE policies (writes denied by RLS).';
END $$;

-- ── 2. Integrity constraints on INSERT ────────────────────────────────────────
-- NOT VALID = enforced for new rows only; existing rows are grandfathered
-- (run the validation queries below when convenient).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.books'::regclass AND conname = 'books_title_length') THEN
    ALTER TABLE books ADD CONSTRAINT books_title_length
      CHECK (char_length(btrim(title)) BETWEEN 1 AND 500) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.books'::regclass AND conname = 'books_author_length') THEN
    ALTER TABLE books ADD CONSTRAINT books_author_length
      CHECK (author IS NULL OR char_length(author) <= 500) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.books'::regclass AND conname = 'books_isbn_format') THEN
    ALTER TABLE books ADD CONSTRAINT books_isbn_format
      CHECK (isbn IS NULL OR isbn ~ '^[0-9]{13}$' OR isbn ~ '^[0-9]{9}[0-9Xx]$') NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.books'::regclass AND conname = 'books_cover_url_length') THEN
    ALTER TABLE books ADD CONSTRAINT books_cover_url_length
      CHECK (cover_url IS NULL OR char_length(cover_url) <= 2000) NOT VALID;
  END IF;
END $$;

-- Optional: validate existing rows too (fails if legacy data violates —
-- fix the rows, then re-run):
-- ALTER TABLE books VALIDATE CONSTRAINT books_title_length;
-- ALTER TABLE books VALIDATE CONSTRAINT books_author_length;
-- ALTER TABLE books VALIDATE CONSTRAINT books_isbn_format;
-- ALTER TABLE books VALIDATE CONSTRAINT books_cover_url_length;

-- ── Manual test ───────────────────────────────────────────────────────────────
-- In the SQL editor (runs as postgres, so use the impersonation block):
--   SET LOCAL ROLE authenticated;  -- inside a transaction
--   UPDATE books SET title = 'corrupted' WHERE isbn IS NOT NULL;  -- expect 0 rows
-- Or from the app console (anon/authed client):
--   await supabaseClient.from('books').update({ title: 'x' }).eq('isbn', '<some isbn>')
--   → error or 0 rows affected. verify-rls-live.js automates the anon checks.
