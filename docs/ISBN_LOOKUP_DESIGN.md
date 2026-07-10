# ISBN Lookup & Caching — Edge Function Design

**Date:** June 15, 2026
**Status:** Design for the *full* server-side version — covers ToDo items
**9 (ISBN caching)** and **10 (Edge Function rate limiting)**; deferred until the
ISBNdb subscription starts (ToDo item 8).

> **Interim version shipped (June 15):** the sell form already auto-fills
> title/author/cover **client-side**, trying sources in order: our `books`
> catalog → **Open Library** → **Google Books** (both free + keyless, so
> browser-safe; multi-source so a rate-limited or down source doesn't block the
> lookup — Google's keyless quota is low and 429s easily). No ISBNdb, no Edge
> Function yet. This doc remains the target for moving the lookup server-side
> (add ISBNdb as primary, hide keys, server-side rate limiting).
**Related:** [PHASE_1_MVP_SPEC.md](PHASE_1_MVP_SPEC.md) ·
[ERROR_HANDLING_PATTERNS.md](ERROR_HANDLING_PATTERNS.md) ·
[ISBNdb_API.md](ISBNdb_API.md) · [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md)

---

## 1. Problem

Listing a book starts by entering/scanning an ISBN and auto-filling the book
details. Three constraints shape the design:

1. **Key secrecy.** The ISBNdb and Google Books keys must never reach the
   browser ([SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md)). In a vanilla-JS app
   that means a server-side proxy — a **Supabase Edge Function**.
2. **Rate limit.** ISBNdb Basic is **1 request/second** on `api2.isbndb.com`.
   Many users scanning at once would breach it. Exceeding the daily limit
   disables the key for 24h ([ISBNdb_API.md](ISBNdb_API.md)).
3. **Speed & cost.** The Phase 1 goal is "list a book in <30 seconds" and
   ISBNdb lookup success >85%. Repeated lookups of the same popular ISBN
   shouldn't pay latency or quota every time.

All three are solved by one Edge Function with a **cache-first** strategy.

---

## 2. Architecture overview

```
browser (js/main.js)
  │  supabaseClient.functions.invoke('isbn-lookup', { body: { isbn } })
  │  (JWT attached automatically — function requires an authenticated user)
  ▼
Edge Function: isbn-lookup  (Deno)
  1. verify JWT  → 401 if not logged in
  2. normalize + validate ISBN (10/13 digits → canonical isbn13)
  3. CACHE CHECK:  SELECT * FROM books WHERE isbn = <isbn13>
        └─ hit  → return book (no external call)                    ← fast path
  4. miss → rate-gate, then ISBNdb GET /book/{isbn}
        ├─ 200 → normalize
        ├─ 404/429/timeout/error → Google Books fallback
        └─ Google Books miss → return { found:false } (manual entry)
  5. UPSERT normalized row into books (service-role; bypasses RLS)
  6. return book
```

Key point: **the cache (step 3) absorbs most traffic**, so the external call
(step 4) — the only rate-limited part — runs rarely. The cache is the primary
rate-limit defense; the gate in step 4 is the backstop.

---

## 3. Item 9 — Caching strategy

### 3.1 The `books` table *is* the cache
No separate cache store. The existing `books` table (see
[schema](../db/schema.sql)) doubles as a permanent ISBN cache:
- It already has `UNIQUE(isbn)` and `idx_books_isbn`, so lookups are O(1).
- It has a public read-only RLS policy, so cached data is reusable by everyone.
- Once a book is looked up by any user, every future lookup of that ISBN is a
  cache hit — no API call, no latency, no quota.

### 3.2 ISBN normalization (cache key correctness)
Users may enter ISBN-10 or ISBN-13, with or without hyphens. To avoid cache
misses on the same physical book:
- Strip hyphens/spaces; validate it is exactly 10 or 13 digits (ISBN-10 may end
  in `X`).
- **Canonicalize to ISBN-13** and use that as the cache key (`books.isbn`).
- Store the ISBN-10 form too in `books.isbn10` when known (useful for Google
  Books, which is ISBN-10-friendly).
- Validation happens both client-side (instant feedback, per
  [SECURITY_CHECKLIST.md](SECURITY_CHECKLIST.md)) and inside the function
  (never trust the client).

### 3.3 What gets cached, and staleness
- Cache **successful** lookups (ISBNdb *or* Google Books) by upserting into
  `books`. Mark the source for debugging (optional `source` column — a future
  migration, not required for Phase 1).
- **Do not** cache "not found" as a row — a book may be added to ISBNdb later;
  caching misses would permanently hide it. (If miss-storms become a problem,
  revisit with a short-TTL negative cache; out of scope for Phase 1.)
- Book metadata is effectively immutable for our purposes, so **no expiry** in
  Phase 1. `updated_at` exists if we later want refresh logic.

### 3.4 Upsert, not insert
Two users can race on the same new ISBN. Use
`INSERT ... ON CONFLICT (isbn) DO UPDATE` (or `DO NOTHING`) so concurrent
first-lookups don't error on the `UNIQUE(isbn)` constraint.

---

## 4. Item 10 — Rate limiting

### 4.1 Why the cache does most of the work
After warm-up, the large majority of lookups are cache hits and make **zero**
external calls. Only genuine cache misses (a never-before-seen ISBN) hit ISBNdb.
So the rate problem shrinks to: *bursts of distinct, uncached ISBNs.*

### 4.2 The safety net that makes this tractable
Per [ERROR_HANDLING_PATTERNS.md](ERROR_HANDLING_PATTERNS.md), an ISBNdb **429
falls back silently to Google Books**. That means rate limiting is **best-effort,
not correctness-critical**: if we occasionally breach 1 req/sec, the user still
gets a result via fallback — they never see an error. This lets Phase 1 use a
simple gate instead of a heavy distributed limiter.

### 4.3 Options considered

| Option | How | Pros | Cons |
|--------|-----|------|------|
| **A. Client throttle only** | 1.1s throttle in browser | trivial | useless across users/tabs — *insufficient* |
| **B. In-memory per-instance gate** | module-level "last call" timestamp in the function; `await` until ≥1s elapsed | simple, no DB | Edge Functions can run multiple concurrent instances → not globally correct |
| **C. DB-backed gate** | single-row `isbndb_rate` table + `pg_advisory_xact_lock`; function records/checks last-call time, sleeps if <1s | globally correct across instances | adds a DB round-trip + a tiny serialization point on cache-miss path |
| **D. External queue/Redis** | dedicated rate-limit service | scales to high volume | overkill for Phase 1 Basic plan |

### 4.4 Recommendation for Phase 1
**Start with B (in-memory gate) + the 429→Google Books fallback as the real
safety net.** Rationale:
- The cache keeps cache-miss volume low; a single Basic-plan key rarely sees
  concurrent misses at MVP scale.
- The fallback guarantees graceful degradation if a breach happens.
- It's the least code and no extra schema.

**Document option C as the upgrade path.** If logs show frequent 429s (i.e.
real concurrency), add the `isbndb_rate` single-row table + advisory lock for a
globally-correct 1 req/sec gate — a contained change that doesn't touch the
function's interface.

> Do **not** rely on the client-side throttle from
> [ERROR_HANDLING_PATTERNS.md](ERROR_HANDLING_PATTERNS.md) for limiting — keep it
> only as a courtesy to reduce obvious double-taps.

---

## 5. Auth & security

- **Require a valid JWT.** Listing creation already requires auth; gating lookup
  the same way stops anonymous users from burning the ISBNdb quota. Function
  returns `401` with no session.
- Keys via `Deno.env.get('ISBNDB_API_KEY')` / `GOOGLE_BOOKS_API_KEY`, set as
  Supabase Edge Function secrets — never in client JS.
- ISBNdb key sent in the `Authorization` header **only**, never as a GET param
  ([ISBNdb_API.md](ISBNdb_API.md)).
- The `books` upsert uses the **service-role** client (bypasses RLS) — the only
  writer to `books`, consistent with the public-read/no-client-write policy.
- 5s timeout per external call; on any failure, fall back then degrade to manual
  entry. Never surface raw API errors to the user.

---

## 6. Response contract (function → browser)

```jsonc
// success (cache hit or fresh lookup)
{ "found": true,
  "source": "cache" | "isbndb" | "google_books",
  "book": {
    "isbn": "9780134093413", "isbn10": "0134093410",
    "title": "...", "author": "...", "publisher": "...",
    "publishDate": "2017-01-01", "coverUrl": "...",
    "pageCount": 600, "language": "en"
  } }

// not found anywhere → client shows manual-entry form
{ "found": false }
```

Field-normalization mapping (ISBNdb `book.*` and Google Books
`volumeInfo.*` → `books` columns) to be specified at implementation time; both
collapse into the shape above.

---

## 7. Build checklist (when ISBNdb subscription starts — items 7/8 unblock this)

- [ ] Confirm ISBNdb Basic plan / start trial (item 8)
- [ ] Set `ISBNDB_API_KEY`, `GOOGLE_BOOKS_API_KEY` as Edge Function secrets
- [ ] Scaffold `supabase/functions/isbn-lookup/`
- [ ] ISBN normalize/validate helper (10/13, hyphen strip, isbn13 canonical)
- [x] Cache check → optional ISBNdb when configured → Google Books → upsert pipeline
- [ ] In-memory rate gate (option B)
- [ ] Wire `functions.invoke('isbn-lookup')` into the sell form in js/main.js
- [ ] Test: cache hit, ISBNdb hit, 404 fallback, 429 fallback, total miss

---

## 8. Out of scope for Phase 1
- Negative (miss) caching
- Cache refresh / expiry
- Scheduled cache warming
- Higher-tier ISBNdb plans (Premium 3/s, Pro price data) — revisit if volume
  grows; the function's interface won't change, only the base URL + gate rate.
