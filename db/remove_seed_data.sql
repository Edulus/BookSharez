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
-- Seed books are deleted afterward only when no real activity references them.
--
-- Real users' listings, shelf entries, and discussion posts are preserved. A
-- seed catalog row that has acquired any such reference remains in `books`.

-- Preview real activity attached to seed books. The cleanup below preserves
-- any book shown here with a nonzero reference count.
SELECT b.id, b.title,
  (SELECT count(*) FROM listings l WHERE l.book_id = b.id AND l.user_id <> '00000000-0000-4000-a000-0000000000d0') AS real_listings,
  (SELECT count(*) FROM shelf_entries se WHERE se.book_id = b.id AND se.user_id <> '00000000-0000-4000-a000-0000000000d0') AS real_shelf_entries,
  (SELECT count(*) FROM discussion_posts dp WHERE dp.book_id = b.id) AS discussion_posts
FROM books b
WHERE b.id::text LIKE '00000000-0000-4000-b000-%';

DELETE FROM auth.users WHERE id = '00000000-0000-4000-a000-0000000000d0';

DELETE FROM books b WHERE b.id IN (
  '00000000-0000-4000-b000-0000000000d1',
  '00000000-0000-4000-b000-0000000000d2',
  '00000000-0000-4000-b000-0000000000d3',
  '00000000-0000-4000-b000-0000000000d4',
  '00000000-0000-4000-b000-0000000000d5',
  '00000000-0000-4000-b000-0000000000d6'
)
AND NOT EXISTS (SELECT 1 FROM listings l WHERE l.book_id = b.id)
AND NOT EXISTS (SELECT 1 FROM shelf_entries se WHERE se.book_id = b.id)
AND NOT EXISTS (SELECT 1 FROM discussion_posts dp WHERE dp.book_id = b.id);

-- ── Manual verification (run after the DELETEs above) ────────────────────────
-- The demo seller/listings should return 0 rows. A seed book may remain only
-- when the preview showed real activity attached to it:
--   SELECT * FROM books WHERE id::text LIKE '00000000-0000-4000-b000-%';
--   SELECT * FROM listings WHERE user_id = '00000000-0000-4000-a000-0000000000d0';
