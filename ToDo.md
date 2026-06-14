# BookSharez ToDo
**Created:** June 12, 2026
**Source:** PROJECT_REVIEW_2026-06-12.md
**Last updated:** June 15, 2026

> **Completed work has moved to [CHANGELOG.md](CHANGELOG.md).** This file is
> future work only. Items 1–6 (git, docs patch, condition fix, schema, RLS test,
> auth) are done; items 9–10 are designed. See the changelog for details.

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
- [x] **5. Test RLS policies** — **done June 14: all 8 checks PASS** via `db/rls_test.sql` (anon/other-user see active only, owner sees own removed, non-owner update/delete blocked, owner update allowed, spoofed-user_id insert rejected, photo visibility). RLS verified as the primary security layer.
- [x] **6. Implement real auth** — signup, login, logout, session persistence (done; commit `aa89912`)

## 🔵 DECISIONS NEEDED

- [ ] **7. Choose AI pricing provider** — OpenAI or Anthropic (one). *June 14: deferred — decide when building the pricing Edge Function (ISBN lookup doesn't need it). Docs lean Anthropic.*
- [ ] **8. Confirm ISBNdb plan** — Basic $10/mo; time 7-day trial to integration work, not before. *June 14: deferred — leave open; design items 9-10 first, subscribe when we start the lookup build.*

## ⚪ DESIGN BEFORE BUILDING

- [x] **9. ISBN caching strategy** — **designed June 15** in `docs/ISBN_LOOKUP_DESIGN.md`: `books` table doubles as a permanent cache (UNIQUE isbn + index), cache-first lookup, ISBN-13 canonical cache key, upsert-on-conflict, no expiry in Phase 1.
- [x] **10. Edge Function rate limiting** — **designed June 15** (same doc): recommend in-memory per-instance gate (option B) backed by the 429→Google Books fallback as safety net; DB-backed advisory-lock gate (option C) documented as the upgrade path. *(Both are design only — implementation deferred with the ISBN build, items 7/8.)*

---

**Rule:** Complete items in order. 1 blocks everything; 2–3 block 4–6.
