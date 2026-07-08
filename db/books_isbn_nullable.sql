-- BookSharez — allow catalog books without an ISBN (July 7, 2026)
-- Apply in the Supabase SQL Editor.
--
-- Why: the scanner's cover path (improvement plan §3.0 cover-path parity)
-- surfaces pre-ISBN era books — ISBNs only exist for books published after
-- ~1970, and heavy bookshelves are full of older ones. Those books must be
-- shelvable and listable like any other.
--
-- The UNIQUE constraint on isbn stays: Postgres UNIQUE permits any number of
-- NULLs, so ISBN dedup is unaffected. Client-side, no-ISBN books are deduped
-- best-effort by exact title+author before insert (js/main.js
-- _addScannedToShelf), and listings reference books.id — nothing keys on isbn
-- for these rows.
--
-- Until this is applied, adding a no-ISBN book fails with the generic
-- "Couldn't save book" alert (NOT NULL violation) — nothing else breaks.

ALTER TABLE books ALTER COLUMN isbn DROP NOT NULL;

-- ── Manual test ───────────────────────────────────────────────────────────────
-- 1. In the app: scanner → "Read Book Cover" with an old barcode-less book
--    (or any cover photo whose match candidates include one without an ISBN).
-- 2. Confirm the no-ISBN candidate → found screen → "Add & List for Sale".
-- 3. SELECT id, isbn, title FROM books WHERE isbn IS NULL;  → the new row.
-- 4. The pre-filled sell form submits fine with the ISBN field empty.
