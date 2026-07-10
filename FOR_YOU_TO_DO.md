# For You To Do

**Updated:** July 9, 2026
Everything in this file needs **your hands** (Supabase dashboard access, money
decisions) — none of it can be done from code. Each item says exactly where to
click, how to verify it worked, and what to tell Claude afterward.
[ToDo.md](ToDo.md) remains the source of truth; this is the extraction of the
user-side items so nothing hides in the backlog.

---

## 🔴 Do now (each takes ~2–5 minutes)

### 1. Turn on Hardcover enrichment (ToDo items 9 + 10 + 11 — do as one batch)

The feature is fully coded and verified; it's just dark until these three steps.
Book pages will gain description, community rating, genres, series info, and
the "More on Hardcover →" link.

- [ ] **1a. Apply the SQL** — Supabase Dashboard → SQL Editor → New query →
      paste all of [db/book_enrichment_columns.sql](db/book_enrichment_columns.sql) → Run.
- [ ] **1b. Deploy the function** — Dashboard → Edge Functions → Deploy new
      function → name it exactly `book-enrichment` → paste all of
      [supabase/functions/book-enrichment/index.ts](supabase/functions/book-enrichment/index.ts) → Deploy.
- [ ] **1c. Set the secret** — get your token from
      <https://hardcover.app/account/api> → Dashboard → Edge Functions →
      Secrets → add `HARDCOVER_API_TOKEN` = the token (with or without the
      leading `Bearer ` — both work).

**Verify:** open any book detail page in the app (a well-known ISBN works
best). Within a second or two a description/rating/genres block should fill in
between the ISBN line and the price. No block = no Hardcover match for that
book (normal for obscure titles) — try a popular one.

### 2. Turn on notifications (ToDo item 13)

The header bell + "a book on your Want shelf was just listed" notifications.
UI is live but degrades silently until the table exists.

- [ ] **Apply the SQL** — SQL Editor → paste all of
      [db/notifications.sql](db/notifications.sql) → Run.

**Verify** (test steps also at the bottom of the SQL file):
1. As user A, add some book to "Books I Want".
2. As user B (second account), list that same book for sale.
3. Log back in as user A → the bell shows a red badge; clicking the entry
   opens the listing.

### 3. Allow no-ISBN books (ToDo item 14)

One-line schema change so pre-ISBN era books (older than ~1970, no barcode,
found via the scanner's "Read Book Cover" path) can be shelved and listed.

- [ ] **Apply the SQL** — SQL Editor → paste all of
      [db/books_isbn_nullable.sql](db/books_isbn_nullable.sql) → Run.

**Verify:** scan the cover of an old barcode-less book → confirm the candidate
→ "Add & List for Sale" → the listing form submits with the ISBN field empty.

### 4. Security hardening SQL (ToDo items 15 + 16)

- [ ] **4a. Apply [db/books_rls_harden.sql](db/books_rls_harden.sql)** — SQL
      Editor → paste → Run. Asserts the catalog has no client write policies
      and adds integrity constraints. **Verify:** `node verify-rls-live.js`
      from the repo (hits the live project with the public key) — all checks
      should pass.
- [ ] **4b. Apply [db/reports.sql](db/reports.sql)** — creates the content-
      reporting table. **Verify:** in the app, open someone else's listing →
      "Report this listing" → pick a reason → submit → "Thanks" message; then
      in the dashboard: `SELECT * FROM reports;`
- [ ] **4c. Allow the reset-email redirect** — Dashboard → Authentication →
      URL Configuration → add `http://localhost:7654` to **Redirect URLs**
      (production URL is item 5a). Without this, the "Forgot password?" email
      links back to the wrong place. **Verify:** login modal → Forgot
      password? → follow the email link → "Set a New Password" form appears →
      new password works.

### 5. The site is LIVE — point Supabase + analytics at it

The app deploys automatically to **<https://edulus.github.io/BookSharez/>**
on every push to `main` (GitHub Pages was already enabled on the repo).
Three follow-ups only you can do:

- [ ] **5a. Supabase auth URLs** — Dashboard → Authentication → URL
      Configuration → set **Site URL** to
      `https://edulus.github.io/BookSharez/` and add it to **Redirect URLs**
      (alongside `http://localhost:7654` from 4c). This makes password-reset
      emails return to the live site, not localhost.
      **Verify:** on the live site → Login → Forgot password? → the email
      link opens edulus.github.io and shows "Set a New Password".
- [ ] **5b. Cloudflare Web Analytics** (free, no cookies, no ad-tech) —
      <https://dash.cloudflare.com/> → Web Analytics → Add a site → hostname
      `edulus.github.io` → copy the **token** → paste it into the
      `window.CF_ANALYTICS_TOKEN = ""` line near the top of
      [index.html](index.html) (or just tell Claude the token) → push.
      **Verify:** visit the live site once, then the Cloudflare dashboard
      shows ≥ 1 visit within a few minutes.
- [ ] **5c. Manual logged-in smoke test on the live site** (the automated
      logged-out half is `node verify-production.js`):
      1. Log in → dashboard loads with your shelves.
      2. Scanner → manual ISBN or barcode → book found → **Books I Have** →
         scanner stays open, chip counts.
      3. Scanner → **Add & List for Sale** → pre-filled sell form → pick
         condition (price auto-suggests) → List Book → listing appears in
         browse.
      4. Open someone else's listing → **Report this listing** → submit →
         "Thanks" (needs 4b applied).
      5. Log out → Forgot password? → complete a reset end-to-end (needs 5a).

### 6. Remove the demo seed data from the live site (ToDo item 17)

The 6 demo books from June's `db/seed.sql` (The Great Gatsby, To Kill a
Mockingbird, 1984, Pride and Prejudice, The Catcher in the Rye, Harry Potter)
are still **live in production** — seeded with random stock-photo covers under
a fake "demo_seller" account, mixed in with real listings. The code-side cover
fallback is already fixed and deployed; this removes the leftover demo *data*.

- [ ] **Apply the SQL** — SQL Editor → paste all of
      [db/remove_seed_data.sql](db/remove_seed_data.sql) → Run. (Deleting the
      demo seller cascades to its 6 listings automatically.)

**Verify:** the two SELECTs at the bottom of the SQL file both return 0 rows;
in the app, browse no longer shows those 6 stock-photo books.
**Caveat** (in the file's comments): if a real user has since added one of those
6 exact books to their own shelf, that shelf entry cascades away too — small,
acceptable blast radius at the current catalog size, but worth knowing.

---

## 🟡 Decide (blocking a docs cleanup, not blocking features)

### 7. ISBNdb subscription — yes or no?

The docs describe ISBNdb as the *primary* seller-side ISBN lookup, but it has
never run (no subscription). The app works fine today on the fallback chain
(cache → Google Books → Open Library).

- [ ] **Option A:** subscribe (Basic, $10/mo, 1 req/sec) at isbndb.com →
      Dashboard → Edge Functions → Secrets → add `ISBNDB_API_KEY` → done, the
      `isbn-lookup` function picks it up automatically, no code change.
- [ ] **Option B:** tell Claude "demote ISBNdb" → the docs get updated to make
      Google Books the documented primary and ISBNdb an optional upgrade.

Either answer is fine — the current limbo (docs say one thing, runtime does
another) is the only wrong state.

---

## 🟢 Optional / when convenient

### 8. RLS test cleanup (ToDo item 4)

- [ ] Two leftover test users from the June RLS test. SQL Editor → run the
      CLEANUP block at the bottom of [db/rls_test.sql](db/rls_test.sql).

---

## 🚀 Pre-launch (not yet — when you're ready to put this in front of people)

These are listed so they don't get lost; no action today.

- [ ] **Upgrade Supabase to Pro** and then **delete
      [.github/workflows/keep-alive.yml](.github/workflows/keep-alive.yml)**
      (the Free-plan anti-pause hack becomes unnecessary).
- [ ] **Enable Supabase auth hardening** — Dashboard → Authentication →
      email confirmation ON, leaked-password protection ON. (Claude builds the
      matching password-reset UI as a code step — improvement plan §6.5.)
- [ ] **Turn on daily backups** (comes with Pro).
- [x] **Pick a host** — ~~GitHub Pages, Cloudflare Pages, or Netlify~~ GitHub
      Pages was already enabled on the repo; live at
      <https://edulus.github.io/BookSharez/>, auto-deploys on push to `main`
      (see item 5). A custom domain can come later (Settings → Pages).
- [ ] **Review Supabase auth email templates** — Dashboard → Authentication →
      Email Templates (they say "Supabase" by default).

---

## 📣 After you do any of these

Just say what you did (screenshots welcome, per our usual workflow) and the
matching ToDo.md items get checked off. If a verify step fails, say which step
number and what you saw instead.
