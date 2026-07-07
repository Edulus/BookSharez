# BookSharez — Improvement Plan

**Date:** July 4, 2026
**Status:** ADVISORY — a prioritized review of how to improve the product and codebase.
This document does **not** override the doc hierarchy:
[BOOKSHAREZ_PRODUCT_VISION.md](BOOKSHAREZ_PRODUCT_VISION.md) →
[BOOKSHAREZ_ARCHITECTURE.md](BOOKSHAREZ_ARCHITECTURE.md) →
[PHASE_1_MVP_SPEC.md](PHASE_1_MVP_SPEC.md). When an item here graduates into real
work, move it into [../ToDo.md](../ToDo.md) and spec it against those docs.

---

## 1. Where the Project Stands (July 2026)

The honest summary: **Phase 1 is essentially built and live**, plus a meaningful
head start on Phase 2. Working end-to-end against Supabase:

- Real auth, browse/search/filter/sort, sell flow with ISBN auto-fill (Edge
  Function → ISBNdb/Google Books), AI price suggestion (DeepSeek), photo upload,
  book detail page with gallery, barcode scanning + Gemini vision OCR fallback.
- Phase 2 head start: `profiles`, `shelf_entries`, `follows` (schema + UI),
  public profile pages, follow/unfollow, per-book Discuss section.
- Hardcover enrichment (Tier 1) is **coded but not fully live** — DB columns,
  function deploy, and secret are still pending (ToDo items 9–11).
- Solid engineering discipline for a prototype: single rendering contract
  (`renderBook` §6A), secrets proxied through Edge Functions, RLS verified,
  pre-commit + gitleaks secret scanning, Playwright verify harnesses.

The biggest structural facts shaping this plan:

1. **The social layer is the differentiator** (vision: "reader identity, not
   seller ratings") but is currently the thinnest part: follows exist with **no
   feed**, shelves exist with **no recommendations or matching**, discussions
   exist with **no notifications**. The marketplace works; the "Hardcover-like"
   half is scaffolding.
2. **The app has no URLs.** Pages are `display:none` toggles. Nothing is
   shareable or indexable — no book page links, no profile links. For a
   community product, shareability *is* growth.
3. **`js/main.js` is 3,425 lines** and all global. It works, but every new
   feature raises the cost of the next one.
4. Search is `ilike` with client-side merge — fine for a campus pilot,
   a known cliff after that.

---

## 2. Quick Wins (do these first — days, not weeks)

| # | Item | Why | Effort |
|---|------|-----|--------|
| 2.1 | **Finish Hardcover enrichment go-live** — apply [../db/book_enrichment_columns.sql](../db/book_enrichment_columns.sql), deploy `book-enrichment`, set `HARDCOVER_API_TOKEN` (ToDo 9–11) | Fully coded feature sitting dark; instantly richer book pages (description, rating, genres, series) | S |
| 2.2 | **Fix `<title>` typo** — `index.html` says "**Booke**Sharez" | It's the browser tab and the first Google result line | S |
| 2.3 | **Add basic SEO/social meta** — `<meta name="description">`, Open Graph + Twitter card tags, favicon | Zero-cost credibility when links are shared | S |
| 2.4 | **`loading="lazy"` on all book cover `<img>`** in the three renderers | Free performance on grid-heavy pages | S |
| 2.5 | **Decide the ISBNdb question** — either subscribe ($10/mo) or formally demote it in docs and make Google Books/Open Library the documented primary | The docs describe a primary lookup path that has never run; resolve the drift one way or the other | S |
| 2.6 | **Delete `css/style_B.css`** (unlinked duplicate) and prune stale verify screenshot folders from the repo root | Housekeeping; repo is public | S |
| 2.7 | **Storage orphan cleanup** — deleting/marking-sold a listing leaves photo objects behind (known follow-up from June 16). A small scheduled Edge Function or a delete-time cleanup call | Unbounded storage growth on the Free plan; costs later | M |

---

## 3. Product — Make the Marketplace Loop Close

These are the highest-leverage *product* gaps in the buy/sell core. Ordered by
impact.

### 3.0 The capture loop — the core idea, and the bar for everything else ★★
*(Elevated July 7, 2026 — now enshrined in PRODUCT_VISION "The Core Loop",
architecture principle §12.7, and the Phase 1 spec's Core UX Principle.)*

The product's defining flow: a reader stands at their bookshelf with a phone,
points the camera at a book — **barcode or front cover** — and BookSharez
identifies it, shelves it, and offers a one-tap listing. Repeated dozens of
times in a session, this mirrors a whole physical collection onto the site.
The pieces exist (barcode scanner, Gemini cover OCR, shelf-routed sell flow);
what's missing is making the *repetition* frictionless on a phone:

- **Batch capture mode.** After "Add to shelf," return straight to the live
  camera with a running session counter ("14 added tonight"), instead of
  closing the modal. Capture → confirm → next should be a rhythm with zero
  re-opening taps. This is the single highest-leverage UX change available.
- **Mobile-first audit of the loop screens.** Scanner modal, add-to-shelf,
  and sell modal at 360–414 px widths: primary buttons thumb-reachable at the
  bottom, no pinch-zoom, no keyboard-covered inputs, camera viewfinder sized
  right. The CSS is desktop-designed with media-query retrofits — the loop
  screens deserve phone-first treatment.
- **Capture → listed in one confirm.** The sell flow already routes through
  the shelf; from a fresh capture, offer "Add & list for sale" that lands on a
  pre-filled sell form (suggested price already fetched) needing one confirm.
- **Cover-photo path parity.** The AI cover path must stay as fast as the
  barcode path — it's what handles older books with no barcode, which heavy
  shelves are full of.
- **Measure the loop.** Books captured per minute, and % of captures that
  become listings — these two numbers are the product's health metrics
  (feed §10).

Everything else in this section builds on the shelves this loop fills.

### 3.1 Want-match notifications (the killer connector) — HIGH IMPACT
The single feature that makes the two halves of the product (shelves +
marketplace) reinforce each other, and it's already promised in the vision
("add it to your wish list and get notified when a copy becomes available").
- When a new listing's `book_id` (or ISBN) matches someone's **Books I Want**
  entry, notify them.
- Phase-appropriate v1: **no email infra needed.** A `notifications` table +
  a bell icon in the header + a badge count. Row inserted by a Postgres trigger
  on `listings` insert (`want` shelf match). Email can come later.
- This also gives you the notification rail that discussions, follows, and
  price drops will all need — build the table generically
  (`type`, `actor_id`, `subject_type`, `subject_id`, `read_at`).

### 3.2 Trust signals on listings and detail pages
Vision: trust through reader identity. Currently a listing shows a seller name
and nothing else. Cheap, high-trust additions to the detail page seller block:
- Shelf size ("212 books on their shelf"), member-since date, follower count,
  count of active listings — all one query against existing tables.
- Later: link "see their shelf" more prominently (it exists but is buried).

### 3.3 The book page as the canonical hub
Architecture §6 says every book has one page with Buy / Sell / Discuss. The
plumbing exists (`_renderBookPage`, `renderBookOffers`, Discuss). Improvements:
- **Aggregate listings by book** in browse: if 4 people sell the same ISBN,
  show one card with "from $6.50 · 4 copies" instead of 4 near-identical cards.
  This makes the catalog feel bigger and comparison natural. (Ranking rules
  already spec'd in architecture §4.2.)
- **"Want" / "Have" buttons directly on the book page and on tiles** for
  logged-in users — one tap to build shelf identity from anywhere in browse,
  not only via the dashboard Add Book modal. This is the Hardcover interaction
  pattern that makes shelf-building effortless, and shelf data feeds
  everything else (3.1, §4).

### 3.4 Transaction close-the-loop (still no payments — Phase 3 discipline)
Buy Now is visual-only per spec, but the *human* loop can still be closed:
- v1: "I'm interested" button → creates a notification for the seller with the
  buyer's profile link (buyers and sellers arrange cash exchange themselves,
  per the Phase 1 business model). No messaging system needed yet — it's a
  structured ping, not a chat.
- Mark-as-sold already exists; add "sold to @user" (optional) so shelves can
  later reflect transfers.
- This gives you real transaction *signal* (how many pings per listing?) for
  graduation metrics without touching Stripe.

### 3.5 Saved searches & browse depth
- Persist last-used condition filter/sort per user (localStorage is fine).
- "Notify me when a book matching *X* is listed" can ride the §3.1
  notifications rail later — don't build separately.

---

## 4. Product — Build the Social Layer (the Hardcover-like half)

The vision's differentiation lives here, and it's the thinnest part today.
Recommended build order — each step feeds the next:

### 4.1 Activity feed (architecture §5.5) — the reason follows exist
Following someone currently does nothing visible. A feed makes the social graph
real:
- v1 scope: a "Following" tab/section on the dashboard showing recent events
  from followed users: *added X to shelf*, *listed Y for sale*, *posted in
  discussion of Z*.
- Implementation: **fan-out on read** (query events for followed user IDs,
  newest first) — at campus scale this is one indexed query, no event queue
  needed. Add a lightweight `events` table written by the same triggers as
  notifications (or derive v1 purely from `shelf_entries.added_at` +
  `listings.created_at` + `discussion_posts.created_at` with no new table at
  all — zero schema risk, slightly uglier query).
- The critical-event system in architecture §10 is the eventual home; don't
  over-build it now.

### 4.2 Reviews & ratings (architecture §2.9)
Currently the only rating shown is Hardcover's community rating. BookSharez
readers can't say anything structured about a book:
- `reviews` table: `user_id`, `book_id`, `rating (1–5)`, `body`, unique on
  (user, book). Public read, owner write — same RLS shape as discussions.
- Render on the book page above Discuss; show BookSharez rating alongside the
  Hardcover rating ("Community: 4.2 ★ (12) · Hardcover: 4.05 ★").
- Reviews are the #1 profile-page content for reader identity (architecture §7
  puts activity right after the shelf).

### 4.3 Reading status — one small, high-character upgrade to shelves
Hardcover's shelves are Want / Currently Reading / Read. BookSharez has
have/want. Adding a `status` to `shelf_entries` (`have`, `want`,
`reading`, `read`) rather than new tables:
- "Currently reading" is the most *social* status — it's conversation bait and
  feed content ("Alex started reading Dune").
- Keep the marketplace semantics: only `have` entries can be listed for sale.
  `read` + `have` can coexist via a flag or by treating `read` as a sub-state
  of have — decide in the spec before touching the schema.

### 4.4 Shelf-similarity recommendations (architecture §4.1)
The "readers like you" feature. Don't start with ML:
- v1: "People who have this book also have…" — one SQL query over
  `shelf_entries` (co-occurrence), shown on the book page. Cheap, effective,
  needs zero new infrastructure.
- v2: profile-level "Readers with similar shelves" using overlap counts
  (Jaccard on shelf ISBNs) — a nightly job or on-demand query at campus scale.

### 4.5 Discussion upgrades — only after there is *usage*
Threads, mentions, and realtime are attractive but premature until posts/day
is nonzero. When it is:
- Supabase Realtime subscription on `discussion_posts` for live updates (small
  client change, no schema change).
- Reply-to (one level, Hardcover-style) via a nullable `parent_id`.
- Mentions can ride the §3.1 notifications rail.

---

## 5. Architecture & Code Health

### 5.1 URL routing — the most important technical investment ★
Everything in §3/§4 produces content people will want to **share** (a book
page, a profile, a discussion) — and none of it has an address. Also breaks
back-button, refresh (always resets to home), and any SEO.

- **Recommendation: hash-based routing, no framework.** `#/book/9780…`,
  `#/profile/<id>`, `#/listing/<id>`, `#/dashboard/shelf-have`. A ~60-line
  router: parse `location.hash` → call the existing `viewListing` /
  `browseBookById` / `viewProfile` / `showDashboard` functions; those functions
  set the hash instead of being called from `onclick` directly. `hashchange`
  listener handles back/forward for free. No server config needed — still a
  static site, works from `file://`.
- This is a *refactor of entry points, not of pages* — the display-toggle
  mechanism can stay. Do it **before** the social features, because every
  feature added without URLs deepens the hole.
- Real path-based URLs + SSR/SEO remain a graduation-time concern
  ([GRADUATION_CRITERIA.md](GRADUATION_CRITERIA.md)) — hash routing is the
  right-sized Phase 2 step.

### 5.2 Split `main.js` into ES modules — no build step required
3,425 lines in one global-scope file. Native ES modules solve this with zero
tooling (`<script type="module">`), keeping the vanilla-JS ADR intact:

```
js/
  main.js            ← entry: init, event wiring, router
  book-render.js     ← normalizeBook, renderBook, _renderTile/Thumb/Full (§6A contract)
  browse.js          ← loadFeaturedBooks, searchBooks, filters/sort
  sell.js            ← sell modal, handleSellBook, photos, pricing
  shelf.js           ← shelves, add-to-shelf, shelf search
  detail.js          ← viewListing, enrichment, discussion
  profile.js         ← viewProfile, follow, settings
  scanner.js         ← barcode + vision OCR
  lookup.js          ← lookupISBN + client fallbacks
  supabase-config.js
```

- Caveat: `onclick="…"` in HTML requires globals. Do this **together with**
  §5.1 (routing) and convert inline `onclick` to `addEventListener` while
  splitting — the two refactors touch the same seams and CLAUDE.md already
  prefers `addEventListener`. This is the one "big" refactor in this plan;
  everything else is additive.
- Migrate incrementally: one module extracted per session, verify harness run
  after each. Do not combine with feature work.

### 5.3 Search: move to Postgres full-text / trigram before it embarrasses you
`title.ilike.%term%` can't rank, can't handle typos, and won't use an index
without `pg_trgm`. One SQL file:
- Enable `pg_trgm`, add a GIN index on `books.title` and `books.author`, or
  add a generated `tsvector` column + `websearch_to_tsquery`. Either fits the
  existing "paste SQL in the dashboard" workflow.
- Client change is one line (call an RPC or keep `ilike` but now indexed;
  trigram similarity also gives "did you mean" ordering for free).

### 5.4 Notifications/events schema — build once, reuse four times
§3.1 (want match), §3.4 (interested ping), §4.1 (feed), §4.5 (mentions) all
need the same rail. Spec one generic `notifications` (+ optional `events`)
table with RLS before building any of the four.

### 5.5 Image handling
- Client-side resize before upload (canvas, ~1200px max edge) — the
  compression helper for vision OCR (`_compressAndEncode`) shows the pattern
  already exists in the codebase; reuse it for listing photos. Cuts storage
  and load time dramatically.
- Keep `object-fit: contain` convention (CLAUDE.md).

### 5.6 Error observability
Silent graceful degradation (the house style) is right for users but means you
never learn about failures. Add a tiny `logClientError(context, err)` that
inserts into an `client_errors` table (RLS: insert-only for authed users,
read for you) or `console`-gated in dev. When something breaks on a real
user's phone, you currently have no way to know.

---

## 6. Security & Integrity (beyond the June 18 work — which was good)

| # | Item | Why | Priority |
|---|------|-----|----------|
| 6.1 | **Harden `books` writes** — the documented Phase-1 simplification (any authed user can write catalog rows). Path: route client `ensureBook` through the existing `isbn-lookup`/enrichment functions (service-role upsert already exists there), then tighten RLS to read-only for clients | A hostile user can corrupt shared catalog data (titles/covers) for everyone; the fix path is already half-built | High, pre-launch |
| 6.2 | **Content reporting + moderation** — a `reports` table + "Report" link on listings/posts/profiles; a `is_hidden` flag honored by queries | The moment strangers can post text and images publicly, you need a takedown path. Also required by most campus/app policies | High, pre-launch |
| 6.3 | **DB-level validation constraints** — price `<= 9999.99`, description length, photo count — as CHECK constraints, not just client checks | RLS is the security layer; constraints are the integrity layer. Client JS is bypassable by design | Medium |
| 6.4 | **Durable rate limiting** on Edge Functions — the in-memory gate resets per isolate; a simple `rate_limits` table or per-user daily quota check protects DeepSeek/Gemini spend | Billing exposure is the stated top security concern of this repo | Medium |
| 6.5 | **Auth hardening pass** — enable Supabase email confirmation + leaked-password protection; add a password-reset flow in the UI (currently missing entirely) | Password reset is table stakes; its absence will generate support requests on day one | Medium |

---

## 7. UX Polish & Accessibility

- **Empty states with next actions.** New user's dashboard: instead of empty
  grids, "Scan your first book" with the scanner button. Every empty state
  should sell the next step — this is the activation funnel.
- **Onboarding moment.** After signup, route straight into "Add 3 books you
  own" (scanner-first). Shelf size is the identity metric; the first session
  should produce a nonzero shelf. (Vision §How It Works promises exactly this.)
- **Accessibility basics:** clickable `div` cards need `role="button"` +
  `tabindex="0"` + Enter/Space handlers (or become real `<button>`/`<a>` —
  which §5.1's routing gives you for free via real `<a href="#/…">` links);
  modals need focus trap + Escape-to-close + `aria-modal`; all covers need
  meaningful `alt` (title — already partially done); form inputs need
  `<label for>`.
- **Skeleton loaders** for the grids instead of blank space (CSS-only shimmer
  on placeholder tiles).
- **Mobile scanner ergonomics** are the make-or-break flow for campus users —
  keep investing there (the Playwright harness can't test camera; periodically
  hand-test on a real phone).

---

## 8. Quality, Tooling & Ops

- **Formalize the verify harnesses.** Three ad-hoc Playwright scripts exist
  (`verify-vision.js`, `verify-bookflow.js`, `verify-enrichment.js`). Move to
  `tests/`, add a `package.json` script (`npm run verify`), and a shared
  helper for server-port checking (per the port-collision lesson). They are
  the de-facto regression suite — treat them as one.
- **ESLint (flat config) + Prettier**, no build step implied — catches the
  global-leak and typo class of bug that a no-build project can't catch any
  other way. Optionally `tsc --checkJs` with JSDoc types on the §6A contract
  (`Book`, `BookContext`) — the rendering contract is exactly where type
  checking pays.
- **Hosting:** the repo is public but the app has no public URL. GitHub Pages
  (or Cloudflare Pages) serves it as-is — no build step means zero config.
  This is a prerequisite for any real user test. Pair with §2.3 meta tags.
- **Analytics + error monitoring before first users:** a privacy-light
  analytics script (Plausible/GoatCounter) and §5.6's error table. Graduation
  criteria are metric-based — you can't graduate on metrics you don't collect.
- **Supabase pre-launch checklist:** upgrade to Pro + delete keep-alive
  workflow (already noted in ToDo), turn on daily backups, confirm Storage
  bucket policies, review Auth email templates (they'll say "Supabase" by
  default).

---

## 9. Suggested Sequence

**Now (1–2 sessions each, independent):**
1. Quick wins §2.1–2.7 — especially enrichment go-live (2.1).
2. Hash routing (§5.1) — do this before any new social surface.
3. Notifications rail spec + SQL (§5.4), then want-match notifications (§3.1).

**Next (pre-any-real-users):**
4. `main.js` module split + inline-onclick removal (§5.2), incremental.
5. Books-write hardening (§6.1) + reporting (§6.2) + password reset (§6.5).
6. Hosting + meta + analytics (§8) — get a URL people can visit.
7. Trust signals (§3.2) + book-page Want/Have buttons (§3.3) + empty-state
   onboarding (§7).

**Then (the social layer, in order):**
8. Activity feed v1 (§4.1) — derived queries first, no new tables.
9. Reviews & ratings (§4.2).
10. "I'm interested" ping (§3.4) + listing aggregation by book (§3.3).
11. Reading statuses (§4.3), co-occurrence recommendations (§4.4).
12. Search upgrade (§5.3) when the catalog outgrows `ilike`.

**Deliberately NOT recommended now** (consistent with existing ADRs):
payments/Stripe (Phase 3), direct messaging (the §3.4 ping covers the need),
framework migration (graduation criteria govern), native apps, email
infrastructure (in-app notifications first), Hardcover Tier 2 social sync
(blocked on their OAuth — [HARDCOVER_INTEGRATION.md](HARDCOVER_INTEGRATION.md)).

---

## 10. Metrics That Should Exist Before Launch

Aligned with [GRADUATION_CRITERIA.md](GRADUATION_CRITERIA.md); all derivable
from existing tables once analytics (§8) is in:

- **Activation:** % of signups with ≥3 shelf books in first session; % with ≥1
  listing in first week.
- **Marketplace pulse:** listings created/week, "interested" pings per
  listing, time-to-first-ping.
- **Social pulse:** follows/user, feed views, discussion posts/week,
  want-match notifications clicked.
- **Supply/demand shape:** most-wanted books with zero listings (that list is
  also a campus marketing asset: "10 people here want this book").
