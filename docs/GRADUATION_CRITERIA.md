# Tech Stack Graduation Criteria

**Created:** June 12, 2026
**Append to:** PHASE_1_MVP_SPEC.md (after "🚫 EXPLICITLY DEFERRED TO LATER PHASES")

---

## 🎓 TECH STACK GRADUATION CRITERIA

**Current stack:** Vanilla HTML/CSS/JS + Supabase (database, auth, storage, Edge Functions)
**Graduation target:** Next.js + React + Supabase (backend unchanged)

### Context
All code is AI-generated (Claude Code). Developer learning curve is NOT a factor
in this decision. The only reasons to stay vanilla are: the prototype already
works, and rewriting before market validation wastes effort.

### Migrate to Next.js when ANY of these triggers fire:

1. **Market validated** — Phase 1 metrics hit (100+ users, 250+ listings,
   repeat usage). Demand proven = rewrite investment justified.
2. **Phase 3 approved** — Migrate BEFORE building Stripe payments, never after.
   Payment flows built in vanilla JS would be rebuilt twice.
3. **UI complexity wall** — Any Phase 2 feature (live search filters, messaging,
   real-time updates) takes >2x estimated sessions due to manual DOM management.
4. **SEO required** — Decision made to pursue Google discovery of listings
   (needs server-side rendering).

### Do NOT migrate if:
- Phase 1 metrics miss badly (pivot or kill instead — don't rewrite a failure)
- Mid-feature (finish current feature first, then migrate at a clean boundary)

### Migration scope (when triggered):
- **Carries over untouched:** Supabase database, schema, RLS policies, auth
  config, storage buckets, Edge Functions
- **Rewritten:** Frontend only (HTML/CSS/JS → Next.js App Router + React)
- **Estimated effort:** 1–2 weeks via Claude Code
- **Inputs to rewrite:** Phase 1 UX learnings, existing Edge Function contracts,
  this spec's feature list

### Decision record
- **June 12, 2026:** Vanilla JS + Edge Functions chosen for Phase 1 MVP.
  Rationale: working prototype exists; validate before rewriting. Next.js
  pre-approved as graduation target — no re-evaluation needed when a trigger fires.
