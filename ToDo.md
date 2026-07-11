# BookSharez ToDo
**Created:** June 12, 2026
**Source:** PROJECT_REVIEW_2026-06-12.md
**Last updated:** July 10, 2026

> **This is the master backlog and status record.** `FOR_YOU_TO_DO.md` is a
> derived view containing only active tasks that require user-only access,
> decisions, or hands-on verification. Completed work is recorded here and in
> `CHANGELOG.md`, then removed from the derived checklist.

> **Completed work is in [CHANGELOG.md](CHANGELOG.md).** This file is future work
> only. The original 1–10 backlog (git, docs pivot, schema, RLS, auth, 5-grade
> condition system, ISBN-lookup design) plus the persistence trio (browse, sell,
> My Shelf) are all done — see the changelog. What's left is below.

> **Launch gates:** the authoritative launch-readiness checklist is
> [docs/LAUNCH_READINESS.md](docs/LAUNCH_READINESS.md) (July 11) — repo-verified
> status per gate, remaining work, and sequencing. The pending Supabase steps
> below close most of the cheap gates.

---

## ⏳ PENDING SUPABASE STEPS (apply when DB access is available)

Code is written and committed, but these SQL files are **not yet applied** in
Supabase, so the matching features are **not live**. Apply the remaining files
in this order: nullable ISBN → RLS hardening → reports → notifications → photo
cleanup → seed cleanup. The pending scripts are safe to rerun.

- [x] **1. [db/condition_5grade.sql](db/condition_5grade.sql)** — switch the DB to the 5 grades. *(Applied June 15.)*
- [x] **2. [db/books_insert_policy.sql](db/books_insert_policy.sql)** — let logged-in users add catalog books, so the **sell flow can save**. *(Applied June 15.)*
- [x] **3. [db/seed.sql](db/seed.sql)** — demo listings so browse/search shows data. *(Applied June 15.)*
- [ ] **17. Apply [db/remove_seed_data.sql](db/remove_seed_data.sql)** — removes the demo seller and 6 fake listings from item 3. Seed catalog books are deleted only when no real listing, shelf entry, or discussion references them; preview and verification queries are included.
- [ ] **4. (optional) RLS test cleanup** — remove the 2 leftover test users from the RLS test: see the CLEANUP block at the bottom of [db/rls_test.sql](db/rls_test.sql).
- [x] **8. Apply [db/discussions.sql](db/discussions.sql)** — creates `discussion_posts` table with RLS (public read, auth insert, owner delete). Required for the Discuss section on the book detail page to work. *(Applied June 21; Discuss section verified working.)*
- [x] **5. Deploy the `pricing` Edge Function** — pasted into Supabase Dashboard → Edge Functions (name `pricing`). *(Applied June 16.)*
- [x] **6. Set the `DEEPSEEK_API_KEY` secret** — set in Supabase Edge Function Secrets. *(Applied June 16.)*
- [x] **9. Apply [db/book_enrichment_columns.sql](db/book_enrichment_columns.sql)** — adds the Hardcover enrichment columns (`description`, `hc_rating`, `hc_genres`, `hc_series_name`, `hc_slug`, `hc_enriched_at`, etc.) to `books`. *(Applied July 9 — verified: columns present + real Hardcover data cached for multiple books.)*
- [x] **10. Deploy the `book-enrichment` Edge Function** — paste [supabase/functions/book-enrichment/index.ts](supabase/functions/book-enrichment/index.ts) into Supabase Dashboard → Edge Functions (name `book-enrichment`). *(Deployed July 9 — verified: function live and JWT-gated, anon call returns 401.)*
- [x] **11. Set the `HARDCOVER_API_TOKEN` secret** — token from https://hardcover.app/account/api, in Supabase Edge Function Secrets (with or without a leading `Bearer `). *(Set July 9 — verified: books enriching with real ratings/slugs/genres, incl. a fresh enrichment cached July 9.)*
- [ ] **16. Apply [db/reports.sql](db/reports.sql)** — creates the `reports` table (content flagging for listings/profiles/discussion posts; INSERT-only for clients, review via dashboard). The in-app Report buttons degrade to a "try again later" message until applied. Manual test at the bottom of the SQL file.
- [ ] **15. Apply [db/books_rls_harden.sql](db/books_rls_harden.sql)** — asserts `books` has no client UPDATE/DELETE policies + adds CHECK constraints (title/author lengths, ISBN format) so catalog INSERTs can't be garbage. Run `node verify-rls-live.js` afterward to confirm.
- [ ] **14. Apply [db/books_isbn_nullable.sql](db/books_isbn_nullable.sql)** — one `ALTER TABLE`: lets catalog books have a NULL isbn, so pre-ISBN era books (surfaced by the scanner's cover path) can be shelved and listed. Until applied, adding a no-ISBN book shows the generic "Couldn't save book" alert; everything else is unaffected. Manual test at the bottom of the SQL file.
- [ ] **13. Apply [db/notifications.sql](db/notifications.sql)** — creates the `notifications` table (generic rail: RLS owner read/update/delete, no client insert) + the `notify_want_match` trigger on `listings`. Required for the header bell + want-match notifications to work; until applied, the bell shows no badge and the panel says notifications are unavailable (graceful degradation). Manual test steps are at the bottom of the SQL file.
- [ ] **18. Apply [db/listing_photo_cleanup.sql](db/listing_photo_cleanup.sql)** — lets listing owners delete their photo metadata and private Storage objects. Required for the completed client cleanup path to remove photos on mark-sold/delete and roll back uploads whose metadata insert fails.
- [x] **12. Supabase keep-alive workflow** — [.github/workflows/keep-alive.yml](.github/workflows/keep-alive.yml) pings the REST API every 3 days so the Free Plan never auto-pauses; self-re-enables its schedule each run (no 60-day chore). Secrets set, deployed, verified HTTP 200. *(Done July 3 — see CHANGELOG.)* **Follow-up (pre-launch):** upgrade to Supabase Pro and delete this workflow.

**Status:** the `pricing` function is live — tested successfully against a real book lookup. "Suggest price" now calls DeepSeek for real, with the local fallback algorithm kicking in automatically only if the Edge Function fails.

**Status:** schema + RLS + bucket + the three steps above are all applied. The
persistence trio — **browse, sell (with ISBN auto-fill), and My Shelf
(edit/mark-sold/delete) — is verified live (June 15).** Filter/sort controls are
live too (quick filter/sort behavior not yet explicitly retested).

---

## 🟢 PHASE 2 — in progress (June 17)

- [x] **Schema** — `profiles` + `shelf_entries` + `follows` tables, RLS, trigger, `listings.shelf_entry_id` FK. SQL in [db/phase2_schema.sql](db/phase2_schema.sql). **Pending Supabase apply** (paste in SQL Editor — see below).
- [x] **Shelf UI** — "Books I Have" and "Books I Want" tabs in the dashboard; "Add Book" button; shelf-item cards with "List for Sale" / "Remove". Sell flow now routes through the shelf (architecture §5.3).
- [x] **Profile page** — public shelf view for any user; follow/unfollow button; follower/following counts; clickable seller name on the book detail page.
- [x] **Profile settings** — username + bio form in dashboard Profile tab; upsert to `profiles`.

**Pending Supabase step:**
- [x] **7. Apply [db/phase2_schema.sql](db/phase2_schema.sql)** — paste into Supabase SQL Editor. Creates `profiles`, `shelf_entries`, `follows`, adds `listings.shelf_entry_id`, enables RLS on all three, backfills profile rows for existing users. *(Applied June 17.)*

---

## 🎯 NEXT UP (independent — pick any; none blocks another)

- [x] **Book detail page** — clicking a listing card opens a full view: cover, condition + description, seller, visual-only "Buy Now" (no payment — Stripe is Phase 3). *(Done June 16; client-side, no schema change. See CHANGELOG.)*
- [x] **Photo upload (3–5 photos)** — to the `listing-photos` Storage bucket, shown as a gallery on the detail page via signed URLs. Sell form requires 3–5 photos. Storage cleanup now removes objects on mark-sold/delete and rolls back incomplete uploads. *(Upload done June 16; cleanup coded July 10, pending ToDo 18 SQL apply.)*
- [x] **AI price suggestion (DeepSeek)** — "Suggest price" button on the sell form calls the `pricing` Edge Function (DeepSeek), with automatic fallback to the condition-multiplier algorithm from [docs/ERROR_HANDLING_PATTERNS.md](docs/ERROR_HANDLING_PATTERNS.md) on any failure. **Live and verified June 16** — function deployed, secret set, tested against a real book lookup.
- [x] **Server-side ISBN lookup** — `supabase/functions/isbn-lookup/index.ts`: cache-first (books table) → optional ISBNdb when configured → Google Books, ISBN-10/13 normalization, in-memory rate gate, JWT auth, service-role upsert. Browser fallback is Open Library → Google Books if the function is unreachable. *(Done June 16; ISBNdb formally made optional July 10. See CHANGELOG.)*
- [x] **Quick filter/sort check** — code-audited June 16 (no browser tool available to click-test live): `loadFeaturedBooks`/`searchBooks` both compose `baseListingsQuery()` (condition filter) + `applySort()` (sort) identically, and `applyControls()` correctly re-dispatches to whichever view is active. No bug found. Live click-through still welcome if you want to eyeball it yourself.
- [x] **Tidy leftovers** — removed the unused `sampleBooks` / `userBooks` arrays from `js/main.js`. *(Done June 16.)*
- [x] **"View on Hardcover" link** — outbound link to `https://hardcover.app/books/<slug>` on the book detail page, hidden when the slug is null. *Already shipped* as part of the June 21 enrichment work: rendered in `renderEnrichment` ([js/main.js:858-867](js/main.js#L858-L867)) as "More on Hardcover →", gated on `data.slug` (sourced from the `hc_slug` column via the `book-enrichment` Edge Function — cache path and fresh fetch both return it). Reaches both detail paths through `runBookEnrichment`. *(Verified June 22.)*

## 🔵 OPEN DECISIONS

- [x] **AI pricing provider** — **DeepSeek** (decided June 15; cheaper, OpenAI-compatible API). Wire up when building price suggestion.
- [x] **ISBNdb plan** — demote ISBNdb to an optional paid enhancement. Google Books is the default external ISBN provider after the local cache; Open Library remains the browser fallback. Keep ISBNdb support in the Edge Function so it can be enabled later by setting `ISBNDB_API_KEY`. *(Decided July 10.)*

## 📌 Doc loose end

- [ ] **PROJECT_FILES_INDEX.md** — still labels the dev folder a "Next.js project," but that file lives in the Claude project, **not this repo** — patch it there.

## 🚧 QUEUED — BLOCKED

- [x] **Book-as-object renderer consolidation** — `renderBook(book, context, density)` is live. All five old renderers replaced; `normalizeListing`, `createBookCard`, `createExternalBookCard`, `displayedListings` removed. One `FALLBACK_COVER`; one field name per concept. *(Done June 20.)*
- [x] **Vision OCR** — `vision-extract` Edge Function deployed, `GEMINI_API_KEY` set, client-side wiring complete (barcode recovery + cover photo paths), verified by Playwright harness. *(Done June 20.)*

---

## 🔒 SECURITY (June 18 — completed)

- [x] **Google Books API key removed from browser JS** — old key rotated/deleted; new key in Supabase Edge Function secrets only. `supabase-config.js` now contains only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`.
- [x] **Pre-commit hook** — `.git/hooks/pre-commit` blocks `AIzaSy…`, `sk-…`, and service-role JWT patterns. Live and tested.
- [x] **GitHub Actions gitleaks** — `.github/workflows/secret-scan.yml` scans every push and PR.
- [x] **CLAUDE.md security rules** — non-negotiable rules added at the top; any future API key must go through an Edge Function.
