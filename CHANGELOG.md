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

_Phase 1 backend foundation + documentation. Work to date: 2026-06-14 – 2026-07-04._

### Added (July 4 — Notifications rail + want-match notifications)

- **Notifications rail** (improvement plan §5.4) — one generic `notifications` table ([db/notifications.sql](db/notifications.sql), **pending Supabase apply — ToDo item 13**) designed to serve every future notification type (want-match now; "interested" pings, follows, mentions, discussion replies later). Columns: recipient, `type`, `actor_id`, polymorphic `subject_type`/`subject_id`, denormalized `payload` JSONB, `read_at`. RLS: owner-only read/update/delete, **no client INSERT** — rows are created exclusively by `SECURITY DEFINER` triggers, so notifications can't be forged.
- **Want-match notifications** (improvement plan §3.1, vision: "add it to your wish list and get notified when a copy becomes available") — `notify_want_match()` trigger fires when a listing is inserted with `status='active'` and notifies every user with that book on their Want shelf (except the seller), payload carrying title/author/price/seller username so the client renders with zero extra queries.
- **Header bell UI** — bell button + badge (unread count, 99+ cap) in the header, shown when logged in; dropdown panel with the latest 20 notifications, unread highlighting, relative timestamps, "Mark all read", and click-outside-to-close. Clicking a notification marks it read and routes to its subject (`#/listing/<id>` for want-matches). Client degrades silently if the SQL isn't applied yet (hidden badge + friendly panel message). New JS: `refreshNotifBadge`, `toggleNotifications`, `loadNotifications`, `_renderNotifItem`, `_openNotification`, `markAllNotificationsRead`; wired into `applyAuthState` (show/hide + refresh on login/logout). Notification CSS in `style.css` (`.notif-*`).
- **Verified:** [verify-notifications.js](verify-notifications.js) Playwright harness (mocked Supabase REST): bell hidden when logged out; badge count renders; panel lists items with unread styling; clicking routes to the listing page and issues the mark-read PATCH; mark-all-read PATCH clears the badge; zero page errors.

### Added (July 4 — Hash routing: shareable URLs + working back button)

- **Hash router** (improvement plan §5.1) — pages are now addressable: `#/` (browse), `#/listing/<id>`, `#/book/<bookId>`, `#/profile/<userId>`, `#/dashboard[/<tab>]`. Deep links load the right page on a fresh visit, refresh stays put, and browser back/forward work. No framework; the display-toggle mechanism is unchanged.
  - Design: page functions *record* their route (`_setRoute`), the `hashchange` listener *applies* routes (`_applyRoute`) for back/forward and direct loads; a write counter (`_routeWrites`) suppresses the echo event from our own hash writes, so navigation never double-renders. `""`/`#` are treated as `#/` so re-showing the homepage never pushes a phantom entry (preserves the forward stack).
  - Dashboard: `showDashboard(tab)` now takes an optional tab (whitelisted via `DASHBOARD_TABS`; tolerates the `MouseEvent` from `loginBtn.onclick`); tab switches use `history.replaceState` so one Back leaves the dashboard instead of replaying every tab. Bare `#/dashboard` normalizes to `#/dashboard/shelf-have` without a history trap. Deep-linking `#/dashboard` works with a restored session because the initial route is applied after the first `onAuthStateChange` fires (also keeps the logged-out homepage reset from clobbering public deep links). Logout resets the URL to `#/`.
  - External-search books (no catalog id) stay unrouted — their page is built from an in-memory object a URL can't reconstruct.
  - **Verified:** new [verify-routing.js](verify-routing.js) Playwright harness (mocked Supabase REST, port 7654) — 20 checks covering click-through routes, back/forward, deep links, refresh persistence, dashboard tab replace-semantics, unknown-route fallback, zero page errors. `verify-bookflow.js` full regression re-run: all flows still pass.

### Added (July 4 — Improvement plan + quick wins)

- **[docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md)** — comprehensive advisory review of the whole project: current state, quick wins, marketplace-loop gaps (want-match notifications, trust signals, book-page aggregation), social-layer build order (feed → reviews → reading statuses → recommendations), architecture priorities (hash routing ★, `main.js` module split, FTS search, shared notifications rail), security hardening, UX/accessibility, tooling/ops, and a sequenced roadmap. Advisory only — does not override the vision → architecture → spec hierarchy.
- **Quick wins applied (plan §2):**
  - Fixed `<title>` typo ("Book**e**Sharez" → "BookSharez") in [index.html](index.html).
  - Added SEO/social meta tags (`description`, Open Graph, Twitter card) and an emoji 📚 SVG favicon (data URI, no asset file) to `index.html`. No `og:image`/`og:url` yet — add when the site has a public URL.
  - `loading="lazy"` on all book-cover images across the renderers: `_renderTile`, `_renderThumb`, listing cards (`loadUserListings`), detail-gallery thumbs, the shelf/sell picker rows (`renderBookSearchResults`), and shelf tiles (`_renderShelfTile`). The main `#detailCover` stays eager (primary content). `node --check` passes.
  - Deleted `css/style_B.css` — unlinked from `index.html` since June; had drifted out of sync with `style.css` (it was a stale snapshot, not a variant). Git history preserves it. CLAUDE.md reference updated.

### Added (July 3 — Supabase keep-alive automation)

- **Supabase Free-Plan auto-pause prevention** — GitHub Actions workflow [.github/workflows/keep-alive.yml](.github/workflows/keep-alive.yml) pings the Supabase REST API (`GET /rest/v1/books?select=id&limit=1`, anon key, RLS enforced) every 3 days, resetting the 7-day inactivity pause timer. Prompted by a pause-warning email (July 3). Fully zero-maintenance: each run also calls the GitHub API to re-enable its own schedule, defeating GitHub's 60-day scheduled-workflow deactivation; GitHub emails on run failure. Repo secrets `SUPABASE_URL` / `SUPABASE_ANON_KEY` set (both public-safe values). **Deployed and verified July 3** — manual dispatch run returned HTTP 200. Delete the workflow when the project moves to Supabase Pro (the pre-launch plan of record).

### Added (June 21 — Unified book page + browse-flow polish)

- **Unified, book-centric detail page (architecture §5.4)** — one `_renderBookPage(book, offers)` renderer on the existing `#bookDetail` surface now backs every "tell me more about this book" click. Shows book metadata, **community seller offers as primary** (rendered as `renderBook` tiles into a new `#detailOffers`/`#detailOffersGrid` — §6A contract, no hand-built cards; each tile links to its listing via `viewListing`), **affiliate offers as secondary** (Amazon + AbeBooks search links by ISBN/title, no keys — `renderAffiliateLinks`), the community want-count (social proof), and discussion — never a dead end (§4.3/§4.4).
  - `browseBookById(bookId)` rewritten: was a homepage *grid*, now fetches the catalog book + its active listings and renders the book page. Repoints all four call sites at once (community-shelf tiles, profile thumbnails, both My Shelf cards).
  - External search results (no catalog id) open the same page via `viewExternalBook(book)` → `_renderBookPage(book, [])`. **Clicking an external book no longer opens the Add-to-Shelf modal** — it opens the rich page, which offers Add to Shelf as a button.
  - Shared social enrichment: `_loadBookSocial(bookId, token)` (want-count + discussion) used by both the catalog path (id known) and the external path (`enrichExternalBook` matches by ISBN first). All async work guards on a synthetic page token so a fast navigate-away can't populate a stale page. `viewListing` (single-offer page) unchanged, and now hides the book-page-only sections so toggling between the two is clean.

- **Browse-flow polish** — book cards 15% larger (`.books-grid` min column 280→322px; card image 250→288px). Removed the "not yet available on BookSharez" line (and the dimming) from external tile cards — all books are available via affiliates; the "Not listed locally" badge and "Be the first to list this!" CTA were kept.

- Verified end-to-end via `verify-bookflow.js` Playwright harness (mocked Supabase REST + Google Books, real DOM clicks): all four flows pass — larger cards with no "not available" text; external book → rich page (no modal) + affiliate links; catalog book → unified page with two seller offer tiles; offer tile → single-listing page. Zero console errors.

### Added (June 21 — Want count + Discussions)

- **Want count on book detail page** — `#detailWantCount` shows "N people want this book" (with heart icon) below the seller line. Populated async via a `shelf_entries` count query (public `want` entries only, enforced by RLS). Clears on navigation; hidden when count is zero. `book_id` added to the `viewListing` fetch select.

- **Discussion section on book detail page** — flat per-book post thread rendered below the listing details. Schema in `db/discussions.sql` (pending Supabase apply — see ToDo item 8). Client-side: `loadDiscussion(bookId, listingId)` fetches posts + batch-fetches author usernames in two queries; `_renderDiscussionPosts` renders them with relative timestamps, clickable usernames (→ profile), and a delete button for own posts. Compose area with char counter (max 2000) shown to logged-in users; "Log in" prompt shown to anon. Navigation guard (`currentDetailId`) prevents stale renders on fast page switches. `_relativeTime(iso)` helper formats timestamps (just now / Nm ago / Nh ago / Nd ago / date).

### Added (June 20 — Vision OCR + renderer consolidation)

- **Vision OCR — barcode recovery + cover photo paths** — two new listing entry points alongside the existing barcode scanner:
  - *Barcode recovery:* when Quagga2/BarcodeDetector returns no result, a "Try AI barcode reader" button (`#scannerVisionFallback`) appears. Clicking it sends the saved `_lastScanFile` to the `vision-extract` Edge Function (barcode mode); a valid ISBN routes into the existing `_onBarcodeDetected` → `isbn-lookup` chain. Invalid/missing ISBN surfaces manual entry.
  - *Cover photo:* a "Read Book Cover" file input (`#scannerCoverInput`) sends the image to `vision-extract` (cover mode). High-confidence ISBN on the cover routes straight to the barcode flow; otherwise title+author feed `searchBooksAPI` and candidates render in `#scannerCoverResults` via the existing `renderBookSearchResults` picker — user always confirms before auto-fill. Both failure branches surface `#scannerManualEntry`.
  - Four JS functions in `js/main.js`: `_compressAndEncode(file)` (canvas resize if > 4.5 MB), `_callVisionExtract(base64, mimeType, mode)` (calls Edge Function with user JWT, user-safe errors on failure), `retryWithVision()` (barcode path), `scanCoverPhoto(input)` (cover path). `scannerReset()` and `closeBarcodeScanner()` both clear the new divs.
  - `GEMINI_API_KEY` never reaches the browser. Verified by `verify-vision.js` Playwright harness: all DOM checks, JS function checks, Path A (cover → candidates → confirm), and Path B (scan fail → AI retry → ISBN) pass. Zero console errors.

- **`vision-extract` Edge Function deployed** — JWT-gated Deno function on Supabase. Two modes: `cover` → `{title, author, isbn, confidence}`; `barcode` → `{isbn, confidence}`. Strips markdown fences defensively, 10 s timeout, user-safe errors only. `GEMINI_API_KEY` secret set (Generative Language API, `booksharez` GCP project). Model: `gemini-3.5-flash`.

- **Book object rendering contract (§6A)** — single `renderBook(book, context, density)` function replacing five separate renderers (`createBookCard`, `createExternalBookCard`, inline community-shelf card, `renderProfileShelf` DOM loop, `viewListing` DOM manipulation). `normalizeBook(raw)` maps any source shape to `Book = {bookId, isbn, title, author, coverUrl, year}`; `BookContext` carries viewer-relative state; `renderBook` dispatches to `_renderTile`/`_renderThumb`/`_renderFull`. One `FALLBACK_COVER` constant. `allSearchResults` converted to `{book, context}` pairs. `buyBook()` signature changed to `(listingId, price, title)`; `_renderFull` wires the detail-page Buy Now button directly, removing the inline `onclick` from `index.html`. `displayedListings` global eliminated. Contract documented in `docs/BOOKSHAREZ_ARCHITECTURE.md` §6A and `CLAUDE.md`. Verified across all five rendering paths by Playwright harness.

### Changed (June 20)

- **`.gitignore`** — added `node_modules/`, `package.json`, `package-lock.json`.

### Note on commit history (June 20)

`9db85bf` ("Renderer consolidation") contains both the renderer work and the vision OCR client-side wiring — batched in one pass, not individually bisectable. `426ee57` ("Add Vision OCR feature") contains the Edge Function source, verify harness, and spec doc only. The commit messages understate `9db85bf`'s contents.

---

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
