-- BookSharez — RLS policy test harness  (ToDo item 5)
-- Run in the Supabase SQL editor AFTER db/schema.sql has been applied.
--
-- Why this is non-trivial: the SQL editor runs as `postgres`, which BYPASSES
-- RLS entirely. To actually exercise the policies we must switch into the
-- `anon` / `authenticated` roles and forge a JWT `sub` claim so auth.uid()
-- returns our test user's id — exactly how a real browser request is evaluated.
--
-- The script is idempotent: it deletes its own fixtures first, so you can
-- re-run it freely. It leaves the two test users in place so you can inspect;
-- a CLEANUP block at the very bottom removes them when you're done.
--
-- EXPECTED RESULT: a table of 8 tests, all showing PASS.

-- Fixed fixture UUIDs (valid v4-shaped, easy to clean up) ---------------------
--   UA = ...00aa   UB = ...00bb   book = ...00b0   L1(active) ...0011   L2(removed) ...0022

-- 1) Reset any prior run ------------------------------------------------------
DELETE FROM auth.users WHERE id IN (
  '00000000-0000-4000-a000-0000000000aa',
  '00000000-0000-4000-a000-0000000000bb'
);                                  -- cascades to listings + listing_photos
DELETE FROM books WHERE id = '00000000-0000-4000-b000-0000000000b0';

-- 2) Seed two users (direct insert into auth.users; postgres only) ------------
INSERT INTO auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
   confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-a000-0000000000aa',
   'authenticated','authenticated','user_a@test.booksharez','',
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}','{}','','','',''),
  ('00000000-0000-0000-0000-000000000000',
   '00000000-0000-4000-a000-0000000000bb',
   'authenticated','authenticated','user_b@test.booksharez','',
   now(), now(), now(),
   '{"provider":"email","providers":["email"]}','{}','','','','');

-- 3) Seed a book, UA's listings (one active, one removed), and photos ---------
INSERT INTO books (id, isbn, title, author)
VALUES ('00000000-0000-4000-b000-0000000000b0','9990000000001','RLS Test Book','Test Author');

INSERT INTO listings (id, user_id, book_id, price, condition, status)
VALUES
  ('00000000-0000-4000-c000-000000000011','00000000-0000-4000-a000-0000000000aa',
   '00000000-0000-4000-b000-0000000000b0', 10.00, 'good', 'active'),
  ('00000000-0000-4000-c000-000000000022','00000000-0000-4000-a000-0000000000aa',
   '00000000-0000-4000-b000-0000000000b0', 12.00, 'good', 'removed');

INSERT INTO listing_photos (id, listing_id, photo_url, display_order)
VALUES
  (gen_random_uuid(),'00000000-0000-4000-c000-000000000011','listing-photos/active/1.jpg',0),
  (gen_random_uuid(),'00000000-0000-4000-c000-000000000022','listing-photos/removed/1.jpg',0);

-- 4) Results sink -------------------------------------------------------------
DROP TABLE IF EXISTS rls_test_results;
CREATE TEMP TABLE rls_test_results (seq int, test text, expected text, got text, pass boolean);

-- 5) Run the tests under the real roles ---------------------------------------
DO $$
DECLARE
  UA  uuid := '00000000-0000-4000-a000-0000000000aa';
  UB  uuid := '00000000-0000-4000-a000-0000000000bb';
  bk  uuid := '00000000-0000-4000-b000-0000000000b0';
  L1  uuid := '00000000-0000-4000-c000-000000000011';  -- active
  L2  uuid := '00000000-0000-4000-c000-000000000022';  -- removed
  n   int;
  ok  boolean;
BEGIN
  -- helper note: become_role sets role + forged JWT claims
  -- T1: anon sees only the ACTIVE listing
  EXECUTE 'set role anon';
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, false);
  SELECT count(*) INTO n FROM listings WHERE id IN (L1, L2);
  EXECUTE 'reset role';
  INSERT INTO rls_test_results VALUES
    (1,'anon sees only active listings','1 (L1)', n||' visible', n = 1);

  -- T2: another logged-in user (UB) also sees only the active listing
  EXECUTE 'set role authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',UB::text,'role','authenticated')::text, false);
  SELECT count(*) INTO n FROM listings WHERE id IN (L1, L2);
  EXECUTE 'reset role';
  INSERT INTO rls_test_results VALUES
    (2,'other user sees only active listings','1 (L1)', n||' visible', n = 1);

  -- T3: the OWNER (UA) sees their own removed listing too
  EXECUTE 'set role authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',UA::text,'role','authenticated')::text, false);
  SELECT count(*) INTO n FROM listings WHERE id IN (L1, L2);
  EXECUTE 'reset role';
  INSERT INTO rls_test_results VALUES
    (3,'owner sees own active + removed','2 (L1+L2)', n||' visible', n = 2);

  -- T4: non-owner (UB) cannot UPDATE someone else's listing
  EXECUTE 'set role authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',UB::text,'role','authenticated')::text, false);
  UPDATE listings SET price = 99.99 WHERE id = L1;
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'reset role';
  INSERT INTO rls_test_results VALUES
    (4,'non-owner UPDATE blocked','0 rows', n||' rows', n = 0);

  -- T5: non-owner (UB) cannot DELETE someone else's listing
  EXECUTE 'set role authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',UB::text,'role','authenticated')::text, false);
  DELETE FROM listings WHERE id = L1;
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'reset role';
  INSERT INTO rls_test_results VALUES
    (5,'non-owner DELETE blocked','0 rows', n||' rows', n = 0);

  -- T6: the owner (UA) CAN update their own listing
  EXECUTE 'set role authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub',UA::text,'role','authenticated')::text, false);
  UPDATE listings SET price = 11.00 WHERE id = L1;
  GET DIAGNOSTICS n = ROW_COUNT;
  EXECUTE 'reset role';
  INSERT INTO rls_test_results VALUES
    (6,'owner UPDATE allowed','1 row', n||' rows', n = 1);

  -- T7: a user cannot insert a listing spoofing someone else's user_id
  --     (WITH CHECK auth.uid() = user_id should raise an RLS violation)
  ok := false;
  BEGIN
    EXECUTE 'set role authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub',UB::text,'role','authenticated')::text, false);
    INSERT INTO listings (user_id, book_id, price, condition, status)
    VALUES (UA, bk, 5.00, 'good', 'active');   -- UB claims to be UA -> must fail
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    ok := true;                                 -- RLS rejected it as expected
  END;
  EXECUTE 'reset role';
  INSERT INTO rls_test_results VALUES
    (7,'INSERT with spoofed user_id blocked','rejected', CASE WHEN ok THEN 'rejected' ELSE 'allowed!' END, ok);

  -- T8: anon sees photos for active listing only, not the removed one
  EXECUTE 'set role anon';
  PERFORM set_config('request.jwt.claims', json_build_object('role','anon')::text, false);
  SELECT count(*) INTO n FROM listing_photos WHERE listing_id IN (L1, L2);
  EXECUTE 'reset role';
  INSERT INTO rls_test_results VALUES
    (8,'anon sees photos of active listing only','1 (L1 photo)', n||' visible', n = 1);

  PERFORM set_config('request.jwt.claims', '', false);
END $$;

-- 6) Report -------------------------------------------------------------------
SELECT seq,
       test,
       expected,
       got,
       CASE WHEN pass THEN 'PASS' ELSE '*** FAIL ***' END AS result
FROM rls_test_results
ORDER BY seq;

-- ============================================================================
-- CLEANUP (optional — run this block by itself once you're satisfied)
-- ----------------------------------------------------------------------------
-- DELETE FROM auth.users WHERE id IN (
--   '00000000-0000-4000-a000-0000000000aa',
--   '00000000-0000-4000-a000-0000000000bb');
-- DELETE FROM books WHERE id = '00000000-0000-4000-b000-0000000000b0';
-- ============================================================================
