# Search Systems — ISBN Lookup vs. Browse/Search

**Date:** June 15, 2026
**Status:** Reference. Source: project briefing (June 15), **translated from its
Next.js framing into this project's actual stack** — vanilla HTML/CSS/JS +
Supabase Edge Functions (see the ADR in [PHASE_1_MVP_SPEC.md](PHASE_1_MVP_SPEC.md)).
The briefing's file paths (`src/lib/*.ts`, `src/app/api/*`, `.env.local`) describe
a Next.js app we are **not** building; the *behaviour* it specifies is authoritative,
the *paths* are remapped below.

---

## ⚠️ Two distinct "search" systems — do not conflate them

BookSharez has two separate things called "search." They share almost nothing.

| | **1. ISBN Lookup** (seller-side) | **2. Browse/Search** (buyer-side) |
|---|---|---|
| Purpose | Auto-fill book data when listing a book | Find books already listed on BookSharez |
| Trigger | Seller enters/scans an ISBN in the sell flow | Buyer types in the homepage / browse search bar |
| Data source | **External APIs** — ISBNdb → Google Books | **Local Supabase DB ONLY** — no external calls |
| Where keys live | Edge Function secrets | none (pure DB query) |
| Design doc | [ISBN_LOOKUP_DESIGN.md](ISBN_LOOKUP_DESIGN.md) | this doc, §2 |

---

## 1. ISBN Lookup (seller-side — listing creation)

Fully designed in **[ISBN_LOOKUP_DESIGN.md](ISBN_LOOKUP_DESIGN.md)**. Summary:

- **Purpose:** auto-fill book data when a seller enters/scans an ISBN.
- **Flow:** cache-check `books` table → ISBNdb (`api2.isbndb.com`) → Google Books
  fallback on 404/429/timeout → normalize → upsert into `books` → return.
- **Keys (Edge Function secrets, never client-side):** `ISBNDB_API_KEY`
  ($10/mo Basic, 1 req/sec), `GOOGLE_BOOKS_API_KEY` (free, 1000/day).
- Google Books list price also feeds AI pricing.
- Error handling per [ERROR_HANDLING_PATTERNS.md](ERROR_HANDLING_PATTERNS.md)
  (5s timeout, fallback chain, seamless user-facing messages, manual-entry last
  resort).

> Stack translation: the briefing's `src/lib/isbn-lookup.ts` +
> `src/app/api/isbn/route.ts` are a single **Supabase Edge Function**
> (`supabase/functions/isbn-lookup/`), invoked from the browser with
> `supabaseClient.functions.invoke('isbn-lookup', { body: { isbn } })`.

---

## 2. Browse/Search (buyer-side — book discovery)

**Purpose:** let buyers find books *listed on BookSharez*.
**Searches the local Supabase database ONLY — no external API calls, ever.**

### Target implementation (Phase 1)
- PostgreSQL full-text search using the GIN indexes already created in
  [db/schema.sql](../db/schema.sql):
  ```sql
  CREATE INDEX idx_books_title_search  ON books USING gin(to_tsvector('english', title));
  CREATE INDEX idx_books_author_search ON books USING gin(to_tsvector('english', author));
  ```
- Query `listings` joined to `books`, restricted to `status = 'active'` (RLS
  already enforces this for anon/other users).
- Filter by condition (`like_new`, `very_good`, `good`, `acceptable`).
- Sort by: newest, price low→high, price high→low.
- Search fields: title, author. (ISBN search is in the spec's feature list —
  exact-match on `books.isbn` — but is **not** fuzzy.)
- Target performance: <500ms.

### Phase 1 constraints — do NOT build these
- ❌ No fuzzy matching
- ❌ No autocomplete / suggestions
- ❌ No external book-source results in buyer search
- ❌ No affiliate links (see deferred section below)

### Current prototype status (interim)
The hero/browse search in [js/main.js](../js/main.js) (`searchBooks()`)
currently filters the **6 hardcoded `sampleBooks`** in memory by title/author
substring. This is a **placeholder** for the Supabase full-text query above; it
will be replaced once listings are persisted to the database. It is buyer-side
and local-only, consistent with this design — it simply has no real data yet.

> Stack translation: the briefing's `src/app/(main)/browse/page.tsx` is, for us,
> the homepage search UI in `index.html` + `searchBooks()` in `js/main.js`,
> which will call `supabaseClient.from('listings').select(...)` (RLS-scoped)
> instead of a React server component.

---

## Affiliate fallback strategy — DEFERRED (not Phase 1)

Documented for awareness only. **Do NOT implement any affiliate functionality in
Phase 1.**

An affiliate strategy was discussed for when buyer search returns no local
inventory (to keep early users engaged while inventory is thin):
- Show local inventory first.
- If no results → a "Not finding what you need?" section with affiliate links to
  Bookshop.org (~10%), Amazon Associates (up to 10%), Better World Books (~5%).
- Requires separate affiliate account signups + integrations.

This is **not in [PHASE_1_MVP_SPEC.md](PHASE_1_MVP_SPEC.md)** and is deferred to a
later phase.

---

## Key files (remapped to this project's stack)

| Briefing (Next.js) | This project (vanilla JS + Edge Functions) | Role |
|---|---|---|
| `src/lib/isbn-lookup.ts` | `supabase/functions/isbn-lookup/` (planned) | ISBNdb + Google Books fallback |
| `src/app/api/isbn/route.ts` | same Edge Function (the function *is* the endpoint) | server-side ISBN endpoint |
| `src/lib/ai-pricing.ts` | `supabase/functions/pricing/` (planned) | price estimation |
| `src/app/(main)/browse/page.tsx` | `index.html` + `searchBooks()` in `js/main.js` | buyer-facing search/browse |
| `ERROR_HANDLING_PATTERNS.md` | same | API error handling |
| `PHASE_1_MVP_SPEC.md` | same (authoritative) | spec |
| `ISBNdb_API.md` | same | ISBNdb reference |
| `.env.local` | Supabase Edge Function secrets + `js/supabase-config.js` (public keys) | secrets / config |
