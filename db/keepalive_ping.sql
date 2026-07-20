-- BookSharez — Supabase auto-pause keepalive marker
--
-- Apply once in the Supabase SQL Editor before running the keep-alive workflow.
-- Safe to rerun: the table, function, trigger, grants, and policies are all
-- created or replaced idempotently.
--
-- This records a genuine database write but is not a guaranteed auto-pause
-- workaround: Supabase's "sufficient activity" threshold is undocumented. The
-- previous authenticated books-table SELECT ran every 3 days and did not stop
-- a pause. The replacement runs daily, but success must still be evaluated over
-- at least one 7-day window.
--
-- The GitHub Actions workflow authenticates with the project's publishable /
-- anon key. RLS therefore permits the `anon` role to INSERT and SELECT only on
-- this dedicated, non-sensitive table. It receives no UPDATE or DELETE access,
-- and this script does not change any existing application table or policy.

CREATE TABLE IF NOT EXISTS public.keepalive_ping (
  id BIGSERIAL PRIMARY KEY,
  pinged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.keepalive_ping ENABLE ROW LEVEL SECURITY;

-- Supabase normally grants broad defaults on new public-schema objects. Replace
-- those defaults here with the two operations the workflow actually needs.
REVOKE ALL ON TABLE public.keepalive_ping FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.keepalive_ping TO anon;

REVOKE ALL ON SEQUENCE public.keepalive_ping_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.keepalive_ping_id_seq TO anon;

DROP POLICY IF EXISTS "Keepalive anon read" ON public.keepalive_ping;
CREATE POLICY "Keepalive anon read"
  ON public.keepalive_ping
  FOR SELECT
  TO anon
  USING (true);

DROP POLICY IF EXISTS "Keepalive anon insert" ON public.keepalive_ping;
CREATE POLICY "Keepalive anon insert"
  ON public.keepalive_ping
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Keep only a rolling seven-day audit trail. Cleanup runs inside the database
-- after each successful ping, without granting DELETE to the workflow key.
CREATE OR REPLACE FUNCTION public.prune_keepalive_ping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.keepalive_ping
  WHERE pinged_at < NOW() - INTERVAL '7 days';

  -- Return value is ignored for an AFTER STATEMENT trigger.
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS prune_keepalive_ping_after_insert
  ON public.keepalive_ping;

CREATE TRIGGER prune_keepalive_ping_after_insert
  AFTER INSERT ON public.keepalive_ping
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.prune_keepalive_ping();

-- Verification after workflow_dispatch:
-- SELECT id, pinged_at
-- FROM public.keepalive_ping
-- ORDER BY id DESC
-- LIMIT 10;
