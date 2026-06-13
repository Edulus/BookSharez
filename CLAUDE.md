# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project State

BookSharez is a used-books marketplace. The repository currently contains two distinct things:

1. **A static HTML/CSS/JS prototype** ([index.html](index.html), [js/main.js](js/main.js), [css/style.css](css/style.css)) — a client-side demo with hardcoded sample books, fake login (any email/password works), and in-memory state that resets on refresh. No backend, no build step, no package.json, no tests. Run it by opening `index.html` in a browser or serving the directory with any static server.

2. **Planning docs for the real Phase 1 build** ([docs/](docs/)) — the intended product is a **Next.js + Supabase** app deployed to Vercel. None of that code exists yet; the prototype does not implement the spec.

This is not a git repository.

## Authoritative Spec

[docs/PHASE_1_MVP_SPEC.md](docs/PHASE_1_MVP_SPEC.md) is explicitly authoritative and **overrides conflicting information in any other document**. Key Phase 1 boundaries:

- **In scope:** ISBN scan/entry with ISBNdb lookup (Google Books fallback), 4-grade condition system (Like New / Very Good / Good / Acceptable), 3–5 photo upload, AI price suggestion with manual override, Supabase email/password auth, "My Shelf" dashboard, browse/search/filter listings, book detail page.
- **Explicitly NOT in Phase 1:** payments (Stripe is Phase 3), shipping, messaging, SHAREZ credits, transaction fees, reputation system, detailed condition verification.
- The full Postgres schema (books, listings, listing_photos) with indexes and RLS policies is in the spec — use it verbatim rather than redesigning.

Note: the prototype's condition values (`like-new`, `very-good`, `good`, `fair`, `poor`) do **not** match the spec's four grades (`like_new`, `very_good`, `good`, `acceptable`). The spec wins for new work.

## Other Docs

- [docs/ERROR_HANDLING_PATTERNS.md](docs/ERROR_HANDLING_PATTERNS.md) — required patterns for API failures. Core rule: ISBNdb errors (404/429/timeout) always fall back silently to Google Books; users see seamless messaging, never raw errors; final fallback is manual entry.
- [docs/ISBNdb_API.md](docs/ISBNdb_API.md) — ISBNdb reference. Base URL is plan-specific (`api2.isbndb.com` for basic, 1 req/sec). API key goes in the `Authorization` header only, never in GET parameters.
- [docs/SECURITY_CHECKLIST.md](docs/SECURITY_CHECKLIST.md) — Phase 1 security requirements: RLS on all tables, server-side auth checks in Next.js middleware (client-side checks are UI-only), JWT validation on API routes.
- [docs/env.example](docs/env.example) — all expected environment variables by phase. Phase 1 requires Supabase keys, ISBNDB_API_KEY, GOOGLE_BOOKS_API_KEY, and one AI key (OpenAI or Anthropic).

## Prototype Architecture Notes

If working on the existing prototype:

- All JS is in [js/main.js](js/main.js): global functions wired via inline `onclick` handlers in `index.html`, state in module-level globals (`sampleBooks`, `userBooks`, `isLoggedIn`, `currentUser`).
- "Pages" (homepage vs. dashboard) are divs toggled with `style.display` — there is no routing.
- Some CSS is injected at runtime from JS (`#bookCardStyles`, `#listingCardStyles` in `main.js`) rather than living in the stylesheets.
- [css/style_B.css](css/style_B.css) exists but is **not linked** from `index.html`; only `css/style.css` is loaded.
