# BookSharez ToDo
**Created:** June 12, 2026
**Source:** PROJECT_REVIEW_2026-06-12.md
**Last updated:** June 15, 2026

> **Completed work is in [CHANGELOG.md](CHANGELOG.md).** This file is future work
> only. The original 1–10 backlog (git, docs pivot, schema, RLS, auth, 5-grade
> condition system, ISBN-lookup design) plus the persistence trio (browse, sell,
> My Shelf) are all done — see the changelog. What's left is below.

---

## ⏳ PENDING SUPABASE STEPS (apply when DB access is available)

Code is written and committed, but these SQL files are **not yet applied** in
Supabase, so the matching features are **not live**. Run in this order in the
Supabase SQL editor:

- [x] **1. [db/condition_5grade.sql](db/condition_5grade.sql)** — switch the DB to the 5 grades. *(Applied June 15.)*
- [x] **2. [db/books_insert_policy.sql](db/books_insert_policy.sql)** — let logged-in users add catalog books, so the **sell flow can save**. *(Applied June 15.)*
- [x] **3. [db/seed.sql](db/seed.sql)** — demo listings so browse/search shows data. *(Applied June 15.)*
- [ ] **4. (optional) RLS test cleanup** — remove the 2 leftover test users from the RLS test: see the CLEANUP block at the bottom of [db/rls_test.sql](db/rls_test.sql).
- [x] **5. Deploy the `pricing` Edge Function** — pasted into Supabase Dashboard → Edge Functions (name `pricing`). *(Applied June 16.)*
- [x] **6. Set the `DEEPSEEK_API_KEY` secret** — set in Supabase Edge Function Secrets. *(Applied June 16.)*

**Status:** the `pricing` function is live — tested successfully against a real book lookup. "Suggest price" now calls DeepSeek for real, with the local fallback algorithm kicking in automatically only if the Edge Function fails.

**Status:** schema + RLS + bucket + the three steps above are all applied. The
persistence trio — **browse, sell (with ISBN auto-fill), and My Shelf
(edit/mark-sold/delete) — is verified live (June 15).** Filter/sort controls are
live too (quick filter/sort behavior not yet explicitly retested).

---

## 🎯 NEXT UP (independent — pick any; none blocks another)

- [x] **Book detail page** — clicking a listing card opens a full view: cover, condition + description, seller, visual-only "Buy Now" (no payment — Stripe is Phase 3). *(Done June 16; client-side, no schema change. See CHANGELOG.)*
- [x] **Photo upload (3–5 photos)** — to the `listing-photos` Storage bucket, shown as a gallery on the detail page via signed URLs. Sell form requires 3–5 photos. *(Done June 16; client-side, no schema change. See CHANGELOG.)* **Follow-up:** deleting / marking-sold a listing leaves orphaned Storage objects (DB rows cascade, files don't) — add Storage cleanup later. Sold listings stop serving photos (read policy is active-only) — expected.
- [x] **AI price suggestion (DeepSeek)** — "Suggest price" button on the sell form calls the `pricing` Edge Function (DeepSeek), with automatic fallback to the condition-multiplier algorithm from [docs/ERROR_HANDLING_PATTERNS.md](docs/ERROR_HANDLING_PATTERNS.md) on any failure. **Live and verified June 16** — function deployed, secret set, tested against a real book lookup.
- [x] **Server-side ISBN lookup** — `supabase/functions/isbn-lookup/index.ts`: cache-first (books table) → ISBNdb → Google Books, ISBN-10/13 normalization, in-memory rate gate, JWT auth, service-role upsert. Browser's `lookupISBN()` calls it first and falls back to client-side Open Library → Google Books only if the function is unreachable. *(Done June 16; paste into Supabase Dashboard → Edge Functions, name `isbn-lookup`. Set `ISBNDB_API_KEY` once subscribed; `GOOGLE_BOOKS_API_KEY` optional. See CHANGELOG.)*
- [x] **Quick filter/sort check** — code-audited June 16 (no browser tool available to click-test live): `loadFeaturedBooks`/`searchBooks` both compose `baseListingsQuery()` (condition filter) + `applySort()` (sort) identically, and `applyControls()` correctly re-dispatches to whichever view is active. No bug found. Live click-through still welcome if you want to eyeball it yourself.
- [x] **Tidy leftovers** — removed the unused `sampleBooks` / `userBooks` arrays from `js/main.js`. *(Done June 16.)*

## 🔵 OPEN DECISIONS

- [x] **AI pricing provider** — **DeepSeek** (decided June 15; cheaper, OpenAI-compatible API). Wire up when building price suggestion.
- [ ] **ISBNdb plan** — Basic $10/mo, 1 req/sec. Subscribe and set `ISBNDB_API_KEY` in Supabase Edge Function Secrets to activate the primary lookup path; the function works without it (falls through to Google Books).

## 📌 Doc loose end

- [ ] **PROJECT_FILES_INDEX.md** — still labels the dev folder a "Next.js project," but that file lives in the Claude project, **not this repo** — patch it there.
