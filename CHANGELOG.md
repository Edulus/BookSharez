# Changelog

All notable changes to BookSharez are recorded here — an **internal engineering
record**, not all entries are user-facing.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project has not had a tagged release yet, so everything to date lives under
**[Unreleased]**. The granular record is the git history; this file is the
curated summary. Forward-looking work lives in [ToDo.md](ToDo.md); decision
rationale lives inline in the relevant docs (e.g. the ADR in
[docs/PHASE_1_MVP_SPEC.md](docs/PHASE_1_MVP_SPEC.md)).

---

## [Unreleased]

_Phase 1 backend foundation + documentation. Work to date: 2026-06-14 – 2026-06-15._

### Added (June 17 — Phase 2: shelf system, profiles, follow graph)
- **Shelf system** — two new dashboard tabs: "Books I Have" and "Books I Want".
  Each tab shows the logged-in user's `shelf_entries` with book cover thumbnails.
  "Add Book" (header button or in-tab link) opens a new modal: ISBN lookup (same
  Edge Function + client fallback pipeline) → adds a `shelf_entries` row and
  navigates to the relevant tab. "Remove" deletes the row. "List for Sale" on a
  "Books I Have" item opens the sell modal pre-filled with that book's data,
  passing `shelf_entry_id` through to the new `listings.shelf_entry_id` FK — the
  architecture invariant ("selling always flows through the shelf") is now
  enforced in the UI. The "Sell Books" header button was rewired to
  `showAddToShelfModal('have')` accordingly.
- **Profile page** — clicking a seller name on the book detail page opens their
  public profile: username, bio, follower/following counts, and their public
  "Books I Have" / "Books I Want" shelves rendered as a cover-art grid.
  Follow/unfollow button (authenticated users only; hidden when viewing your own
  profile). Seller name on the detail page is now fetched from `profiles` and
  linked.
- **Profile settings** — new "Profile" tab in the dashboard: username (3–30
  chars, letters/numbers/underscores; unique) + bio (≤300 chars). Upserted to
  `profiles` on save; duplicate-username error surfaced inline.
- **`db/phase2_schema.sql`** — paste-ready SQL creating `profiles` (with
  signup trigger + backfill for existing users), `shelf_entries` (UNIQUE on
  user+book+type), `follows` (no self-follows), and the nullable
  `listings.shelf_entry_id` FK. Full RLS on all three new tables.

### Added (continued — June 16)
- **Server-side ISBN lookup** — `supabase/functions/isbn-lookup/index.ts`: the
  project's second Edge Function. Cache-first strategy: checks the `books` table
  first (instant, no quota); falls through to ISBNdb (key stays server-side, 1
  req/sec in-memory rate gate) then Google Books (optional key, free quota) on a
  miss; upserts the result via the service-role client so every repeat lookup is a
  cache hit. Handles ISBN-10 and ISBN-13, normalizes to ISBN-13 for storage,
  validates check digits, parses dates flexibly. JWT auth prevents anonymous users
  burning ISBNdb quota. The browser's `lookupISBN()` now calls this function first
  and falls back to the old client-side pipeline (Open Library → Google Books) only
  if the Edge Function is unreachable — keys never reach the browser either way.
  **Paste-ready artifact** (same convention as `db/*.sql` and `pricing`): deploy by
  pasting into Supabase Dashboard → Edge Functions → New function (name:
  `isbn-lookup`). Set `ISBNDB_API_KEY` once you subscribe; `GOOGLE_BOOKS_API_KEY`
  is optional.

- **AI price suggestion (DeepSeek)** — the project's **first Edge Function**,
  `supabase/functions/pricing/index.ts`: validates the caller's JWT
  (`docs/SECURITY_CHECKLIST.md` pattern), prompts DeepSeek for a used-book price
  estimate given title/author/condition, validates the response, and returns
  `{price, confidence}`. The browser's new `estimatePrice()` calls it via
  `supabaseClient.functions.invoke('pricing', …)` and falls back to the
  condition-multiplier algorithm from `docs/ERROR_HANDLING_PATTERNS.md` on any
  failure (timeout, bad key, invalid response) — mirrors that doc's pattern
  exactly. Wired to a new "Suggest price" button on the sell form
  (`suggestPrice()`); the price field stays editable so the user can override.
  **Deployed and verified live June 16** — pasted into the Supabase Dashboard's
  Edge Function editor (no CLI in this dev environment, so the function source
  doubled as a paste-ready artifact, same convention as `db/*.sql`); the
  `DEEPSEEK_API_KEY` secret is set; tested successfully against a real book
  lookup.

### Removed
- **Vestigial in-memory arrays** `sampleBooks` / `userBooks` from `js/main.js` —
  dead since browse/search and the sell flow moved to live Supabase data; no
  remaining references.

### Added
- **Listing photo upload (3–5 photos)** — the sell form now takes 3–5 photos
  (required; JPEG/PNG/WebP, ≤5 MB each, validated client-side to match the
  bucket caps). On submit the listing is created first, then photos upload to
  the private `listing-photos` bucket under `<listingId>/…` (the path the
  Storage + `listing_photos` RLS policies key off) and a `listing_photos` row is
  recorded per file (storing the storage **path**, not a URL). The book detail
  page renders them as a gallery via short-lived **signed URLs** (private
  bucket). Photo upload failures don't lose the listing — the user is told some
  photos didn't upload. No schema change (table/bucket/policies already applied).
- **Book detail page** — clicking a listing card opens a full detail view
  (cover, condition badge, title/author/ISBN, price, description, seller) as a
  toggled "page" (same display-toggle approach as homepage/dashboard; no
  routing). Fetches the full listing by id (incl. `description`) on click; all
  fields rendered via `.textContent`. "Buy Now" is visual-only (reuses
  `buyBook`; Stripe is Phase 3). Photo gallery has a marked mount point for a
  later step. Purely client-side — no schema/key/Edge-Function change.
- **Real Supabase authentication** — sign up, login, logout, and session
  persistence, replacing the prototype's fake login. (`aa89912`)
- **Supabase browser client** in `js/supabase-config.js` (project URL +
  publishable/anon key only).
- **Database schema applied in Supabase** — `books`, `listings`,
  `listing_photos` with indexes, RLS policies, and Storage policies, captured as
  a paste-ready `db/schema.sql`. (`f35800b`, `a8aae0b`)
- **`books` RLS** — enabled with a public read-only policy; writes restricted to
  the service-role Edge Function. Deliberate, documented deviation from the
  verbatim spec (which left `books` without RLS). (`9ae1014`)
- **RLS test harness** `db/rls_test.sql` — seeds two users + listings and runs 8
  cross-user access checks under the real `anon`/`authenticated` roles.
  **All 8 pass.** (`1d4bd56`, `e294b5f`)
- **`listing-photos` Storage bucket** settings recorded: private, 5 MB cap,
  `image/jpeg`+`png`+`webp` only. (`2425c3b`)
- **Design docs:**
  - `docs/ISBN_LOOKUP_DESIGN.md` — the `isbn-lookup` Edge Function: cache-first
    against the `books` table, ISBNdb → Google Books fallback, rate-limiting
    approach (ToDo items 9 & 10). (`fde9349`)
  - `docs/SEARCH_SYSTEMS.md` — the two distinct "search" systems (seller-side
    ISBN lookup vs. buyer-side local browse); affiliate fallback marked
    deferred. (`31919bd`)
- **This `CHANGELOG.md`.**
- **Product Vision + Architecture docs:** `docs/BOOKSHAREZ_PRODUCT_VISION.md`
  (non-technical "what/why/who" — the authoritative product conception) and
  `docs/BOOKSHAREZ_ARCHITECTURE.md` (full target design, phased). Establishes
  BookSharez as a community-first marketplace (peer-to-peer trade + reader-
  identity shelves + per-book discussion), of which Phase 1 ships only the
  marketplace foundation.
- **Document authority hierarchy:** PRODUCT_VISION (why) → ARCHITECTURE (full
  target, phased) → PHASE_1_MVP_SPEC (current Phase-1 build). Authority headers
  added to each.

### Changed
- **Condition grades: 4 → 5** (June 15). Switched from
  `like_new/very_good/good/acceptable` to the industry-standard
  `like_new/very_good/good/fair/poor` across the app, schema, seed, and docs
  (with plain-language definitions in PHASE_1_MVP_SPEC). Migration:
  `db/condition_5grade.sql` (remaps existing `acceptable` → `fair`).
- **Catalog book writes relaxed for Phase 1:** authenticated users may INSERT
  `books` from the browser (was service-role-only), so the sell flow can add a
  new ISBN without an Edge Function yet. Documented simplification, to be moved
  server-side when ISBN-lookup is built.
- **Architecture pivot recorded:** vanilla HTML/CSS/JS + Supabase Edge Functions
  chosen over Next.js (ADR in `docs/PHASE_1_MVP_SPEC.md`).
- **Docs converted off Next.js/React/TypeScript** to vanilla JS + Edge Functions
  across `PHASE_1_MVP_SPEC.md`, `SECURITY_CHECKLIST.md`,
  `ERROR_HANDLING_PATTERNS.md`, `PHASE_1_OPERATIONS.md`, and `env.example`:
  TS code samples converted to JS; `middleware.ts`/`app/api` route handlers →
  Edge Functions; Zod → plain-JS validation; `process.env.*` → `Deno.env.get`;
  `NEXT_PUBLIC_*` dropped; Vercel → host-agnostic. (`f35800b`, `3ce3acc`)
- **Prototype condition values** aligned to the spec's 4 grades (`like_new`,
  `very_good`, `good`, `acceptable`) — dropped `fair`/`poor`, hyphens →
  underscores — so listing inserts pass the DB CHECK constraint. (`96e90ab`)
- **Buyer-side search heading** toggles to "Search Results" during a query and
  back to "Featured Books" when cleared. (`31919bd`)
- **Harmonized docs to the new vision:** scoped `PHASE_1_MVP_SPEC.md`'s
  authority to "Phase 1 implementation"; pointed its deferral list at
  ARCHITECTURE §11 as the canonical phase roadmap; updated `SEARCH_SYSTEMS.md`
  (affiliate is now the "No Dead Ends" core invariant, still post-Phase-1);
  refreshed `CLAUDE.md` (community-first definition, doc hierarchy, corrected
  stale Next.js/Vercel/not-a-git-repo/condition-mismatch lines). Resolved an
  internal "seller rating" vs. no-ratings inconsistency in ARCHITECTURE §7.4.

### Added
- **ISBN auto-fill in the sell form**: enter the ISBN and tap "Look up" → title,
  author, and cover image fill in automatically. Tries multiple free, keyless
  sources in order — the BookSharez catalog → **Open Library** → **Google Books**
  — so a rate-limited/down source doesn't block the lookup (Google's keyless
  quota 429s easily). Falls back to manual entry; ISBN moved to the top of the
  form; the saved book stores the cover so listings show real covers. Interim
  ahead of the server-side ISBNdb version (ISBN_LOOKUP_DESIGN.md).
- **Condition filter + sort on browse/search** (**pending live verification**):
  a condition dropdown (All + the 5 grades) and a sort selector (Newest / Price
  low→high / high→low) above the grid, applied server-side to both browsing and
  search via a shared query builder.
- **My Shelf reads real listings** (Step 3, **verified live June 15**): the
  dashboard now lists the logged-in user's own listings from Supabase (all
  statuses) with working **delete**, **mark-as-sold**, and a basic **edit price**
  (RLS scopes everything to the owner). Replaces the in-memory placeholder; the
  old `editListing` alert and in-memory delete are gone.
- **Sell flow persists to Supabase** (Step 2, **verified live June 15**):
  `handleSellBook()` validates input, ensures the catalog `books` row exists for
  the ISBN, then inserts the listing under the logged-in user. ISBN is now
  required on the form. New RLS policy lets authenticated users add catalog books
  (`db/books_insert_policy.sql`) — a Phase-1 simplification (see Changed). Photos
  still deferred; needs the policy applied + a live test before it's "done."
- **Buyer-side browse/search now reads real data from Supabase** (Step 1 of
  persistence). `loadFeaturedBooks()` + `searchBooks()` query active `listings`
  joined to `books` (local DB only, never external), with `ilike` title/author
  matching and XSS-safe rendering (also closes the `innerHTML` XSS gap). Demo
  data via `db/seed.sql` until the sell flow persists real listings.

### Fixed
- **Hero search appeared broken:** results render in the Featured section below
  the fold and the page never scrolled there (and "two" matched none of the 6
  demo books). `searchBooks()` now scrolls results into view. (`31919bd`)

### Removed
- Stray root duplicate of `PHASE_1_OPERATIONS.md` (pre-conversion copy) and
  `claude-project-files.zip`.
- `docs/VISION.md` — a redundant engineering spec (~90% overlap with
  BOOKSHAREZ_ARCHITECTURE.md, which fully supersedes it) and a misleading name
  (its content was a spec, not the vision). **Moved to `ARCHIVE/VISION.md`**
  (kept for reference, marked superseded) rather than deleted outright.

### Deferred (decisions pending)
- **AI pricing provider** (Anthropic vs OpenAI) — decide at pricing-function
  build time; docs lean Anthropic. (`2037c41`)
- **ISBNdb Basic plan** subscription — start when the ISBN lookup build begins.
  (`2037c41`)

### Project
- Initialized git; committed the prototype baseline. (`e708d78`)
