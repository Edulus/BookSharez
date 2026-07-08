// LIVE RLS probe (§6.1) — hits the real Supabase project with the public anon
// key (the same key any visitor's browser has) and asserts unauthorized
// writes are rejected. No login, no mocks; skips gracefully when offline.
//
// What it proves: an anonymous client cannot INSERT/UPDATE/DELETE catalog
// books, cannot touch other tables' rows, and CAN read public data.
// What it can't prove (needs a signed-in session): that an *authenticated*
// user is also denied UPDATE/DELETE on books — RLS denies it (no policy),
// and db/books_rls_harden.sql asserts no such policy exists.
const fs = require("fs");

const cfg = fs.readFileSync("js/supabase-config.js", "utf8");
const URL_ = (cfg.match(/SUPABASE_URL\s*=\s*"([^"]+)"/) || [])[1];
const KEY = (cfg.match(/SUPABASE_PUBLISHABLE_KEY\s*=\s*"([^"]+)"/) || [])[1];
if (!URL_ || !KEY) { console.error("couldn't read Supabase config"); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

let failures = 0;
function check(name, cond, extra = "") {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  [" + extra + "]" : ""));
  if (!cond) failures++;
}

async function req(method, path, body, prefer) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: prefer ? { ...H, Prefer: prefer } : H,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  return { status: res.status, data };
}

(async () => {
  // connectivity gate
  try {
    const ping = await req("GET", "books?select=id&limit=1");
    if (ping.status === 0) throw new Error("no response");
  } catch (e) {
    console.log("SKIP  network unreachable — live RLS probe not run (" + e.message + ")");
    process.exit(0);
  }

  // 1. public read works (anon SELECT is by design)
  const read = await req("GET", "books?select=id,isbn&limit=1");
  check("anon can read books (public catalog)", read.status === 200 && Array.isArray(read.data), `status=${read.status}`);

  // 2. anon INSERT into books is rejected (policy is TO authenticated)
  const ins = await req("POST", "books", { isbn: "9999999999999", title: "rls-probe — should never exist" }, "return=representation");
  check("anon INSERT books rejected", ins.status >= 400, `status=${ins.status}`);

  // 3. anon UPDATE books affects zero rows (no UPDATE policy exists)
  const upd = await req("PATCH", "books?isbn=not.is.null", { title: "corrupted-by-probe" }, "return=representation");
  const updRows = Array.isArray(upd.data) ? upd.data.length : 0;
  check("anon UPDATE books blocked (0 rows / error)", upd.status >= 400 || updRows === 0, `status=${upd.status} rows=${updRows}`);

  // 4. anon DELETE books affects zero rows
  const del = await req("DELETE", "books?isbn=eq.9999999999999", null, "return=representation");
  const delRows = Array.isArray(del.data) ? del.data.length : 0;
  check("anon DELETE books blocked (0 rows / error)", del.status >= 400 || delRows === 0, `status=${del.status} rows=${delRows}`);

  // 5. anon UPDATE listings affects zero rows (owner-scoped policy)
  const updL = await req("PATCH", "listings?status=eq.active", { price: 0.01 }, "return=representation");
  const updLRows = Array.isArray(updL.data) ? updL.data.length : 0;
  check("anon UPDATE listings blocked (0 rows / error)", updL.status >= 400 || updLRows === 0, `status=${updL.status} rows=${updLRows}`);

  // 6. anon INSERT notifications rejected (no client INSERT policy at all)
  const insN = await req("POST", "notifications", { user_id: "00000000-0000-0000-0000-000000000000", type: "want_match", subject_type: "listing", subject_id: "00000000-0000-0000-0000-000000000000" }, "return=representation");
  check("anon INSERT notifications rejected (forge-proof)", insN.status >= 400, `status=${insN.status}`);

  // 7. anon INSERT reports rejected (authenticated-only; 404 = table not applied yet)
  const insR = await req("POST", "reports", { subject_type: "listing", subject_id: "00000000-0000-0000-0000-000000000000", reason: "spam" }, "return=representation");
  if (insR.status === 404) console.log("NOTE  reports table not applied yet (db/reports.sql pending) — skipping");
  else check("anon INSERT reports rejected", insR.status >= 400, `status=${insR.status}`);

  console.log(failures === 0 ? "\nALL LIVE RLS CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
})();
