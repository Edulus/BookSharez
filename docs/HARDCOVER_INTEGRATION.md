# Hardcover.app Integration Guide

**Project:** BookSharez
**Status:** Reference / Architecture Decision
**Last verified against Hardcover docs:** June 22, 2026 (docs last updated May 27, 2026)
**API endpoint:** `https://api.hardcover.app/v1/graphql`

---

## 1. Purpose

This document defines exactly what BookSharez can and cannot do with the Hardcover API, what the hard constraints are, and how to integrate it without building a fragile system. It exists because the original idea — "use Hardcover as our social layer" — is only partially feasible today. This file separates what is real now from what depends on unshipped Hardcover features.

---

## 2. The One-Sentence Verdict

Hardcover can power a **book-data enrichment layer** today (community ratings, read counts, genres, descriptions, series info), but it **cannot** power a per-user social layer until Hardcover ships OAuth, because the API only ever authenticates as a single account and is restricted to your own data, public data, and the data of users you follow.

---

## 3. Hard Constraints (from official docs)

These are non-negotiable limits set by Hardcover. Design around them, do not fight them.

| Constraint | Value | Impact on BookSharez |
|---|---|---|
| **No browser calls** | Server-side / localhost only | Every call must go through a Supabase Edge Function proxy. Never expose the token client-side. |
| **Single-account auth** | Token = one Hardcover user | Cannot act on behalf of BookSharez users. No per-user shelves/reviews without OAuth. |
| **Data scope** | Own data + public data + followed users' data | Aggregate book data is fine. Arbitrary user data is not. |
| **Rate limit** | 60 requests / minute | Must cache aggressively. Cannot fetch live per-page-view at scale. |
| **Query depth** | Max depth 3 | Deep nested queries will fail. Keep queries flat. |
| **Query timeout** | 30 seconds | Not a concern for our query sizes. |
| **Token expiry** | Auto-expires after 1 year, resets Jan 1 | Token rotation must be a documented, calendared operational task. |
| **Disabled operators** | `_like`, `_ilike`, `_regex`, `_similar` and negations | No fuzzy SQL-style matching. Use Hardcover's search endpoint or exact matches. |
| **Beta instability** | "Anything you build could break." Tokens may reset without notice. | Treat as an untrusted dependency. Must degrade gracefully. |

> **Quote from docs:** *"This is only for offline use at this time. You can only access this API from localhost or APIs. Later on, we hope to allow developers to join a group that allowlists specific sites, but that's a way down the line."*

---

## 4. What BookSharez CAN Do Today (Tier 1 — Book Data Enrichment)

All of this uses your single backend token, queries only public book data, and is fully cacheable. This is the safe, shippable tier.

### Available book fields (from `books` schema)

- `description` — book summary
- `rating` — average rating (0–5)
- `ratings_count` — total ratings
- `ratings_distribution` — breakdown by star level
- `reviews_count` — total reviews
- `users_count` — users who have this book shelved
- `users_read_count` — users who finished it
- `cached_tags` — genres / moods / content warnings (keyed JSONB)
- `book_series` / `featured_book_series` — series name + position
- `slug` — for deep-linking back to Hardcover
- `editions` — all editions with ISBN-10 / ISBN-13, publisher, format
- `contributions` — authors and contributors (incl. translators)
- `headline` — short tagline

### Example query (flat, depth ≤ 3, cacheable)

```graphql
query BookEnrichment($isbn: String!) {
  editions(where: { isbn_13: { _eq: $isbn } }, limit: 1) {
    book {
      slug
      description
      rating
      ratings_count
      ratings_distribution
      reviews_count
      users_count
      users_read_count
      cached_tags
      featured_book_series { details }
    }
  }
}
```

**This tier maps directly onto the enrichment Edge Function already built for BookSharez.** It is not a new capability — it is the formal definition of the ceiling for that existing feature.

---

## 5. What BookSharez CANNOT Do Today (Tier 2 — Social Layer)

This is the part of the original vision that is **blocked**.

| Desired feature | Why it's blocked |
|---|---|
| Show a BookSharez user's own Hardcover shelf | Requires authenticating *as that user*. No OAuth = impossible. |
| Let users post reviews to Hardcover from BookSharez | Mutations run as the token owner only. Every review would post as one account. |
| Sync a user's "Want to Read" / reading status | Same single-account problem. |
| Pull arbitrary users' libraries for matching | API restricts to public data + followed users only. |
| Build a follow graph on top of Hardcover identities | No mechanism to map BookSharez users ↔ Hardcover users. |

**The blocker in one line:** the token is tied to one account, and OAuth for external apps is a roadmap item that was slated for 2025 and has not shipped as of the current docs.

---

## 6. Architecture: How to Integrate Without Coupling

### 6.1 Proxy pattern (required)

```
Browser (BookSharez frontend)
        │  (never holds the token)
        ▼
Supabase Edge Function: hardcover-proxy
        │  injects HARDCOVER_API_TOKEN (secret)
        │  enforces our own rate limiting + caching
        ▼
Hardcover GraphQL API
```

- Token lives only as a Supabase secret (`HARDCOVER_API_TOKEN`).
- The proxy is the **only** thing that knows Hardcover exists.

> **As built (June 22, 2026):** this proxy ships as the **`book-enrichment`** Edge Function ([supabase/functions/book-enrichment/index.ts](../supabase/functions/book-enrichment/index.ts)), not a function literally named `hardcover-proxy`. It implements exactly this Tier-1 pattern — cache-first against the `books` table, ISBN-13 lookup with a title+author fallback, `HARDCOVER_API_TOKEN` injected server-side, normalize-before-store. The name in the diagram is conceptual; there is no separate `hardcover-proxy` to go looking for.

### 6.2 Abstraction layer (required for resilience)

Do **not** let Hardcover field names leak into the BookSharez frontend or database. Map Hardcover's response into a BookSharez-owned `enrichment` shape inside the Edge Function. If Hardcover changes its schema or disappears, only the proxy's mapping function changes — nothing downstream.

```
Hardcover response  →  normalizeEnrichment()  →  BookSharez enrichment object
   (volatile)            (single chokepoint)        (stable, owned)
```

### 6.3 Caching strategy (required — 60 req/min makes this mandatory)

| Data | Store | TTL |
|---|---|---|
| Book enrichment (ratings, tags, description) | `books` table columns (`hc_*`) | 30 days, refresh-on-miss |
| Series info | Same | 30 days |
| Cover / images | Prefer canonical ISBNdb/Google source; Hardcover as fallback only | n/a |

**Rule:** A book detail page must render fully from the local DB cache. Hardcover is consulted only on cache miss or stale entry, never synchronously blocking the page.

### 6.4 Graceful degradation (required)

The book page must be fully functional with **zero** Hardcover data. Enrichment is additive decoration, never load-bearing.

- Hardcover down / 429 / 500 → show the page without the enrichment section. No error to the user.
- Missing fields → hide that specific element (no empty star rating, no orphan "Series:" label).
- Token expired (401) → log + alert, serve stale cache, continue.

---

## 7. Operational Requirements

- **Token rotation:** Hardcover tokens expire after 1 year and reset every Jan 1. Add a calendar reminder to regenerate `HARDCOVER_API_TOKEN` from `hardcover.app/account/api` before each reset.
- **User-agent header:** Docs recommend sending a descriptive `user-agent` identifying the BookSharez script.
- **Rate-limit guard:** The proxy should track a rolling 60/min budget and prefer cache when near the ceiling.
- **Attribution:** When displaying Hardcover data, link back via the book `slug` (`hardcover.app/books/{slug}`). Good citizenship and useful to users.

---

## 8. Recommendation by Phase

| Phase | Use of Hardcover |
|---|---|
| **Phase 1–2** | Tier 1 only — book enrichment on detail pages. Already implemented. This is the realistic ceiling. |
| **Phase 2+ (social)** | Build the social layer (shelves, reviews, follows) **natively in BookSharez** per the existing architecture doc. Do **not** depend on Hardcover for it. |
| **Future (if OAuth ships)** | Re-evaluate Tier 2. Optionally offer "Connect your Hardcover account" as an *enhancement* to native social — never a replacement. |

---

## 9. Risk Summary

- **Dependency risk:** High if used for social, low if used for enrichment only.
- **The safe boundary:** Hardcover enriches *books*. BookSharez owns *users* and *social*.
- **Strategic note:** The original "don't build social, just use Hardcover" thesis does not hold under current API limits. The defensible position is: own the social graph, borrow the book metadata.

---

## 10. Quick Reference

- Endpoint: `https://api.hardcover.app/v1/graphql`
- Auth header: `authorization: <token>` (server-side only)
- Token source: `hardcover.app/account/api`
- Rate limit: 60/min · Depth: ≤3 · Timeout: 30s
- Schema docs: `docs.hardcover.app/api/graphql/schemas/`
- Status status IDs: 1=Want to Read, 2=Currently Reading, 3=Read, 4=Paused, 5=DNF, 6=Ignored
