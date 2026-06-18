// Supabase client initialisation for BookSharez (browser / vanilla JS).
//
// Only the project URL and the PUBLISHABLE (anon) key belong here. Both are
// safe to ship to the browser — data is protected server-side by Row Level
// Security. The SECRET / service-role key must NEVER appear in this file or any
// other client-served script; it lives only in .env for server-side use.
//
// Requires the Supabase JS v2 library to be loaded first, e.g. add this to
// index.html BEFORE this script:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

const SUPABASE_URL = "https://kkmxdemnbuyuxnrezxmn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_EDLFcVTYmQwuRKc-Ia6yrQ_KVgZWYQK";
// Google Books key removed from client-side code — set as Supabase Edge Function secret instead.

// The CDN library exposes a global `supabase` object with createClient().
// Expose our initialised client as `supabaseClient` to avoid shadowing it.
const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
