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

**Status:** schema + RLS + bucket + the three steps above are all applied. The
persistence trio — **browse, sell (with ISBN auto-fill), and My Shelf
(edit/mark-sold/delete) — is verified live (June 15).** Filter/sort controls are
live too (quick filter/sort behavior not yet explicitly retested).

---

## 🎯 NEXT UP (independent — pick any; none blocks another)

- [ ] **Book detail page** — clicking a listing card currently does nothing. Build a full view: cover, condition + description, seller, visual-only "Buy Now" (no payment — Stripe is Phase 3).
- [ ] **Photo upload (3–5 photos)** — to the `listing-photos` Storage bucket (already created), shown as a gallery. The sell form's photo input is currently ignored. UX nudge: "more photos of your actual book → more likely to sell." (Cover image is separate — auto-fetched during ISBN lookup.)
- [ ] **AI price suggestion (DeepSeek)** — suggest a price from condition + book data, user can override. Needs the AI key server-side → pairs with an Edge Function. Fallback algorithm is in [docs/ERROR_HANDLING_PATTERNS.md](docs/ERROR_HANDLING_PATTERNS.md).
- [ ] **Server-side ISBN lookup** — move today's client-side multi-source lookup into an Edge Function and add ISBNdb as primary (per [docs/ISBN_LOOKUP_DESIGN.md](docs/ISBN_LOOKUP_DESIGN.md)): hides keys, better coverage, server-side rate limiting. **Needs:** ISBNdb plan decision (below) + the first Edge Function (Supabase CLI / Deno).
- [ ] **Quick filter/sort check** — confirm the homepage condition filter + sort re-query as expected (controls are live; not explicitly retested live).
- [ ] **Tidy leftovers** — remove the now-unused `sampleBooks` / `userBooks` arrays from `js/main.js`.

## 🔵 OPEN DECISIONS

- [x] **AI pricing provider** — **DeepSeek** (decided June 15; cheaper, OpenAI-compatible API). Wire up when building price suggestion.
- [ ] **ISBNdb plan** — Basic $10/mo, 1 req/sec. Still deferred; subscribe when starting the server-side ISBN lookup build.

## 📌 Doc loose end

- [ ] **PROJECT_FILES_INDEX.md** — still labels the dev folder a "Next.js project," but that file lives in the Claude project, **not this repo** — patch it there.
