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

### Security (June 18 — API key incident response + prevention)

- **Google Books API key removed from client-side code** — the key was committed in `js/supabase-config.js` and exposed when the repo was made public for GitHub Pages. Remediation: old key deleted in Google Cloud Console; new key added as a Supabase Edge Function secret (`GOOGLE_BOOKS_API_KEY`) so only `isbn-lookup` uses it server-side. Both client-side Google Books call sites (`lookupGoogleBooks`, `searchBooksAPI`) are now keyless (lower-quota anonymous calls — acceptable for Phase 1; Open Library is the automatic fallback on 429).
- **Pre-commit hook** — `.git/hooks/pre-commit` blocks commits that contain Google API key patterns (`AIzaSy…`), generic secret keys (`sk-…`), and Supabase service-role JWTs. Tested: staging a file with a fake key exits 1 with a clear error message.
- **GitHub Actions secret scan** — `.github/workflows/secret-scan.yml` runs `gitleaks/gitleaks-action@v2` on every push and pull request (full history scan via `fetch-depth: 0`).
- **CLAUDE.md security rules** — non-negotiable rules added at the top of `CLAUDE.md`: only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are allowed in committed JS; all other keys must live in Supabase Edge Function secrets; any new external API requiring a key must be proxied through an Edge Function.

### Fixed (June 18 — barcode scanner)

- **Scanner modal blank body on mobile** — the `.modal-content` `display:flex` layout caused `.modal-body` (`flex:1`) to collapse to zero height in an unconstrained viewport. Fixed by removing the flex layout from `.modal-content`/`.modal-header` entirely and replacing `.modal-body`'s flex rule with `overflow-y: auto; max-height: calc(96vh - 80px)`.
- **Scanner restructured: photo-first UX** — the scanner modal now shows "Take a Photo" and "Choose from Gallery" buttons immediately on open, with a divider and an optional "Use Live Camera" button below. Live camera only starts when the user taps it (was auto-starting, which also caused "stuck on looking up" hangs).
- **isbn-lookup Edge Function deployed** — was written but never deployed; pasted into Supabase Dashboard → Edge Functions (name: `isbn-lookup`). `GOOGLE_BOOKS_API_KEY` secret set with the new rotated key.
- **API call timeouts hardened** — `lookupViaEdgeFunction`, `lookupOpenLibrary`, and `lookupGoogleBooks` each gained an `AbortController` timeout (5–6 s). Previously had none, causing "stuck on looking up" if any request hung.

### Added (June 17 — continued: Google Books API, sell modal polish, clickable books, UI fixes)

- **Google Books API key wired in** — authenticated API key added to `js/supabase-config.js`
  (`GOOGLE_BOOKS_API_KEY`) and appended to both client-side call sites: `lookupGoogleBooks`
  (ISBN lookup fallback) and `searchGoogleBooks` (title/author search). Supabase Edge Function
  secret set so the `isbn-lookup` function also uses the key. Open Library remains the automatic
  fallback on any error. Previous sessions were hitting a 0/day anonymous quota.

- **Sell modal: cover preview** — when a book is selected (via search, ISBN lookup, or "List for
  Sale" from shelf), the API cover image now appears in the modal with a note encouraging the
  seller to upload photos of their actual copy. Preview resets when the modal closes.

- **Sell modal: photos now optional** — removed the "3–5 photos required" gate; 0–5 photos
  accepted. The upload path, per-file validation (type/size), and Storage upload are unchanged.

- **External book cards clickable** — search results for books not yet listed on BookSharez
  ("Not listed locally") now open the Add to Shelf modal pre-filled when clicked. CTA changed
  from "Find online" link to "Be the first to list this!" The `shelfIsbnStatus` ID case bug
  (was `shelfISBNStatus`) that silently prevented the modal from opening is fixed.

- **Cover images no longer cropped** — switched from `object-fit: cover` to
  `object-fit: contain` + `background: #f5f5f5` on all book card images so portrait covers
  display in full without cropping.

- **"For Sale" badge on shelf covers** — dashboard "Books I Have" and public profile shelf
  both show a purple "For Sale" badge in the top-right corner of any book cover that has an
  active listing. Profile page fetches active listing ISBNs in the same `Promise.all` as the
  other profile data.

- **Shelf books clickable everywhere** — "Books I Have", "Books I Want", and public profile
  shelf covers all navigate to search results for that book on click. Converted inline
  `onclick` + `JSON.stringify` (which broke on titles with special characters) to
  `addEventListener` across both dashboard shelf renderers.

- **Cover images in For Sale listing cards** — dashboard "For Sale" tab now shows the book
  cover thumbnail to the left of the listing info. Query updated to fetch `cover_url` from
  the joined `books` row.

- **CSS architecture fix** — `.listing-card`, `.listing-main`, `.listing-cover`, and related
  rules moved from a lazy JS-injected `<style>` block (only applied when the "For Sale" tab
  was visited) to `css/style.css`. Shelf tabs were broken because the styles weren't in the
  DOM on first load. Shelf headings centered; item gap increased to `1.5rem`.

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
