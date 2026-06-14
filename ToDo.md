# BookSharez ToDo
**Created:** June 12, 2026
**Source:** PROJECT_REVIEW_2026-06-12.md
**Last updated:** June 14, 2026

---

## ✅ COMPLETED

- [x] **1. Initialize git** — repo created; prototype committed (`e708d78 Initial commit`).
- [x] **6. Implement real auth** — signup, login, logout, session persistence wired to Supabase, replacing the fake login (`aa89912`). *(Done ahead of items 2–3; condition fix below was originally sequenced before it.)*
- [x] **3. Fix prototype condition values** — June 14: `index.html` `<select>` and `js/main.js` (label map + 4 sample books) converted from `fair`/`poor`/hyphens to the spec's 4 grades `like_new` / `very_good` / `good` / `acceptable`. Verified no stale values remain.

---

## 🔴 IMMEDIATE (before any code changes)

- [x] **1. Initialize git** in `W:\Coding Projects\booksharez\` and commit prototype as-is
  - `git init` → `git add .` → `git commit -m "Prototype baseline"`

## 🟠 DOCUMENTATION PATCH (one focused pass)

- [ ] **2. Update docs for vanilla JS + Edge Functions architecture:**
  - [ ] PHASE_1_MVP_SPEC.md — replace "Initialize Next.js" checklist item; revise deploy target; reset timeline dates
  - [ ] SECURITY_CHECKLIST.md — replace middleware.ts / Next.js API route examples with Edge Function equivalents
  - [ ] ERROR_HANDLING_PATTERNS.md — re-point `/api/*` patterns to Edge Functions
  - [ ] env.example — remove `NEXT_PUBLIC_*` prefixes; note Edge Function secrets live in Supabase dashboard
  - [ ] PROJECT_FILES_INDEX.md — change dev folder label from "Next.js project"
  - [ ] Add architecture decision record line: "June 12, 2026: Vanilla JS + Supabase Edge Functions chosen over Next.js"

## 🟡 PRE-INTEGRATION FIXES

- [x] **3. Fix prototype condition values** — `fair`/`poor` → `like_new` / `very_good` / `good` / `acceptable` *(done June 14)*

## 🟢 BACKEND BUILD (agreed Gap 1+2 starting point)

- [ ] **4. Run database schema** from PHASE_1_MVP_SPEC.md in Supabase SQL editor (verbatim: tables, indexes, RLS policies)
- [ ] **5. Test RLS policies** (cross-user access should fail; anonymous sees active listings only)
- [x] **6. Implement real auth** — signup, login, logout, session persistence (done; commit `aa89912`)

## 🔵 DECISIONS NEEDED

- [ ] **7. Choose AI pricing provider** — OpenAI or Anthropic (one)
- [ ] **8. Confirm ISBNdb plan** — Basic $10/mo; time 7-day trial to integration work, not before

## ⚪ DESIGN BEFORE BUILDING

- [ ] **9. ISBN caching strategy** — Edge Function checks `books` table first, calls ISBNdb only on cache miss (solves 1 req/sec limit + speeds lookups)
- [ ] **10. Edge Function rate limiting** — server-side, not the client-side throttle from ERROR_HANDLING_PATTERNS.md

---

**Rule:** Complete items in order. 1 blocks everything; 2–3 block 4–6.
