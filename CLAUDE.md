# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project State

BookSharez is a **community-first book marketplace**: a peer-to-peer used-book marketplace combined with a reader-identity system (per-user "Books I Have / Books I Want" shelves) and per-book discussion. The full product is defined in [docs/BOOKSHAREZ_PRODUCT_VISION.md](docs/BOOKSHAREZ_PRODUCT_VISION.md) (why/what/who) and [docs/BOOKSHAREZ_ARCHITECTURE.md](docs/BOOKSHAREZ_ARCHITECTURE.md) (full target design, phased). **Phase 1 ships only the marketplace foundation** — shelves, social graph, discussions, affiliate, and recommendations are later phases.

The repository contains:

1. **A vanilla HTML/CSS/JS app** ([index.html](index.html), [js/main.js](js/main.js), [css/style.css](css/style.css)) wired to **Supabase** (auth + Postgres). Working end-to-end and **verified live June 15**: real auth (signup/login/logout/session via [js/supabase-config.js](js/supabase-config.js)); browse/search reads active listings from the DB; **selling persists a real listing** with **ISBN auto-fill** (catalog → Open Library → Google Books, all client-side and keyless); a **My Shelf** dashboard with edit-price / mark-sold / delete; and condition filter + sort. No build step, no package.json, no frontend tests. Run by opening `index.html` or serving the directory statically.

2. **Spec + design docs** ([docs/](docs/)) — **vanilla HTML/CSS/JS + Supabase (Postgres, Auth, Storage, Edge Functions)** (June 12 ADR; **Next.js is only a post-validation graduation target**, see [docs/GRADUATION_CRITERIA.md](docs/GRADUATION_CRITERIA.md)). Schema, indexes, and RLS are live in Supabase ([db/schema.sql](db/schema.sql), RLS verified). **Not built yet:** book detail page, photo upload (3–5 to Storage), AI price suggestion (DeepSeek), and the *server-side* ISBN lookup (today's lookup is a client-side interim; ISBNdb is deferred). See [ToDo.md](ToDo.md) for next steps.

This **is** a git repository (initialized June 2026). Completed work is logged in [CHANGELOG.md](CHANGELOG.md); upcoming work in [ToDo.md](ToDo.md).

**Working mode / database:** the user applies DB changes by pasting the SQL files in [db/](db/) into the Supabase SQL editor (they confirm with screenshots). When you add a feature needing a schema/policy change, write a runnable `.sql` in `db/` and add it to the "Pending Supabase steps" list in [ToDo.md](ToDo.md) rather than assuming it's applied. Catalog `books` writes are open to authenticated users (a documented Phase-1 RLS simplification); `listings`/`listing_photos` are owner-scoped by RLS.

## Authoritative Docs

**Hierarchy:** [docs/BOOKSHAREZ_PRODUCT_VISION.md](docs/BOOKSHAREZ_PRODUCT_VISION.md) (*why/what*) → [docs/BOOKSHAREZ_ARCHITECTURE.md](docs/BOOKSHAREZ_ARCHITECTURE.md) (*full target design, phased*) → [docs/PHASE_1_MVP_SPEC.md](docs/PHASE_1_MVP_SPEC.md) (*authoritative for what we build now*).

[docs/PHASE_1_MVP_SPEC.md](docs/PHASE_1_MVP_SPEC.md) is authoritative **for Phase 1 implementation scope** and **overrides conflicting information about what we build now**. Key Phase 1 boundaries:

- **In scope:** ISBN scan/entry with ISBNdb lookup (Google Books fallback), 5-grade condition system (Like New / Very Good / Good / Fair / Poor), 3–5 photo upload, AI price suggestion with manual override, Supabase email/password auth, "My Shelf" dashboard, browse/search/filter listings, book detail page.
- **Explicitly NOT in Phase 1:** payments (Stripe is Phase 3), shipping, messaging, SHAREZ credits, transaction fees, reputation system, detailed condition verification.
- The full Postgres schema (books, listings, listing_photos) with indexes and RLS policies is in the spec — use it verbatim rather than redesigning.

Note: condition uses **5 grades** (`like_new`, `very_good`, `good`, `fair`, `poor`, underscore format) as of June 15 — switched from the earlier 4-grade set (`acceptable` is gone). The spec wins for any new work.

## Other Docs

- [docs/ERROR_HANDLING_PATTERNS.md](docs/ERROR_HANDLING_PATTERNS.md) — required patterns for API failures. Core rule: ISBNdb errors (404/429/timeout) always fall back silently to Google Books; users see seamless messaging, never raw errors; final fallback is manual entry.
- [docs/ISBNdb_API.md](docs/ISBNdb_API.md) — ISBNdb reference. Base URL is plan-specific (`api2.isbndb.com` for basic, 1 req/sec). API key goes in the `Authorization` header only, never in GET parameters.
- [docs/SECURITY_CHECKLIST.md](docs/SECURITY_CHECKLIST.md) — Phase 1 security requirements: RLS on all tables (the *primary* security layer here), JWT validation inside Edge Functions, client-side checks are UI-only. (Revised June 14 from Next.js middleware to Edge Functions.)
- [docs/env.example](docs/env.example) — all expected environment variables by phase. Phase 1 requires Supabase keys, ISBNDB_API_KEY, GOOGLE_BOOKS_API_KEY, and one AI key (DeepSeek).
- [docs/SEARCH_SYSTEMS.md](docs/SEARCH_SYSTEMS.md) — **two distinct "search" systems, do not conflate:** seller-side ISBN lookup (external APIs) vs. buyer-side browse/search (local Supabase DB only, no external calls). Affiliate fallback is deferred, not Phase 1.
- [docs/ISBN_LOOKUP_DESIGN.md](docs/ISBN_LOOKUP_DESIGN.md) — design for the `isbn-lookup` Edge Function: cache-first against the `books` table, ISBNdb→Google Books fallback, rate-limiting approach (items 9 & 10).

## Prototype Architecture Notes

If working on the existing prototype:

- All JS is in [js/main.js](js/main.js): global functions wired via inline `onclick` handlers in `index.html`. Live data comes from Supabase via `supabaseClient`: browse/search → `loadFeaturedBooks()`/`searchBooks()`; sell → `handleSellBook()` + `ensureBook()`; My Shelf → `loadUserListings()` (+ `editListing`/`markAsSold`/`deleteListing`); ISBN auto-fill → `lookupISBN()` (multi-source). User-supplied text is escaped via `escapeHTML()` before `innerHTML`.
- The old in-memory `sampleBooks` / `userBooks` arrays are now **vestigial leftovers** (no longer drive the UI) — slated for cleanup.
- "Pages" (homepage vs. dashboard) are divs toggled with `style.display` — there is no routing.
- Some CSS is injected at runtime from JS (`#bookCardStyles`, `#listingCardStyles` in `main.js`) rather than living in the stylesheets.
- [css/style_B.css](css/style_B.css) exists but is **not linked** from `index.html`; only `css/style.css` is loaded.
