-- BookSharez — demo seed data (Step 1: buyer-side browse/search)
-- Run in the Supabase SQL editor AFTER db/schema.sql.
--
-- Creates one demo seller and 6 ACTIVE listings (mirroring the old hardcoded
-- homepage books) so the Supabase-backed grid + search have real data to show
-- before the sell flow persists listings (Step 2).
--
-- Idempotent: re-running replaces the demo seller + demo books/listings.
-- A CLEANUP block at the bottom removes the seed when you no longer want it.
-- NOTE: the ISBNs below are placeholders (no real lookup yet) — fine for a demo.

-- 1) Reset any prior seed -----------------------------------------------------
DELETE FROM auth.users WHERE id = '00000000-0000-4000-a000-0000000000d0';
  -- ^ cascades to the demo listings
DELETE FROM books WHERE id IN (
  '00000000-0000-4000-b000-0000000000d1',
  '00000000-0000-4000-b000-0000000000d2',
  '00000000-0000-4000-b000-0000000000d3',
  '00000000-0000-4000-b000-0000000000d4',
  '00000000-0000-4000-b000-0000000000d5',
  '00000000-0000-4000-b000-0000000000d6'
);

-- 2) Demo seller (FK target for the listings) ---------------------------------
INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-a000-0000000000d0',
   'authenticated','authenticated','demo_seller@booksharez.seed','',
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}','{}','','','','');

-- 3) Demo books (canonical catalog rows) --------------------------------------
INSERT INTO books (id, isbn, title, author, cover_url) VALUES
  ('00000000-0000-4000-b000-0000000000d1','9780000000001','The Great Gatsby','F. Scott Fitzgerald','https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=300&h=400&fit=crop'),
  ('00000000-0000-4000-b000-0000000000d2','9780000000002','To Kill a Mockingbird','Harper Lee','https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=300&h=400&fit=crop'),
  ('00000000-0000-4000-b000-0000000000d3','9780000000003','1984','George Orwell','https://images.unsplash.com/photo-1512820790803-83ca734da794?w=300&h=400&fit=crop'),
  ('00000000-0000-4000-b000-0000000000d4','9780000000004','Pride and Prejudice','Jane Austen','https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=300&h=400&fit=crop'),
  ('00000000-0000-4000-b000-0000000000d5','9780000000005','The Catcher in the Rye','J.D. Salinger','https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=300&h=400&fit=crop'),
  ('00000000-0000-4000-b000-0000000000d6','9780000000006','Harry Potter and the Sorcerer''s Stone','J.K. Rowling','https://images.unsplash.com/photo-1621351183012-e2f9972dd9bf?w=300&h=400&fit=crop');

-- 4) Demo listings (all active, owned by the demo seller) ---------------------
INSERT INTO listings (id, user_id, book_id, price, condition, status) VALUES
  ('00000000-0000-4000-c000-0000000000d1','00000000-0000-4000-a000-0000000000d0','00000000-0000-4000-b000-0000000000d1',12.99,'very_good','active'),
  ('00000000-0000-4000-c000-0000000000d2','00000000-0000-4000-a000-0000000000d0','00000000-0000-4000-b000-0000000000d2',15.50,'good','active'),
  ('00000000-0000-4000-c000-0000000000d3','00000000-0000-4000-a000-0000000000d0','00000000-0000-4000-b000-0000000000d3',10.75,'like_new','active'),
  ('00000000-0000-4000-c000-0000000000d4','00000000-0000-4000-a000-0000000000d0','00000000-0000-4000-b000-0000000000d4',14.25,'good','active'),
  ('00000000-0000-4000-c000-0000000000d5','00000000-0000-4000-a000-0000000000d0','00000000-0000-4000-b000-0000000000d5',11.99,'acceptable','active'),
  ('00000000-0000-4000-c000-0000000000d6','00000000-0000-4000-a000-0000000000d0','00000000-0000-4000-b000-0000000000d6',18.00,'very_good','active');

-- ============================================================================
-- CLEANUP (run this block by itself to remove the demo data)
-- ----------------------------------------------------------------------------
-- DELETE FROM auth.users WHERE id = '00000000-0000-4000-a000-0000000000d0';
-- DELETE FROM books WHERE id IN (
--   '00000000-0000-4000-b000-0000000000d1','00000000-0000-4000-b000-0000000000d2',
--   '00000000-0000-4000-b000-0000000000d3','00000000-0000-4000-b000-0000000000d4',
--   '00000000-0000-4000-b000-0000000000d5','00000000-0000-4000-b000-0000000000d6');
-- ============================================================================
