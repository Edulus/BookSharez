-- BookSharez — allow logged-in users to add catalog books (persistence Step 2)
-- Run once in the Supabase SQL editor.
--
-- Why: listing a book must create its `books` row if the ISBN is new. Until the
-- isbn-lookup Edge Function exists, we let authenticated users insert books
-- directly from the browser. This is a deliberate, documented Phase-1
-- simplification of the original "service-role-only catalog writes" rule — to be
-- hardened (moved server-side) when that Edge Function is built. Reads stay
-- public; anon still cannot write; UPDATE/DELETE on books remain unavailable to
-- clients (the sell flow reuses existing rows rather than editing them).

CREATE POLICY "Authenticated users can add books"
  ON books FOR INSERT
  TO authenticated
  WITH CHECK (true);
