# BookSharez Technical Architecture & Engineering Specification

**Version:** 1.0
**Date:** June 15, 2026
**Purpose:** Software architecture reference and coding task generation
**Status:** AUTHORITATIVE (target architecture) — describes the **full, phased**
product. For *current* build scope, [PHASE_1_MVP_SPEC.md](PHASE_1_MVP_SPEC.md)
governs. The product rationale lives in
[BOOKSHAREZ_PRODUCT_VISION.md](BOOKSHAREZ_PRODUCT_VISION.md).

> **Stack note (per the June 12 ADR — see PHASE_1_MVP_SPEC.md):** BookSharez is a
> **vanilla HTML/CSS/JS frontend + Supabase (Postgres, Auth, Storage, Edge
> Functions)**. The "Core Services" in §3 are *logical responsibilities*,
> realized as **Supabase Edge Functions + client-side JS modules + RLS-protected
> Postgres** — **not** separately deployed microservices. Read service names as
> areas of code, not infrastructure.

---

## 1. System Overview

BookSharez is a community-first book marketplace with three integrated subsystems:

1. **Marketplace** — Peer-to-peer book buying and selling with affiliate fallback
2. **Identity** — Reader profiles derived from dual-shelf system (Books I Have / Books I Want)
3. **Social** — Follow graph, activity feeds, and per-book discussion forums

**Core invariant:** Every search resolves to a meaningful outcome. No dead ends.

---

## 2. Data Model

### 2.1 User

```
user
├── user_id (UUID, PK)
├── email
├── username
├── profile_visibility (enum: public | friends_only | private)
├── created_at
├── updated_at
└── Derived (computed, not stored directly):
    ├── favorite_genres[]
    ├── favorite_authors[]
    └── reading_profile_vector (for recommendation engine)
```

**Relationships:**
- has many → shelf_entries (Books I Have, Books I Want)
- has many → listings
- has many → reviews
- has many → discussion_posts
- has many → follows (as follower and as followed)

### 2.2 Shelf Entry

```
shelf_entry
├── id (UUID, PK)
├── user_id (FK → user)
├── book_id (FK → book)
├── shelf_type (enum: have | want)
├── is_for_sale (boolean, default false) — only valid when shelf_type = have
├── visibility (enum: public | hidden) — per-book privacy override
├── added_at
└── updated_at
```

**Key behavior:** Adding a book to "Books I Have" does NOT create a listing. User must explicitly toggle `is_for_sale`, which then triggers the listing creation flow.

### 2.3 Book (Canonical Entity)

```
book
├── book_id (UUID, PK)
├── isbn (VARCHAR(13), UNIQUE)
├── isbn10 (VARCHAR(10))
├── title (TEXT, NOT NULL)
├── author (TEXT)
├── publisher (TEXT)
├── publish_date (DATE)
├── cover_url (TEXT)
├── page_count (INTEGER)
├── genre[] (TEXT[])
├── language (VARCHAR(10))
├── edition (TEXT)
├── created_at
└── updated_at
```

**Source:** Populated from the local cache first, then Google Books by default. ISBNdb is an optional paid enhancement; Open Library is the browser fallback. One canonical record per ISBN.

### 2.4 Listing (Marketplace Item)

```
listing
├── listing_id (UUID, PK)
├── book_id (FK → book)
├── seller_user_id (FK → user)
├── shelf_entry_id (FK → shelf_entry) — links back to shelf
├── price (DECIMAL(10,2))
├── condition (enum: like_new | very_good | good | fair | poor)
├── description (TEXT, max 500 chars)
├── shipping_method (enum: local_pickup | self_ship | platform_kit) — Phase 3+
├── status (enum: active | sold | removed)
├── created_at
└── updated_at
```

### 2.5 Listing Photos

```
listing_photo
├── id (UUID, PK)
├── listing_id (FK → listing)
├── photo_url (TEXT)
├── display_order (INTEGER)
└── created_at
```

Constraints: minimum 3, maximum 5 photos per listing.

### 2.6 Affiliate Offer

```
affiliate_offer
├── offer_id (UUID, PK)
├── book_id (FK → book)
├── provider (TEXT) — e.g. Amazon, AbeBooks
├── price (DECIMAL(10,2))
├── shipping_estimate (DECIMAL(10,2))
├── external_url (TEXT)
├── fetched_at (TIMESTAMP)
└── expires_at (TIMESTAMP)
```

**Display rule:** Shown below community listings, or when community inventory is empty/insufficient.

### 2.7 Discussion Thread

```
discussion_thread
├── thread_id (UUID, PK)
├── book_id (FK → book)
├── created_by (FK → user)
├── title (TEXT)
├── moderation_state (enum: open | locked | hidden)
├── created_at
└── updated_at
```

### 2.8 Discussion Post

```
discussion_post
├── post_id (UUID, PK)
├── thread_id (FK → discussion_thread)
├── user_id (FK → user)
├── body (TEXT)
├── parent_post_id (FK → discussion_post, nullable) — for threaded replies
├── created_at
└── updated_at
```

### 2.9 Review

```
review
├── review_id (UUID, PK)
├── book_id (FK → book)
├── user_id (FK → user)
├── rating (INTEGER, 1-5)
├── body (TEXT)
├── created_at
└── updated_at
```

Constraint: One review per user per book.

### 2.10 Follow

```
follow
├── id (UUID, PK)
├── follower_id (FK → user)
├── followed_id (FK → user)
├── created_at
```

Constraint: UNIQUE(follower_id, followed_id). No self-follows.

---

## 3. Core Services

| Service | Responsibility |
|---------|---------------|
| **User Service** | Auth, profiles, shelf management, privacy settings |
| **Book Catalog Service** | Canonical book records, cache-first ISBN lookup (Google Books by default; optional ISBNdb), metadata enrichment |
| **Listing Service** | CRUD for marketplace listings, condition/pricing, photo management |
| **Affiliate Service** | External offer aggregation, caching, display logic |
| **Search Service** | Full-text search across books, users, discussions |
| **Discussion Service** | Per-book forums, threading, moderation |
| **Follow/Feed Service** | Social graph, activity feed generation, notifications |
| **Recommendation Engine** | Shelf-based similarity scoring, book suggestions |
| **Pricing Service** | AI price suggestion with fallback algorithm |

---

## 4. Key Algorithms

### 4.1 Shelf Similarity Scoring

Compare two users based on overlap between their shelves. Used for user recommendations and trust signals.

```
similarity(userA, userB) =
  |intersection(A.have, B.have)| + |intersection(A.want, B.want)|
  / |union(A.have, B.have, A.want, B.want)|
```

### 4.2 Listing Ranking (Book Page)

When displaying listings for a specific book, rank by:

1. Relevance to query context
2. Price competitiveness
3. Condition quality
4. Seller trust score (derived from shelf depth, review count, activity history — NOT transaction count)

### 4.3 Dead-End Prevention

When a book search returns zero community listings:

1. Check affiliate offers → display if available
2. If no affiliate offers → show "Books I Want" count (social proof)
3. Always offer "Add to Books I Want" and "Set alert when available"
4. Never show an empty results page

### 4.4 Affiliate vs Community Weighting

Community listings always appear first. Affiliate offers shown:

- Below community listings (always)
- Promoted when affiliate price is significantly lower
- Expanded via "More options" toggle
- As primary when zero community inventory exists

---

## 5. Primary User Flows (Engineering)

### 5.1 Visitor → Search → Convert

```
visitor lands → search/browse (no auth) → view book page → view seller profiles
→ trigger conversion when: buying | selling | posting | following
```

### 5.2 Registration → Shelf Setup

```
signup → land on Shelf Setup page → populate "Books I Have" + "Books I Want"
→ system generates: recommendations, potential matches, discussion suggestions
```

### 5.3 Shelf → Listing (Sell Flow)

```
user has book on "Books I Have" shelf → toggles "Available for Sale"
→ listing form opens (condition, price, shipping, photos)
→ listing published → appears on book page + user profile
```

Note: Selling always flows THROUGH the shelf. There is no listing creation path that bypasses shelf membership.

### 5.4 Book Page → Buy Flow

```
user on book page → sees community listings (primary) + affiliate offers (secondary)
→ selects offer → if not logged in: auth gate → checkout
```

### 5.5 Follow → Feed

```
user follows another user → receives feed of:
  - new shelf additions
  - new listings
  - reviews and ratings
  - discussion posts
  - ALERT: when followed user lists a book the follower wants
```

---

## 6. Book Page Structure

Every book page has three tabs/sections:

### BUY
- Community listings ranked by relevance, price, condition, trust
- Affiliate listings below or in expandable section

### SELL
- Quick listing form (pre-filled book metadata)
- Condition, price (AI-suggested), photos, shipping

### DISCUSS
- Per-book mini forum
- Reviews displayed alongside discussion threads

---

## 6A. The Book Object (Rendering Contract)

A book is a single object that renders itself at any density and carries a
viewer-relative action set. Anywhere a book surfaces — search result, shelf tile,
scan result, profile thumbnail, feed item, or full detail page — it is the *same
object* drawing itself differently, not a fresh hand-built representation.

This contract exists to prevent renderer drift: the failure mode where each feature
reconstructs "a book on screen" with its own markup, its own field names, and its
own fallbacks, so that adding one data point requires editing every renderer.

### Three seams

**1. `Book` (canonical, viewer-independent)**

```
Book = { bookId, isbn, title, author, coverUrl, year }
```

One normalized shape. Every source — a `listings` row, a `shelf_entries` row, an
external API result — passes through `normalizeBook(raw)` to produce it. There is
exactly one field name per concept (`coverUrl`, never also `image` or `cover`).

**2. `BookContext` (this viewer's relationship to the book)**

```
BookContext = { isListedLocally, communityCount, myListingId,
                onHaveShelf, onWantShelf, isForSale, wantCount }
```

The differences between a community card, an "external/not-listed" card, and a
"For Sale"-badged shelf thumbnail are not separate templates — they are different
values of this one object. Context is *data carried alongside the book*, not
knowledge baked into which function happened to be called.

**3. `availableActions(book, context)` → `[{ label, icon, handler }]`**

The action set is derived from state, not hardcoded into markup. A book listed
locally offers Buy; one not yet listed offers "List it"; one already on the
viewer's Have shelf offers List-for-sale / Remove. The renderer loops the returned
list; affordances are added by extending this function, never by editing a template.

### The renderer

```
renderBook(book, context, density)   // density → tile | thumb | full
```

One function consumes all three seams. `tile` is the grid card, `thumb` is the
compact shelf cover (with badge), `full` is the detail page. The compact picker row
used inside the shelf/sell modals is intentionally **not** part of this contract —
it is a selection control, not a book representation, and stays separate.

### Phase alignment

Phase 1 populates only `isListedLocally`, `communityCount`, and `myListingId`; the
remaining `BookContext` fields are declared but null. They are the seams onto which
Phase 2 (shelves, want-counts) and Phase 3–4 (discussion, reviews) attach without
re-touching any renderer.

---

## 7. Profile Page Structure (Priority Order)

### 1. Bookshelf (Primary — why someone visits)
- Books I Have (public by default)
- Books I Want (public by default)
- Recently Added
- Derived: Favorite Authors, Favorite Genres

### 2. Activity (Secondary — why someone stays)
- Reviews and ratings
- Discussion posts
- Reading lists

### 3. Social (Tertiary — why someone returns)
- Followers / Following
- Shared interests with viewer

### 4. Marketplace (Supporting — exists but not dominant)
- Books for Sale
- Seller trust signals (reader-identity derived — see §8; not a star rating)
- Transaction history (optional visibility)

---

## 8. Trust Model

Traditional marketplace trust: transaction count + ratings.

**BookSharez trust:** Derived from reader identity signals:

- Shelf depth and curation quality
- Review and discussion history
- Participation longevity
- Shared shelf overlap with viewer
- Activity consistency

This means a user with 200 books on their shelf, 15 reviews, and active discussion participation is trusted — even with zero transactions.

---

## 9. Privacy Controls

**Default:** Shelves are public.

**User controls:**
- Global account visibility (public | friends_only | private)
- Per-book visibility toggle (hide individual books)
- Per-shelf visibility toggle (hide entire shelf)
- Sale status visibility toggle
- Transaction history visibility toggle

---

## 10. Critical Event System

Events that trigger downstream actions (feeds, notifications, recommendations):

| Event | Triggers |
|-------|----------|
| `user_add_book_to_have` | Recommendation refresh, potential buyer notification |
| `user_add_book_to_want` | Potential seller notification, affiliate search |
| `user_toggle_sell_status` | Listing creation flow, want-list alert check |
| `listing_created` | Feed update, search index update |
| `listing_sold` | Transaction record, shelf update |
| `book_search_performed` | Analytics, dead-end tracking |
| `affiliate_fallback_triggered` | Analytics (track supply gaps) |
| `user_followed` | Feed subscription creation |
| `discussion_post_created` | Feed update, notification to thread participants |
| `review_created` | Feed update, book aggregate rating update |

---

## 11. Phase Alignment

This architecture describes the full product vision. Implementation is phased:

| Component | Phase |
|-----------|-------|
| Auth, listing CRUD, ISBN lookup, search, photo upload | Phase 1 (MVP) |
| Shelf system (Books I Have / Books I Want), profiles, follow graph | Phase 2 |
| Payments (Stripe), shipping, transaction history | Phase 3 |
| Discussion forums, reviews, affiliate integration | Phase 3-4 |
| Recommendation engine, activity feeds, notifications | Phase 4 |
| SHAREZ credit system, multi-campus expansion | Phase 4+ |

**Phase 1 MVP builds the marketplace foundation. All subsequent phases layer onto this base.**

---

## 12. Design Principles (Engineering)

1. **Every user is both a reader and a potential seller.** Data model treats these as unified, not separate.
2. **Every book is both an object of commerce and conversation.** Book pages serve both functions.
3. **Every search resolves to a meaningful outcome.** Dead-end prevention is a system requirement, not a UX preference.
4. **Identity is inferred, not declared.** No onboarding questionnaires. Shelves generate the profile.
5. **Community supply is always prioritized.** Affiliate is fallback, never primary.
6. **Every book is a single self-rendering object.** A book renders itself at any density (tile / thumb / full) and carries a viewer-relative action set derived from `BookContext`. No feature hand-builds a book card. See §6A for the contract.
7. **The capture loop is the primary interface.** The product is phone-first around camera capture — barcode scan *or* front-cover photo → book identified → added to "Books I Have" → one-tap list for sale — repeated fast enough to mirror an entire physical bookshelf in one session (see [PRODUCT_VISION "The Core Loop"](BOOKSHAREZ_PRODUCT_VISION.md)). Mobile responsiveness and the per-iteration speed of this loop take priority over desktop polish; any change that adds a tap or a second to the loop needs a strong reason.

---

*This document defines the target architecture. Refer to PHASE_1_MVP_SPEC.md for current implementation scope.*
