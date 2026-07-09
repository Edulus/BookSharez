-- BookSharez — remove the June 15 demo seed data (db/seed.sql) from production.
-- Run in the Supabase SQL editor. Safe to run once; re-running is a no-op if
-- the seed is already gone.
--
-- Why: the 6 seed books (Gatsby, Mockingbird, 1984, Pride and Prejudice,
-- Catcher in the Rye, Harry Potter) used random Unsplash stock photos as
-- placeholder cover_url values. They're indistinguishable from real listings
-- once live, so a real user sees a stranger's stock-photo "book" mixed into
-- genuine peer-to-peer inventory — undermines the Phase 1 trust story
-- (see docs/BOOKSHAREZ_PRODUCT_VISION.md). Found July 9 while looking at a
-- live screenshot: the seed's "Catcher in the Rye" card visibly used a
-- generic stock photo instead of real cover art.
--
-- Deleting the seed auth.users row cascades to its 6 listings (and any
-- listing_photos on them) via `listings.user_id ... ON DELETE CASCADE`
-- (db/schema.sql) and to its profiles row via the same cascade
-- (db/phase2_schema.sql) — no separate DELETE needed for either.
-- The 6 books are deleted afterward now that nothing references them.
--
-- CAVEAT: if a real user has since added one of these 6 seed books (by
-- title/ISBN match) to their own Have/Want shelf, that shelf_entries row
-- cascades away too (`shelf_entries.book_id ... ON DELETE CASCADE`). Given
-- the catalog's current size this is a small, acceptable blast radius — but
-- worth knowing before you run this.

DELETE FROM auth.users WHERE id = '00000000-0000-4000-a000-0000000000d0';

DELETE FROM books WHERE id IN (
  '00000000-0000-4000-b000-0000000000d1',
  '00000000-0000-4000-b000-0000000000d2',
  '00000000-0000-4000-b000-0000000000d3',
  '00000000-0000-4000-b000-0000000000d4',
  '00000000-0000-4000-b000-0000000000d5',
  '00000000-0000-4000-b000-0000000000d6'
);

-- ── Manual verification (run after the DELETEs above) ────────────────────────
-- Both should return 0 rows:
--   SELECT * FROM books WHERE id::text LIKE '00000000-0000-4000-b000-%';
--   SELECT * FROM listings WHERE user_id = '00000000-0000-4000-a000-0000000000d0';
