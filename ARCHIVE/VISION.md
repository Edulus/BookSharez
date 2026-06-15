> **ARCHIVED (June 15, 2026).** Superseded by
> [docs/BOOKSHAREZ_ARCHITECTURE.md](../docs/BOOKSHAREZ_ARCHITECTURE.md) (the full
> technical target design) and [docs/BOOKSHAREZ_PRODUCT_VISION.md](../docs/BOOKSHAREZ_PRODUCT_VISION.md)
> (the product vision). Kept here for reference only — not authoritative.

---

# BookSharez Product Specification (Synthesis for Engineering Tasks)

## 1. Product Definition

BookSharez is a **community-first book marketplace with integrated social discovery and discussion**, combining:

- A peer-to-peer used book marketplace (eBay-like)
- A reader identity system derived from personal bookshelves (Goodreads-like)
- A book-level discussion system (mini-forums per title)
- An affiliate inventory fallback layer to prevent search dead-ends

The platform is designed around a core principle:

> Users are defined by the books they own and want, not by self-declared profile attributes.

---

## 2. Core Product Philosophy

### 2.1 No Dead Ends

If a book exists anywhere in the supply ecosystem (community or affiliate), the user must be able to find it.

### 2.2 Community-First Supply

BookSharez seller listings are prioritized in UI and ranking, but not exclusive.

### 2.3 Dual Shelf Identity Model

Every user has two primary structural objects:

- **Books I Have**
- **Books I Want**

These shelves define identity, recommendations, social graph, and marketplace activity.

### 2.4 Participation > Profile Creation

User identity is inferred from behavior and shelves, not onboarding questionnaires.

---

## 3. Core Data Model

### 3.1 User

- user_id
- profile_visibility_settings (global + per-book overrides)
- books_i_have[]
- books_i_want[]
- followers[]
- following[]
- reviews[]
- discussion_posts[]

Derived attributes:

- favorite_genres (inferred)
- favorite_authors (inferred)
- reading_profile_vector (for recommendations)

---

### 3.2 Book (Canonical Entity)

- book_id (ISBN-backed canonical ID)
- title
- author
- metadata (genre, edition, publication info)
- cover_image
- aggregated listings

---

### 3.3 Listing (Marketplace Item)

- listing_id
- book_id
- seller_user_id
- price
- condition
- availability_status
- shipping_method (self-ship / BookSharez kit)
- created_at

---

### 3.4 Affiliate Offer

- offer_id
- book_id
- provider
- price
- shipping estimate
- external_url

Displayed only when relevant or when BookSharez inventory is insufficient/less optimal.

---

### 3.5 Discussion Thread (Per Book)

- thread_id
- book_id
- posts[]
- participants[]
- moderation_state

---

## 4. Primary User Flows

### 4.1 Visitor Flow

1. Land on site
2. Search/browse books immediately (no login required)
3. View:
   - Book page (inventory + discussion)
   - Seller profiles

4. Convert to user when:
   - Buying
   - Selling
   - Posting
   - Following

---

### 4.2 Registration Flow

Upon signup:

1. User lands on **Shelf Setup Page**
2. Primary interface:
   - Books I Have (top priority)
   - Books I Want

3. User begins populating shelves
4. System immediately generates:
   - recommendations
   - potential buyers
   - potential sellers
   - discussion suggestions

---

### 4.3 “Books I Have” Flow

- Default state: NOT FOR SALE
- Toggle: “Available for Sale”
- If enabled:
  - Prompt for listing creation:
    - condition
    - price
    - shipping method
    - auto-filled metadata from book database

---

### 4.4 Buy Flow

1. User searches or lands on book page
2. Book page shows:
   - Primary: BookSharez seller listings
   - Secondary: affiliate offers

3. User selects offer
4. If not logged in → login/register
5. Checkout completes transaction

---

### 4.5 Sell Flow

1. User clicks “Sell” on a book
2. System loads canonical book metadata
3. User provides:
   - condition
   - price
   - shipping option

4. Listing published

---

### 4.6 Follow User Flow

Following a user enables:

- new shelf additions
- new listings
- reviews
- discussion activity
- alerts when they list books the follower wants

---

## 5. Book Page Structure

Each book page contains three primary actions:

### 5.1 BUY

- BookSharez listings (priority ranking)
- Affiliate listings (secondary fallback)

### 5.2 SELL

- Create listing for this book
- Pre-filled metadata
- Quick form

### 5.3 DISCUSS

- Mini forum for book-specific discussion
- reviews + posts

---

## 6. Ranking & Display Logic

### 6.1 Listing Priority

1. BookSharez seller listings (primary surface)
2. Affiliate listings (fallback layer)

Ranking within BookSharez:

- relevance to query
- price competitiveness
- condition quality
- seller trust signals (derived from reader profile and activity)

Affiliate listings are shown when:

- better price exists
- inventory is low
- or user expands “more options”

---

## 7. Profile System

### 7.1 Profile is bookshelf-first

Primary sections:

#### 1. Bookshelf (Primary Identity)

- Books I Have (public by default)
- Books I Want

#### 2. Activity

- reviews
- discussions
- reading activity

#### 3. Social

- followers
- following

#### 4. Marketplace Activity (secondary)

- books for sale
- transaction history (optional visibility)

---

## 8. Privacy Model

- Default: shelves are public
- Per-book privacy toggle available
- Global privacy settings available
- Users may hide:
  - individual books
  - entire shelves
  - sale status
  - account visibility

---

## 9. Social Graph Mechanics

### Following a user enables:

- feed of shelf changes
- new listings
- reviews and discussions
- alerts when:
  - they list books you want
  - they acquire books you have interest in

Social graph is driven by **shared bookshelf overlap**, not follower count.

---

## 10. System Design Implications (Engineering Tasks)

### 10.1 Core Services Needed

- User service (shelves + profiles)
- Book catalog service (canonical metadata)
- Listing service (marketplace)
- Affiliate aggregation service
- Search service (books + users + discussions)
- Discussion service (book-level forums)
- Recommendation engine (shelf-based similarity)

---

### 10.2 Key Algorithms

- Shelf similarity scoring (user-user matching)
- Book recommendation engine
- Listing ranking (multi-source blending)
- Affiliate vs community weighting logic
- “Dead-end prevention” routing system

---

### 10.3 Critical Events

- user_add_book_to_have
- user_toggle_sell_status
- listing_created
- book_search_performed
- affiliate_fallback_triggered
- user_followed
- discussion_post_created

---

## 11. Core Design Principle Summary

BookSharez is built on three invariants:

1. **Every user is both a reader and potential seller**
2. **Every book is both an object of commerce and conversation**
3. **Every search must resolve to a meaningful outcome (never a dead end)**

---

## End of Specification
