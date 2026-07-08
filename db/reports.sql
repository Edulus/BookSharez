-- BookSharez — content reporting (§6.2, July 7 2026)
-- Apply in the Supabase SQL Editor.
--
-- Lightweight moderation intake: any logged-in user can flag a listing, a
-- profile, or a discussion post. Review happens in the Supabase dashboard for
-- now (SELECT * FROM reports WHERE status = 'open' ORDER BY created_at) —
-- a full admin UI comes later. The `snapshot` JSONB captures what the
-- reporter saw at report time, so a report stays actionable even if the
-- subject is later edited or deleted.

CREATE TABLE reports (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id  UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('listing', 'profile', 'discussion_post')),
  subject_id   UUID NOT NULL,             -- id of the reported row (no FK: polymorphic, and the subject may be deleted)
  reason       TEXT NOT NULL CHECK (reason IN ('spam', 'inappropriate', 'misleading', 'harassment', 'other')),
  details      TEXT CHECK (char_length(details) <= 1000),
  snapshot     JSONB NOT NULL DEFAULT '{}'::jsonb, -- what the reporter saw (title/username/text excerpt…)
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at   TIMESTAMP DEFAULT NOW(),
  -- one report per user per subject — repeat taps say "already reported"
  UNIQUE (reporter_id, subject_type, subject_id)
);

CREATE INDEX idx_reports_status_created ON reports(status, created_at DESC);
CREATE INDEX idx_reports_subject ON reports(subject_type, subject_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- Logged-in users can file reports as themselves. That is the ONLY client
-- capability: no SELECT (reports aren't public and reporters don't need to
-- browse their own), no UPDATE/DELETE (moderation state changes happen in
-- the dashboard with the service role).
CREATE POLICY "Users can file reports"
  ON reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- ── Moderation queries (run in the dashboard) ─────────────────────────────────
-- Open queue:      SELECT * FROM reports WHERE status = 'open' ORDER BY created_at;
-- Resolve one:     UPDATE reports SET status = 'resolved' WHERE id = '<id>';
-- Repeat offender: SELECT snapshot->>'owner_id', count(*) FROM reports GROUP BY 1 ORDER BY 2 DESC;

-- ── Manual test ───────────────────────────────────────────────────────────────
-- 1. In the app (logged in): open any listing → "Report" → pick a reason → submit.
-- 2. SELECT subject_type, reason, snapshot FROM reports;  → the row, with the
--    listing title/seller captured in snapshot.
-- 3. Report the same listing again → app says "already reported" (UNIQUE).
