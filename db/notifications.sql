-- BookSharez — Notifications rail + want-match trigger (improvement plan §5.4 / §3.1)
-- Apply in Supabase SQL Editor AFTER phase2_schema.sql is live.
--
-- One generic notifications table serves every future notification type
-- (want-match now; "interested" pings, follows, mentions, discussion replies
-- later) so each new feature only adds a trigger + a client renderer, not a
-- table. Clients can read/update/delete ONLY their own rows; they can never
-- INSERT — rows are created exclusively by SECURITY DEFINER triggers.

-- ── notifications ─────────────────────────────────────────────────────────────

CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL, -- recipient
  type         TEXT NOT NULL CHECK (type IN
                 ('want_match', 'interested', 'follow', 'mention', 'discussion_reply')),
  actor_id     UUID REFERENCES auth.users(id) ON DELETE SET NULL,         -- who caused it
  subject_type TEXT NOT NULL CHECK (subject_type IN
                 ('listing', 'book', 'profile', 'discussion_post')),
  subject_id   UUID NOT NULL,             -- id of the subject row (no FK: polymorphic)
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb, -- denormalized display data
  read_at      TIMESTAMP,                 -- null = unread
  created_at   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_user_unread  ON notifications(user_id) WHERE read_at IS NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON notifications FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can mark their own notifications read"
  ON notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own notifications"
  ON notifications FOR DELETE
  USING (auth.uid() = user_id);

-- Deliberately NO INSERT policy: clients cannot forge notifications. Inserts
-- happen only inside SECURITY DEFINER trigger functions (below), which run as
-- the function owner and bypass RLS.

-- ── want-match trigger ────────────────────────────────────────────────────────
-- When a listing goes live, notify every user who has that book on their
-- "want" shelf (except the seller). Payload carries everything the bell
-- dropdown needs to render without extra queries.
--
-- v1 notes:
--  • Fires on INSERT only. The app never flips a listing back to 'active'
--    (mark-sold is one-way, no relist feature); add an UPDATE trigger if
--    relisting ever ships.
--  • No dedupe: three copies listed = three notifications. Acceptable at
--    campus scale; revisit if it feels spammy.

CREATE OR REPLACE FUNCTION public.notify_want_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO notifications (user_id, type, actor_id, subject_type, subject_id, payload)
  SELECT
    se.user_id,
    'want_match',
    NEW.user_id,
    'listing',
    NEW.id,
    jsonb_build_object(
      'book_id',         NEW.book_id,
      'title',           b.title,
      'author',          b.author,
      'price',           NEW.price,
      'seller_username', p.username
    )
  FROM shelf_entries se
  JOIN books b ON b.id = NEW.book_id
  LEFT JOIN profiles p ON p.id = NEW.user_id
  WHERE se.book_id = NEW.book_id
    AND se.shelf_type = 'want'
    AND se.user_id <> NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_listing_want_match
  AFTER INSERT ON listings
  FOR EACH ROW
  WHEN (NEW.status = 'active')
  EXECUTE PROCEDURE public.notify_want_match();

-- ── Manual test (run as yourself in the SQL editor after applying) ───────────
-- 1. With user A, add a book to "Books I Want" in the app.
-- 2. With user B, list that same book for sale.
-- 3. SELECT * FROM notifications;  → user A has one 'want_match' row whose
--    payload shows the title/price, subject_id = the new listing id.
-- 4. Log in as user A in the app → bell shows a badge; clicking the entry
--    opens #/listing/<subject_id>.
