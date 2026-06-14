# BookSharez ToDo
**Created:** June 12, 2026
**Source:** PROJECT_REVIEW_2026-06-12.md
**Last updated:** June 14, 2026

---

## ✅ COMPLETED

- [x] **1. Initialize git** — repo created; prototype committed (`e708d78 Initial commit`).
- [x] **6. Implement real auth** — signup, login, logout, session persistence wired to Supabase, replacing the fake login (`aa89912`). *(Done ahead of items 2–3; condition fix below was originally sequenced before it.)*
- [x] **3. Fix prototype condition values** — June 14: `index.html` `<select>` and `js/main.js` (label map + 4 sample books) converted from `fair`/`poor`/hyphens to the spec's 4 grades `like_new` / `very_good` / `good` / `acceptable`. Verified no stale values remain.
- [x] **2. Documentation patch** — June 14: PHASE_1_MVP_SPEC (ADR line, retired "2 weeks", Next.js→vanilla checklist, host-agnostic deploy), SECURITY_CHECKLIST (middleware.ts & API-route examples → Edge Function equivalents, vanilla XSS/CSP/rate-limit guidance), ERROR_HANDLING_PATTERNS (`/api/pricing` → `functions.invoke`, throttle caveat), env.example (dropped `NEXT_PUBLIC_*`, secrets→Edge Function). *PROJECT_FILES_INDEX.md is not in this repo (Claude-project doc) — patch it there.*

---

## 🔴 IMMEDIATE (before any code changes)

- [x] **1. Initialize git** in `W:\Coding Projects\booksharez\` and commit prototype as-is
  - `git init` → `git add .` → `git commit -m "Prototype baseline"`

## 🟠 DOCUMENTATION PATCH (one focused pass)

- [x] **2. Update docs for vanilla JS + Edge Functions architecture:** *(done June 14)*
  - [x] PHASE_1_MVP_SPEC.md — replace "Initialize Next.js" checklist item; revise deploy target; reset timeline dates
  - [x] SECURITY_CHECKLIST.md — replace middleware.ts / Next.js API route examples with Edge Function equivalents
  - [x] ERROR_HANDLING_PATTERNS.md — re-point `/api/*` patterns to Edge Functions
  - [x] env.example — remove `NEXT_PUBLIC_*` prefixes; note Edge Function secrets live in Supabase dashboard
  - [ ] PROJECT_FILES_INDEX.md — change dev folder label from "Next.js project" *(file lives in the Claude project, not this repo — patch there)*
  - [x] Add architecture decision record line: "June 12, 2026: Vanilla JS + Supabase Edge Functions chosen over Next.js"

## 🟡 PRE-INTEGRATION FIXES

- [x] **3. Fix prototype condition values** — `fair`/`poor` → `like_new` / `very_good` / `good` / `acceptable` *(done June 14)*

## 🟢 BACKEND BUILD (agreed Gap 1+2 starting point)

- [x] **4. Run database schema** in Supabase SQL editor — **done June 14** (`db/schema.sql` ran clean: "Success. No rows returned"). Tables (books, listings, listing_photos), indexes, RLS policies, and both storage policies created. `books` got RLS + public read-only policy (deviation from verbatim spec, see commit `9ae1014`). Bucket `listing-photos` created first: Public OFF, 5 MB cap, MIME image/jpeg+png+webp.
- [ ] **5. Test RLS policies** (cross-user access should fail; anonymous sees active listings only) — **test harness prepared at `db/rls_test.sql`** (seeds 2 users + listings, runs 8 checks under real anon/authenticated roles, prints PASS/FAIL). ⏳ Awaiting run in the SQL editor; expect all 8 PASS.
- [x] **6. Implement real auth** — signup, login, logout, session persistence (done; commit `aa89912`)

## 🔵 DECISIONS NEEDED

- [ ] **7. Choose AI pricing provider** — OpenAI or Anthropic (one)
- [ ] **8. Confirm ISBNdb plan** — Basic $10/mo; time 7-day trial to integration work, not before

## ⚪ DESIGN BEFORE BUILDING

- [ ] **9. ISBN caching strategy** — Edge Function checks `books` table first, calls ISBNdb only on cache miss (solves 1 req/sec limit + speeds lookups)
- [ ] **10. Edge Function rate limiting** — server-side, not the client-side throttle from ERROR_HANDLING_PATTERNS.md

---

**Rule:** Complete items in order. 1 blocks everything; 2–3 block 4–6.
