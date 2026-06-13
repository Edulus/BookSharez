# BookSharez Project Review
**Date:** June 12, 2026
**Sources:** 7 project files + chat history (Oct 2024 – June 2026)

---

## 1. CURRENT STATE SUMMARY

**Documentation:** Well-organized. 7 Phase 1 files in Claude project, archives consolidated in Dropbox, index file current.

**Codebase reality (from today's session):**
- A static HTML/CSS/JS prototype exists (hardcoded data, fake login, no package.json, no git)
- Supabase account + BookSharez project created; keys retrieved
- CLAUDE.md created for Claude Code continuity
- Gap analysis completed; agreed starting point: Supabase setup + real auth

**Key decision made today:** Stay **vanilla JS** (no Next.js), use **Supabase Edge Functions** to proxy API keys.

---

## 2. CRITICAL FINDING: DOCS vs. ARCHITECTURE MISMATCH

Your authoritative docs were written in January for a **Next.js** build. Today's decision is **vanilla JS + Edge Functions**. Affected files:

| File | Stale Content |
|------|--------------|
| PHASE_1_MVP_SPEC.md | Week 1 checklist says "Initialize Next.js project"; deploy target is Vercel |
| SECURITY_CHECKLIST.md | middleware.ts, Next.js API route examples, `@supabase/auth-helpers-nextjs` |
| ERROR_HANDLING_PATTERNS.md | Patterns assume server routes (`/api/pricing`) — these become Edge Functions |
| env.example | `NEXT_PUBLIC_*` prefixes are Next.js conventions; Edge Function secrets live in Supabase, not .env.local |
| PROJECT_FILES_INDEX.md | Labels dev folder "Next.js project (VS Code + Claude Code)" |

**Risk:** Future Claude/Claude Code sessions reading these docs will rebuild toward Next.js or produce mismatched code. The "authoritative spec" is now partially wrong about its own architecture.

---

## 3. OTHER ISSUES IDENTIFIED

### 3.1 Condition value mismatch (confirmed by Claude Code)
Prototype uses `fair` / `poor`; spec mandates `like_new`, `very_good`, `good`, `acceptable`. Database CHECK constraint will reject prototype values. Must fix before wiring listings to Supabase.

### 3.2 No version control
No git repo. You are about to make the largest changes the codebase has ever seen (real auth, database integration). One bad session could destroy the prototype with no rollback.

### 3.3 Timeline drift
Docs dated Jan 23 promised a 2-week Phase 1. Five months later, backend work hasn't started. Not a criticism — the planning quality is high — but the spec's "2 weeks" framing and success metrics dates should be reset so they stay meaningful.

### 3.4 Unresolved decisions
- **AI pricing provider:** env.example says "choose ONE" (OpenAI vs Anthropic) — not yet chosen
- **ISBNdb subscription:** Basic plan ($10/mo, 1 req/sec) presumably, but not confirmed/purchased
- **Edge Function rate limiting:** ERROR_HANDLING's client-side throttle (1.1s) was designed for one server; with Edge Functions, multiple users hitting ISBNdb concurrently will breach 1 req/sec. Needs server-side queueing or caching strategy (e.g., cache book data by ISBN — the `books` table already supports this).

### 3.5 Security checklist gaps for new architecture
Vanilla JS means **all client code is fully visible**. The checklist's core principles hold, but verify:
- Anon key only in frontend (already instructed today ✅)
- Service role key used only inside Edge Functions
- RLS becomes your *primary* security layer, not a backup — test it harder

---

## 4. EVALUATION

**Strengths:**
- Spec discipline (authoritative doc, explicit deferrals, conflict resolution) is excellent
- Vanilla JS decision is sound for your skill set — leverages existing prototype, avoids React learning curve blocking the MVP
- Edge Functions approach correctly solves the API key exposure problem
- Database schema with RLS is production-grade for an MVP

**Weaknesses:**
- Documentation now lags the architecture by one major decision
- No git = highest current risk
- The 30-second listing goal depends on ISBNdb response caching that isn't yet designed

---

## 5. RECOMMENDATIONS (Priority Order)

1. **Initialize git immediately** in the project folder, commit the prototype as-is. (5 min, eliminates biggest risk)
2. **Patch the docs** — one focused pass replacing Next.js references with vanilla JS + Edge Functions. Update: MVP_SPEC checklist, SECURITY_CHECKLIST code examples, env.example, PROJECT_FILES_INDEX. Add a one-line architecture decision record: "June 12, 2026: Vanilla JS + Supabase Edge Functions chosen over Next.js."
3. **Fix condition values in prototype** (`fair`/`poor` → spec grades) before any database integration.
4. **Run the database schema** from MVP_SPEC in Supabase SQL editor (verbatim, including RLS policies and indexes).
5. **Implement real auth** (signup/login/logout) replacing the fake login — agreed Gap 1+2 starting point.
6. **Decide AI pricing provider** before building the pricing Edge Function. (Recommendation: Anthropic, since you already hold the ecosystem; either works.)
7. **Design ISBN caching:** Edge Function checks `books` table first, calls ISBNdb only on miss. Solves rate limit + speeds lookups + reduces API cost.
8. **Confirm ISBNdb Basic subscription** ($10/mo) or start the 7-day trial timed to coincide with integration work, not before.

---

## 6. SUGGESTED IMMEDIATE NEXT STEP

Step 1 (git init) — single command, zero risk, protects everything that follows.
