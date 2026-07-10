# Changelog

## July 10, 2026

- Formalized the long-term Sharez platform direction across the product vision,
  canonical architecture roadmap, improvement sequence, and master backlog.
  Added [docs/SHAREZ_PLATFORM_ROADMAP.md](docs/SHAREZ_PLATFORM_ROADMAP.md) with
  shared-core boundaries, vertical contracts, validation gates, Phase 5A–D,
  and named CD/DVD/Vinyl/Game candidate products.
- Added a full-resolution cover lightbox to book/listing detail pages. Covers
  open by click, Enter, or Space; common Google Books/Open Library URLs request
  their larger variant and fall back to the displayed image if unavailable.
  The modal supports 100–500% cursor-centered mouse-wheel zoom, double-click
  reset, and Escape/backdrop/close-button dismissal.
- Deduplicated the homepage's “Books Our Members Want/Have” grids by normalized
  title + author first, with ISBN as the fallback for incomplete metadata.
  Different editions of the same work now produce one community card.
- Added listing-photo lifecycle cleanup: marking a listing sold or deleting it
  now removes its private `listing-photos` Storage objects and metadata rows.
  Failed metadata inserts also roll back the uploaded object immediately.
- Added rerunnable owner DELETE policies in
  [db/listing_photo_cleanup.sql](db/listing_photo_cleanup.sql), pending Supabase
  application (ToDo 18), and included the policies in the baseline schema.
- Made `ToDo.md` the explicit master backlog and reduced `FOR_YOU_TO_DO.md` to
  active user-only actions. Demoted ISBNdb to an optional paid enhancement and
  made the pending SQL scripts safer to rerun.

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

### Fixed (July 9 — Sitewide cover fallback no longer depicts a specific real book)

- User-reported: browsing the live site, some listing covers looked like generic stock photos rather than the actual book. Root cause: `FALLBACK_COVER` (shown whenever `cover_url` is missing/broken) was a fixed Unsplash lifestyle photo that happens to depict a real, recognizable book — "milk and honey" by Rupi Kaur — so any *unrelated* listing with no cover looked like it was showing that book's cover. Confirmed live on a genuine listing ("RLS Test Book," `cover_url: null`).
- Replaced with an inline SVG book glyph (light-gray background, a simple book-with-spine icon) — no network dependency, and it can't be mistaken for real cover art. **Consolidated three near-duplicate fallback constants into the one CLAUDE.md already calls for** (`FALLBACK_COVER`, §6A): main.js's `SHELF_COVER_FALLBACK` and scanner.js's `SCANNER_COVER_FALLBACK` (both pointing at the same photo at different crop sizes — no longer needed since SVG scales via the `<img>` element itself) are deleted in favor of importing the one export from [js/book-render.js](js/book-render.js).
- **Separately, `db/seed.sql`'s demo data was found live in production** with the same class of problem (6 books seeded with random Unsplash stock photos as placeholder covers, mixed into real listings under a fake seller). New [db/remove_seed_data.sql](db/remove_seed_data.sql) — **pending apply, ToDo item 17** — removes the demo seller/listings while preserving seed catalog books that acquired real listings, shelf entries, or discussions.
- **Verified:** full 8-harness sweep green (batchscan, vision, bookflow, mobile, routing, security, notifications, enrichment); live screenshots of both the raw SVG and the real listing that exposed the bug, confirming the fix.

### Added (July 9 — Trust signals on the listing detail page, plan §3.2)

- The single-listing detail page's seller block now shows **member-since date, shelf size, follower count, and active listings count** alongside the seller name/link — reader identity as trust, not just an anonymous name. One `Promise.all` of four queries (`profiles.created_at`, `shelf_entries` count, `follows` count, `listings` count) replaces the old seller-name-only fetch; RLS already scopes the shelf-size count to the seller's *public* entries for non-owner viewers (`shelf_entries` policy: owner sees all, others see `visibility='public'` only) — no new query filter needed. New `#detailSellerTrust` element, cleared alongside `#detailSeller` on the unified book page (it has no single seller). New `_formatMemberSince()` helper ("Member since Jul 2026").
- **Harness gotcha fixed along the way:** `verify-bookflow.js`'s shared `json()` mock helper was missing `access-control-expose-headers: content-range` — without it the browser hides that header from supabase-js entirely, so every `{ count: 'exact', head: true }` query silently resolved `count: null`. (The same gotcha [verify-notifications.js](verify-notifications.js) already worked around; bookflow just hadn't been touched since.) Fixing the shared helper also means the pre-existing want-count check — previously only ever logged, never asserted — is now backed by a working mock.
- **Verified:** bookflow extended with member-since/shelf-size/follower/listing-count assertions on the single-listing page, and a check that the trust line clears on the unified book page (62 ✅); full sweep green; live screenshot confirmed real data ("Member since Jun 2026 · 1 follower · 1 active listing").

### Added (July 9 — One-tap Want/Have buttons on the book page, plan §3.3)

- The book page (both catalog and external variants of `_renderBookPage`) now has **"I have this" / "I want this" one-tap buttons** — building shelf identity from anywhere in browse, no detour through the Add Book modal (the Hardcover interaction pattern; shelf data feeds want-match notifications and future recommendations). `addBookToShelf()` resolves a catalog id (known `bookId`, else the shared `ensureBook` select→insert by ISBN — never a books upsert, §6.1), then the same duplicate-safe `shelf_entries` upsert `handleAddToShelf` uses. On success the button flips to a disabled "✓ On Books I Have/Want" state, the dashboard shelf refreshes in the background, and a Want tap repaints the page's own want-count. Logged-out tap → login modal. For logged-in users, `_markShelfState` pre-marks shelves the book is already on (token-guarded like every async detail fill).
- **Replaced, not added alongside:** the old `detailAddShelfBtn` ("Add to Shelf" → pre-filled modal) and its only caller `openExternalBookOptions()` are deleted — the two direct buttons cover both shelf types with fewer taps, and the modal remains reachable from the dashboard/header. Buttons are 44px tap targets; `.btn-secondary` got a scoped restyle in the detail styles (it's a white-outline style built for the purple header — the Want button was white-on-white until then).
- **Not in this pass** (still §3.3 backlog): Want/Have on browse *tiles*, and aggregating multiple listings of the same ISBN into one browse card.
- **Verified:** [verify-bookflow.js](verify-bookflow.js) extended — one-tap buttons visible on external + catalog book pages, external Have tap resolves via ensureBook and upserts `shelf_entries` (payload + `Prefer: resolution=merge-duplicates` asserted), catalog Want tap upserts and flips state without leaving the page (52 ✅); full sweep green; live-data probe at 390px confirmed buttons, 44px height, and logged-out → login modal.

### Added (July 9 — "How BookSharez Works" cards made actionable + member directory)

- User UX pass on the homepage's six "How It Works" step cards, which were static (no click affordance despite the hover lift). This reconciles two independent implementations built in parallel — a container session's `030b518` (keyboard-accessible cards + a "Start Your Bookshelf" CTA) and this session's work (member directory + card-6 decision) — into a best-of-both:
  - Cards 1–5 are now actionable **and keyboard-accessible** (`role="button"`, `tabindex="0"`, Enter/Space `onkeydown` handler): **Register** → `goRegisterOrDashboard()` (signup if logged out, dashboard if already registered — a logged-in user shouldn't see a signup form); **Build Your Bookshelf** → add-to-shelf (or signup if logged out); **List What You Want to Sell** → `showSellModal()`; **Browse for What You Want to Buy** → scroll to the live member-listings section (`#memberListingsSection`); **Explore Profiles** → the new `#/members` directory.
  - A **"Start Your Bookshelf"** primary CTA button sits below the grid (from the container session's version).
- **Card 6 ("Books Find New Homes") stays non-clickable** — user call: it's a payoff/value statement describing the outcome of a sale, not a step with its own action. (The container session had wired it to scroll to listings; reverted to plain here per the decision.)
- **Card 5 ("Explore Profiles") → new member directory** (`#/members`, [js/router.js](js/router.js)/[js/main.js](js/main.js) `showMembers()`/`backFromMembers()`): no such page existed — individual profiles were only reachable via a listing's seller link. Queries `profiles` where `visibility='public'` and `username` is set (existing RLS "Anyone can view profiles" already permits this — no new SQL), renders simple avatar-initial cards in a new `.members-grid`, each routing to the existing `viewProfile(id)` on click (event-listener, not inline onclick, per the shelf/profile-card convention). Deliberately minimal for Phase 1: no follower/shelf counts (would mean N+1 queries per card) — just username + optional bio.
- **Verified:** [verify-routing.js](verify-routing.js) gained a `#/members` deep-link + populated-grid check; full sweep green (routing, mobile, security, bookflow, batchscan, notifications, enrichment) plus a manual screenshot pass against live Supabase data.

### Changed (July 8 — Module split §5.2 phase 3: scanner extracted to js/scanner.js)

- The barcode/cover scanner cluster (~740 lines: scanner modal + live camera, photo/barcode scanning, vision OCR cover capture, manual ISBN fallback, batch-capture session chip, loop metrics) moved from [js/main.js](js/main.js) to **[js/scanner.js](js/scanner.js)** — behavior unchanged, code moved verbatim. Follows the established injection pattern: main.js wires the nine cross-boundary callbacks (`ensureBook`, shelf loaders, `lookupISBN`/`lookupShelfISBN`, `renderBookSearchResults`, `selectSellBook`/`selectShelfBook`, `_openSellModalPrefilled`) via `initScanner(deps)`; scanner.js never imports main.js. The sell-flow helpers (`_resetSellLinkage`, `_openSellModalPrefilled`) stay in main.js for the future sell extraction.
- The `_pendingLoopListing` Add & List flag is now private to scanner.js behind two tiny exports: `loopListingCreated()` (consume + bump the `listingsCreated` metric, called by `handleSellBook` on successful insert) and `loopListingCancelled()` (called by `_resetSellLinkage`) — all loop-metrics knowledge now lives in one module. Window exports are unchanged (main.js re-exports the scanner functions HTML/harnesses call).
- **Verified:** full sweep green — batchscan (63), vision, routing, mobile, security, notifications, bookflow, enrichment, live RLS.

### Added (July 8 — Project-level model tiering: scout + mech-editor agents)

- Two project agents in [.claude/agents/](.claude/agents/) implement the "expensive model for judgment, cheap models for legwork" principle **project-scoped** (deliberately not the third-party pilotfish global install — evaluated and declined in favor of copying the principle): `scout` (haiku, read-only Read/Glob/Grep, repo-oriented recon) and `mech-editor` (sonnet, fully-specified mechanical work only, primed with the house rules — §6A renderer, books append-only, window-export block, port 7654). Delegation policy added to CLAUDE.md: judgment/security/final review stay in the main session; ad-hoc spawns set `model` explicitly; two failed delegations → take over, never a third retry; no bypassPermissions. Agents load at session start (restart to activate); the haiku-tier mechanism itself verified live via a model-pinned Explore run.

### Added (July 8 — Hosting + analytics: the site is live)

- **BookSharez is publicly deployed at <https://edulus.github.io/BookSharez/>** (improvement plan §8). GitHub Pages was already enabled on the repo (legacy branch deploy from `main` root) but serving a month-old build — pushing `main` now auto-deploys the current app. Added [.nojekyll](.nojekyll) so Pages serves the files as-is (no Jekyll processing). `og:url` meta finished with the production URL. Relative asset paths, hash routing, and the dynamic `location.origin + location.pathname` reset-redirect all work unchanged under the `/BookSharez/` subpath.
- **Cloudflare Web Analytics loader** (token-gated) in `index.html`: privacy-friendly page-level traffic only — no cookies, no cross-site tracking, no product-event analytics. Fully disabled until the site token from the Cloudflare dashboard is pasted into `window.CF_ANALYTICS_TOKEN` (FOR_YOU_TO_DO 5b).
- **Environment sanity re-verified before pushing:** client files carry only `SUPABASE_URL` + the publishable anon key (public by design, RLS-protected); no service-role keys, no billing-exposed API keys; `.env` gitignored and never committed; every push is scanned by the pre-commit hook + gitleaks Action.
- **[verify-production.js](verify-production.js)** — production smoke harness against the real deployed site (no mocks, real Supabase; phone-sized viewport): title/og:url, all CDN deps loaded (supabase-js, Quagga, Html5Qrcode), ES module graph alive, browse grid painted with live data, login/signup/forgot-password/reset/report surfaces reachable, scanner modal with all four capture paths, logged-out `#/dashboard` deep link lands on login, zero console/page errors. The manual logged-in half (shelf add, Add & List, report submit, reset end-to-end) is documented as FOR_YOU_TO_DO 5c.
- User steps documented (FOR_YOU_TO_DO 5a–5c): Supabase Site URL + Redirect URLs → production domain (so password reset returns to the live site), Cloudflare analytics token, manual smoke checklist.

### Added (July 8 — Security hardening: §6.1 catalog writes, §6.2 content reporting, §6.5 password reset)

- **§6.1 Catalog (books) write hardening** — `books` is shared data; clients are now strictly **append-only**:
  - The scanner shelf-add's `upsert(…, { onConflict: "isbn" })` — the one client path whose `ON CONFLICT DO UPDATE` could overwrite a canonical title/author/cover — replaced with the shared `ensureBook` select→insert (race-safe on 23505).
  - [db/books_rls_harden.sql](db/books_rls_harden.sql) (**pending apply — ToDo 15**): asserts no client UPDATE/DELETE policy exists on `books` (with RLS enabled, absence = denied) and adds `NOT VALID` CHECK constraints (title 1–500 chars, author ≤ 500, ISBN-10/13 format, cover URL ≤ 2000) so INSERTs can't be garbage.
  - **[verify-rls-live.js](verify-rls-live.js)** — a real-network probe using the public anon key against the live project: anon read OK; anon INSERT books → 401; anon UPDATE/DELETE books and UPDATE listings → 0 rows; anon INSERT notifications → rejected. **All passing against production.** [verify-batchscan.js](verify-batchscan.js) additionally fails permanently if the client ever issues a books upsert/PATCH/DELETE again.
- **§6.2 Content reporting** — lightweight moderation intake: Report buttons on **listings** (detail page, other people's listings only), **profiles** ("Report user" beside Follow), and **discussion posts** (per-post flag link, not on own posts), all feeding one shared report modal (reason + optional details). [db/reports.sql](db/reports.sql) (**pending apply — ToDo 16**): polymorphic `reports` table with a `snapshot` JSONB capturing what the reporter saw (title/owner/excerpt — actionable even if the subject is later edited/deleted), `UNIQUE(reporter, subject)` so repeat taps get "already reported", and **INSERT-only RLS** (no client SELECT/UPDATE/DELETE — review happens in the dashboard; moderation queries included in the SQL). Degrades to a friendly message until applied.
- **§6.5 Password reset** — "Forgot password?" link on the login modal → `resetPasswordForEmail` (neutral "if an account exists…" response, never leaks account existence) → the reset email lands back on the site → the `PASSWORD_RECOVERY` auth event opens a "Set a New Password" modal → `updateUser({ password })`. **Requires the redirect URL allowlisted** in Supabase (Authentication → URL Configuration) — FOR_YOU_TO_DO item 4c.
- **Verified:** new [verify-security.js](verify-security.js) — 20 checks: report button visibility rules (hidden on own listing), full report POST payloads for all three subject types (snapshot contents asserted), no-reason submit blocked, duplicate-report message, forgot-password request + neutral messaging, empty-email guard, reset modal, mismatch guard, `updateUser` call. Plus full regression: all seven other harnesses green (batchscan 65, mobile, routing, notifications, bookflow, vision, live RLS).

### Added (July 7 — Loop metrics: the core loop's two health numbers)

- **Session-scoped capture-funnel instrumentation** (improvement plan §3.0, final item) — deliberately light: `sessionStorage` + a `console.debug("[loop]", …)` line per event; no database table, no user-facing dashboard. Run `loopMetricsSummary()` in the browser console for the live numbers.
- **Headline numbers:** `capturesPerMinute` (captures ÷ accumulated scanner-open time — the timer starts on modal open, stops on close, and survives close/reopen within the session) and `listingRate` (= `listingsCreated / captures`).
- **Event definitions:** `captures` = a book reached the found screen (single choke point: `_showBookFound` — barcode, manual ISBN, and cover-confirmed candidates including no-ISBN all count); `addsHave` / `addsWant` / `addAndList` = which intent the user tapped, kept separate; `duplicates` = shelf adds that resolved to an existing entry (an outcome overlay — the intent counter still counts); `listingsCreated` = an Add & List flow whose listing POST actually succeeded. **Intent ≠ creation:** `_pendingLoopListing` is set on the Add & List tap, consumed by `handleSellBook` on successful insert, and cleared by `_resetSellLinkage` — an abandoned sell form never counts as a created listing.
- **Verified:** [verify-batchscan.js](verify-batchscan.js) grew to 63 checks — after the mixed session (manual add-have, manual add-want, duplicate re-scan, manual Add & List, no-ISBN cover Add & List, with-ISBN cover capture) the summary reads captures 6, have 2 / want 1 / addAndList 2, duplicates 1, listingsCreated 2, listingRate 0.333, capturesPerMinute > 0; plus mid-session assertions that metrics survive scanner close/reopen and that the Add & List tap alone doesn't count as a listing. All six harnesses green.
- Caveat (also in FOR_YOU_TO_DO): apply [db/books_isbn_nullable.sql](db/books_isbn_nullable.sql) before reading no-ISBN metrics from real users — until then a failed no-ISBN save measures the schema gap, not user friction.

### Changed (July 7 — Cover-path parity: "Read Book Cover" is a first-class capture path)

- **Every capture path now lands on the same "book found" screen** with the same three choices (Books I Have / Books I Want / Add & List for Sale): new `_showBookFound(book)` is the single found-screen entry point for barcode, cover-candidate, and manual-ISBN captures. Confirming a cover candidate no longer re-routes through the barcode pipeline (`_onBarcodeDetected`) — that re-lookup discarded the title/author/cover the user had just confirmed and could downgrade to "Title unknown" on failure. `_confirmCoverCandidate` keeps the candidate's metadata and only does a cheap catalog-id lookup when an ISBN exists.
- **Pre-ISBN books are now real candidates.** `searchBooksAPI`/`searchGoogleBooks`/`searchOpenLibrary` gain a `requireIsbn` option (default `true`, so the three search modals are unchanged); the cover path passes `requireIsbn: false` — books with no ISBN (pre-~1970) appear in the candidate list instead of being silently dropped. The old no-ISBN branch in `scanCoverPhoto` was dead code *and* would have collapsed every no-ISBN book into one catalog row (upsert on `isbn: ""`).
- **No-ISBN books are shelvable and listable end-to-end:**
  - [db/books_isbn_nullable.sql](db/books_isbn_nullable.sql) (**pending Supabase apply — ToDo item 14**) drops `NOT NULL` on `books.isbn`; UNIQUE stays (NULLs don't collide). Until applied, no-ISBN adds fail with the generic retry alert; nothing else is affected.
  - `_addScannedToShelf` inserts no-ISBN books with `isbn: null` after a best-effort title+author dedup lookup (never an empty-string upsert).
  - New `currentListingBookId` rides alongside `currentListingShelfEntryId`: when the sell modal is pre-filled from a known catalog row (shelf "List for Sale" or Add & List), `handleSellBook` uses that id directly — skipping the ISBN-keyed `ensureBook` and the ISBN format requirement. Manual/search sell flows are unchanged (ISBN still required there).
  - New `_resetSellLinkage()` clears both ids on sell-modal close, outside-click close, and whenever the form's book changes (`selectSellBook`, `fillBookFields`) — this also fixes a **pre-existing stale-linkage bug** where cancelling a pre-filled sell and starting a different one could attach the new listing to the old shelf entry.
- **Verified:** [verify-batchscan.js](verify-batchscan.js) extended to 55 checks. The cover-parity section drives a mocked vision-extract cover read → two candidates (a 1955 edition with ISBN and a **1653 edition without one**) → confirms the no-ISBN candidate → same found screen, all three choices, no modal reopen, no manual-form dead end → Add & List → `books` insert with `isbn: null` → sell modal with the ISBN field empty → confirm → listing POST carrying `book_id`/`shelf_entry_id`/condition/price. The with-ISBN candidate is also asserted to land on the found screen with its metadata kept. All six harnesses green.

### Added (July 7 — "Add & List": one confirm from capture to listing)

- **Add & List for Sale** (improvement plan §3.0): the scanner's found state gains a third action beside the Have/Want pair. One tap: the book lands on **Books I Have**, the scanner closes, and the **sell modal opens pre-filled** (ISBN, title, author, cover, shelf-entry link). **Never a silent listing** — condition and price start empty by design, and the listing is created only when the seller confirms and submits; verified by an explicit "no listing POST before user confirms" check.
- **Condition pick auto-suggests a price** (whole sell flow, not just Add & List): choosing a condition triggers `suggestPrice()` when the price field is still empty — the vision's "accept or adjust the suggested price" moment. Silently falls back to the local condition-multiplier algorithm if the DeepSeek function is unreachable.
- Refactors: `_addScannedToShelf(shelfType)` is the shared add-to-shelf core (now returns the shelf-entry id; duplicates resolve to the *existing* entry id so Add & List can still link the listing); `_openSellModalPrefilled(book, entryId, statusMsg)` is the shared sell-modal pre-fill used by both the shelf "List for Sale" button and Add & List. Add & List bumps the batch session counter like any capture.
- **Verified:** [verify-batchscan.js](verify-batchscan.js) extended to 33 checks — the new section drives capture → Add & List → pre-filled sell modal (empty condition/price) → condition pick auto-suggests ($7.00 fallback) → user adjusts to $12.50 → submit → exactly one `listings` POST carrying `shelf_entry_id`, confirmed condition, and adjusted price → success alert → modal closed. All six harnesses green.

### Fixed (July 7 — Mobile-first audit of the core-loop screens)

- **The whole site rendered zoomed-out on phones — fixed.** Root cause found by the plan §3.0 audit: the logged-in header held five non-wrapping buttons (~572px minimum content width), so mobile Chrome expanded the layout viewport to 572px and scaled the page down. At ≤480px the header now wraps (`.header-actions { flex-wrap: wrap }`, Buy/Sell on their own row, compact button padding); `window.innerWidth` now equals the device width at 360/390/414px.
- **Modals are bottom sheets on phones** (≤480px): full-width, pinned to the bottom of the screen with rounded top corners, slide-up animation, scrollable body with iOS safe-area padding — primary actions sit in thumb reach instead of floating mid-screen.
- **Tap targets ≥44px** in the loop screens (scanner buttons, photo labels, form inputs; the submit buttons were 34px). Long forms (sell, add-to-shelf) get a **sticky full-bleed footer submit bar** — "List Book"/"Add to Shelf" stay visible and tappable while the form scrolls behind them (`!important` needed against the buttons' inline `width:100%`).
- **Live-camera viewfinder capped at 45dvh** so it can never push the scanner's action buttons off-screen; viewport meta gains `interactive-widget=resizes-content` so the Android keyboard resizes the layout instead of covering focused inputs.
- **Verified:** new [verify-mobile.js](verify-mobile.js) harness (360×640, 390×844, 414×896; `isMobile` + touch) — 33 checks: layout viewport = device width (the zoom-out regression guard), no tap targets under 44px, no inputs under 16px font (iOS focus-zoom trigger), primary action of each loop screen visible without scrolling, zero page errors. It caught one real bug in my first sticky-bar attempt (20px of the button hung below the screen edge). Screenshots eyeballed at 360px; full harness suite re-run green.

### Added (July 7 — Batch capture mode: the scanner stays open)

- **Batch capture** (improvement plan §3.0, first bullet — the core-loop change): adding a scanned book to a shelf **no longer closes the scanner or fires a blocking `alert()`**. Instead the modal stays open, a green flash confirms the add ("*'The Way of Zen' added to Books I Have*"), a **session counter chip** in the modal header counts the run ("14 books added today", persisted per calendar day in `localStorage` so closing the modal or a refresh doesn't zero it), and the flow returns straight to capture — **if the capture came from live camera, the viewfinder restarts automatically** (zero taps to the next book); photo/manual paths return to the capture-choice screen (file pickers can't be reopened programmatically). Duplicates (23505) show "already on your shelf" and don't bump the counter. Shelf refreshes in the background. New: `_lastCaptureLive` tracking across all five capture paths, `_bumpCaptureCount`/`_updateSessionChip`/`_flashAddedMessage` helpers, `#scannerSessionCount` chip + `#scannerAddedMsg` banner (CSS in `style.css`).
- **Verified:** new [verify-batchscan.js](verify-batchscan.js) Playwright harness (phone-sized viewport, mocked Supabase REST) — 17 checks: modal stays open after add, scanning state ready for next book, flash text, chip counts across both shelves, duplicate handling, counter persistence across close/reopen, zero page errors. Full regression re-run: routing, notifications, bookflow, vision all green.
- `_compressAndEncode` / `_callVisionExtract` added to the window-export block — verify-vision.js probes them by name; they lost implicit global scope in the July 4 module conversion (harness-only ❌, both OCR flows were unaffected).

### Changed (July 7 — Core loop enshrined across the design docs)

- **The capture loop is now the documented center of gravity of the product** (user decision, July 7): phone-first; point the camera at a book — **barcode scan or front-cover photo** — → book identified automatically → added to "Books I Have" → one-tap list for sale; repeated fast enough to **mirror an entire physical bookshelf in one session**. Written into all four layers of the doc hierarchy:
  - [docs/BOOKSHAREZ_PRODUCT_VISION.md](docs/BOOKSHAREZ_PRODUCT_VISION.md) — new top-level section **"The Core Loop — Mirror Your Bookshelf From Your Phone"** right after "The Solution", with the four product demands (phone-first always; two capture paths one result; repetition is the design case; shelf first, sale optional).
  - [docs/BOOKSHAREZ_ARCHITECTURE.md](docs/BOOKSHAREZ_ARCHITECTURE.md) — new design principle **§12.7**: the capture loop is the primary interface; mobile responsiveness and per-iteration loop speed outrank desktop polish.
  - [docs/PHASE_1_MVP_SPEC.md](docs/PHASE_1_MVP_SPEC.md) — new **"Core UX Principle"** callout beside the ADR: loop screens must be excellent at phone widths and fast to *repeat*.
  - [CLAUDE.md](CLAUDE.md) — principle added to Project State so every session optimizes for it.
- [docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md) — new **§3.0** translating the principle into work: batch capture mode (camera stays live between adds, session counter), mobile-first audit of the three loop screens at 360–414 px, "Add & list" one-confirm path, cover-photo path parity, and the two loop health metrics (books captured/minute, % captures listed).

### Changed (July 7 — ES-module split, phase 2: book-render + dom-utils)

- **[js/book-render.js](js/book-render.js)** — the §6A book-object contract (`normalizeBook`, `renderBook`, `_renderTile`/`_renderThumb`/`_renderFull`, `formatCondition`, `FALLBACK_COVER`, `#bookCardStyles` injection) extracted from main.js. Navigation stays one-directional: the renderers' click actions (view listing, browse book, view external, search by author, buy) are injected by main.js via `initBookRender(actions)` — book-render.js never imports main.js.
- **[js/dom-utils.js](js/dom-utils.js)** — `escapeHTML` moved to a dependency-free helper module both main.js and book-render.js import.
- `viewListing` was calling the internal `_renderFull` directly; now goes through the public `renderBook(book, context, "full")` entry point like everything else.
- main.js shrinks another ~230 lines (3,476 → ~3,240). All four harnesses re-run green.

### Changed (July 4 — ES-module split, phase 1: router + api-lookup)

- **`js/main.js` is now an ES module entry** (`<script type="module">`), first step of the incremental split (improvement plan §5.2). Extracted this session:
  - [js/router.js](js/router.js) — hash routing. main.js injects the page functions via `initRouter(pages)`, so the router has zero imports and no circular dependency; `setRoute()` / `applyInitialRoute()` are the exported API (renamed from `_setRoute`).
  - [js/api-lookup.js](js/api-lookup.js) — the external book-data layer (`lookupViaEdgeFunction`, `lookupOpenLibrary`, `lookupGoogleBooks`, `isbn10to13Client`, `searchGoogleBooks`, `searchOpenLibrary`, `searchBooksAPI`). Pure fetch logic, no DOM. main.js shrinks ~230 lines.
  - `js/supabase-config.js` stays a classic script so `supabaseClient` remains a global the modules read.
- **`Object.assign(window, {...})` block at the bottom of main.js** — modules have no global scope, but inline `onclick` attributes and generated markup call functions by name; all 49 HTML-referenced functions are attached there. Rule recorded in CLAUDE.md: HTML-referenced functions must be in that block; converting a handler to `addEventListener` means deleting its line.
- **`file://` no longer works** (browsers refuse module loads from file URLs) — new zero-dependency [dev-server.js](dev-server.js) (`node dev-server.js` → http://localhost:7654, the port the verify harnesses expect). CLAUDE.md run instructions updated.
- **Fixed a pre-existing dead button found during the function audit:** `scannerManualLookup()` was referenced by the scanner modal's manual-ISBN-entry UI (index.html) but never defined — clicking "Look up" threw a `ReferenceError` since the scanner shipped. Now implemented: validates ISBN-10/13, routes through `_onBarcodeDetected` like a successful scan.
- **Verified:** all four harnesses re-run against the module build — verify-routing (20/20), verify-notifications (14/14), verify-bookflow (all flows, only the pre-existing 3×401 fake-session noise), verify-vision (both OCR paths, zero console errors) — plus a targeted `scannerManualLookup` check (defined; invalid-ISBN branch shows the validation message).

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
