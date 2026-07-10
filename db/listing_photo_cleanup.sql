-- BookSharez — permit owners to clean up listing photo rows and objects.
-- Apply in Supabase SQL Editor before deploying the matching client change.
-- Safe to rerun.

-- Metadata rows: owners may remove photos belonging to their own listings.
DROP POLICY IF EXISTS "Users can delete photos for their listings" ON listing_photos;
CREATE POLICY "Users can delete photos for their listings"
  ON listing_photos FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM listings
      WHERE listings.id = listing_photos.listing_id
        AND listings.user_id = auth.uid()
    )
  );

-- Storage objects: the first path segment is the owning listing UUID.
DROP POLICY IF EXISTS "Users can delete photos for their listings" ON storage.objects;
CREATE POLICY "Users can delete photos for their listings"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'listing-photos' AND
    EXISTS (
      SELECT 1 FROM listings
      WHERE listings.id::text = (storage.foldername(name))[1]
        AND listings.user_id = auth.uid()
    )
  );

-- Manual verification:
-- 1. Apply this file, then create a listing with photos.
-- 2. Mark it sold; its folder in Storage and listing_photos rows should vanish.
-- 3. Create another listing with photos, then delete it; verify the same.
