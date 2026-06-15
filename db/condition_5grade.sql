-- Switch listings.condition from 4 grades to 5 (June 15, 2026):
--   like_new, very_good, good, fair, poor   (was: ...good, acceptable)
-- Run once in the Supabase SQL editor.

BEGIN;

-- Existing 'acceptable' rows map to 'fair' (closest of the new bottom grades).
UPDATE listings SET condition = 'fair' WHERE condition = 'acceptable';

-- Replace the CHECK constraint with the 5-grade set.
ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_condition_check;
ALTER TABLE listings ADD CONSTRAINT listings_condition_check
  CHECK (condition IN ('like_new', 'very_good', 'good', 'fair', 'poor'));

COMMIT;
