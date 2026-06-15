# Phase 1 MVP Specification
**Version:** 1.1  
**Date:** January 23, 2026 (architecture revision June 14, 2026)  
**Updated:** June 14, 2026 — Reflects vanilla JS + Supabase Edge Functions stack (pivoted from Next.js).  
**Status:** AUTHORITATIVE for **Phase 1 implementation scope** — overrides
conflicting information about *what we build now*. The full product is defined by
[BOOKSHAREZ_PRODUCT_VISION.md](BOOKSHAREZ_PRODUCT_VISION.md) (why/what) and
[BOOKSHAREZ_ARCHITECTURE.md](BOOKSHAREZ_ARCHITECTURE.md) (full target design);
this spec is the slice of that product shipping in Phase 1.

> ### Architecture Decision Record
> **June 12, 2026: Vanilla JS + Supabase Edge Functions chosen over Next.js.**
> BookSharez stays a vanilla HTML/CSS/JS site and evolves incrementally from the
> existing prototype. Server-side work (proxying ISBNdb / Google Books / AI keys,
> JWT-protected writes) is done in **Supabase Edge Functions**, not Next.js API
> routes. The scope, condition system, schema, and success metrics in this spec
> are unchanged; only the stack and deploy target are revised. The companion docs
> (security, error-handling, env) have been **converted** to vanilla JS + Edge
> Function (Deno) examples to match — Next.js/TypeScript samples are no longer the
> reference.

---

## ðŸŽ¯ PHASE 1 SCOPE DEFINITION

**Goal:** Functional book listing and discovery (a focused build, sequenced by
the ToDo.md backlog — the original "2 weeks" estimate is retired; work proceeds
incrementally from the existing prototype)  
**NOT included:** Payments, shipping, SHAREZ credits, detailed condition system

---

## ðŸ“š BOOK CONDITION SYSTEM (Simplified)

### Five Condition Grades
1. **Like New** — Looks almost unread: clean, crisp, no visible wear, writing,
   bent corners, or damage; dust jacket (if any) clean and intact.

2. **Very Good** — Clearly used but still strong: light shelf wear, slight corner
   rubbing, a small crease, or a previous owner's name; no major tears, missing
   pages, or structural damage.

3. **Good** — A normal worn used book: complete and readable, with obvious
   handling (edge wear, creasing, fading, small marks, a slightly cracked spine,
   or minor writing/underlining).

4. **Fair** — A rougher reading copy: still usable, but heavy wear, stains,
   loosened binding, damaged covers, notes/highlighting, possibly missing
   nonessential parts (e.g. endpapers).

5. **Poor** — Very damaged: missing pages, broken binding, detached covers, heavy
   staining, or water damage; sold only as a reading copy or because it's rare.

### Photo Requirements

**Cover image vs. seller photos (decision, June 15, 2026):**
- The **catalog cover image** is auto-fetched free from the **Google Books API**
  as part of ISBN lookup — the seller does not supply it. Until ISBN lookup is
  built, listings show a generic fallback cover.
- The seller then uploads photos of **their actual copy**, with a UX nudge:
  *the more real photos you add, the more likely your book is to sell.*

**Minimum 3 photos required:**
1. Front cover (straight-on)
2. Sample interior pages (showing any markings/highlighting)
3. Worst defect (or spine if no defects)

**Photo Standards:**
- Clear, well-lit images
- In focus
- Taken with smartphone camera
- No minimum resolution (mobile uploads)

### Condition Input Form
```
- Condition dropdown: [Like New | Very Good | Good | Fair | Poor]
- Optional text description (500 char max)
- Photo upload (3 minimum, 5 maximum)
```

**What's NOT in Phase 1:**
- âŒ Detailed questionnaires (from Book_Condition_Assessment_System.md)
- âŒ 10-photo requirements
- âŒ Mandatory assessment questions
- âŒ Full vs Quick assessment paths
- âŒ Verification system
- âŒ Dispute resolution process

---

## ðŸ’° PAYMENT FLOW (Cash Only)

### Phase 1 Payment Model
**Direct listing prices in USD**
- No SHAREZ credits
- No two-stage earning system
- Simple: List price = What buyer pays

### Pricing Mechanism
1. User scans ISBN
2. AI suggests price based on:
   - Condition selected
   - Market data (Google Books API)
   - Similar listings (if available)
3. User can accept or override AI price
4. Price stored in USD

### What's NOT in Phase 1:
- âŒ SHAREZ credit system
- âŒ Unusable/usable credit stages
- âŒ Credit-to-cash conversion
- âŒ Platform transaction fees
- âŒ Actual payment processing (Stripe comes in Phase 3)

---

## ðŸ“± PHASE 1 FEATURES (Final List)

### Core Listing Creation
- [x] Barcode scanner (camera + manual ISBN entry)
- [x] ISBNdb API lookup (with Google Books fallback)
- [x] 5-grade condition selector
- [x] Optional text description (500 char)
- [x] Photo upload (3-5 photos)
- [x] AI price suggestion
- [x] Manual price override
- [x] One-click "List Book" button

### User Authentication
- [x] Sign up (email + password)
- [x] Login
- [x] Logout
- [x] Protected routes (must be logged in to list)

### User Dashboard ("My Shelf")
- [x] View all user's listings
- [x] Edit listing (price, condition, description)
- [x] Delete listing
- [x] Mark as sold (manual toggle)
- [x] Basic stats (total listings, active count)

### Book Discovery
- [x] Browse all active listings (grid view)
- [x] Basic search (title, author, ISBN)
- [x] Filter by condition
- [x] Sort by (newest, price low-high, price high-low)

### Book Detail Page
- [x] Full book information
- [x] Seller's listed price
- [x] Condition grade and description
- [x] Photo gallery
- [x] Seller username (no contact info yet)
- [x] "Buy Now" button (visual only - no payment)

---

## ðŸ—„ï¸ DATABASE SCHEMA (Phase 1)

```sql
-- Books table
CREATE TABLE books (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  isbn VARCHAR(13) UNIQUE NOT NULL,
  isbn10 VARCHAR(10),
  title TEXT NOT NULL,
  author TEXT,
  publisher TEXT,
  publish_date DATE,
  cover_url TEXT,
  page_count INTEGER,
  language VARCHAR(10) DEFAULT 'en',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Listings table
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE NOT NULL,
  price DECIMAL(10,2) NOT NULL CHECK (price >= 0.01),
  condition TEXT NOT NULL CHECK (condition IN ('like_new', 'very_good', 'good', 'fair', 'poor')),
  description TEXT CHECK (char_length(description) <= 500),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'sold', 'removed')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Listing photos table
CREATE TABLE listing_photos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id UUID REFERENCES listings(id) ON DELETE CASCADE NOT NULL,
  photo_url TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_listings_user_id ON listings(user_id);
CREATE INDEX idx_listings_book_id ON listings(book_id);
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_created_at ON listings(created_at DESC);
CREATE INDEX idx_books_isbn ON books(isbn);
CREATE INDEX idx_listing_photos_listing_id ON listing_photos(listing_id);

-- Full text search (for book titles/authors)
CREATE INDEX idx_books_title_search ON books USING gin(to_tsvector('english', title));
CREATE INDEX idx_books_author_search ON books USING gin(to_tsvector('english', author));

-- Row Level Security
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_photos ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can insert their own listings"
  ON listings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view all active listings"
  ON listings FOR SELECT
  USING (status = 'active' OR auth.uid() = user_id);

CREATE POLICY "Users can update their own listings"
  ON listings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own listings"
  ON listings FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Anyone can view listing photos for active listings"
  ON listing_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM listings 
      WHERE listings.id = listing_photos.listing_id 
      AND (listings.status = 'active' OR listings.user_id = auth.uid())
    )
  );

CREATE POLICY "Users can insert photos for their listings"
  ON listing_photos FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM listings 
      WHERE listings.id = listing_photos.listing_id 
      AND listings.user_id = auth.uid()
    )
  );
```

---

## ðŸš« EXPLICITLY DEFERRED TO LATER PHASES

> **Canonical phase roadmap:** the deferral list below predates the product
> vision. For the authoritative, up-to-date phasing of the *full* product (shelf
> system, social graph, discussions, reviews, affiliate, recommendations, SHAREZ
> credits), see **§11 Phase Alignment** in
> [BOOKSHAREZ_ARCHITECTURE.md](BOOKSHAREZ_ARCHITECTURE.md). The list here remains
> accurate for what is *out* of Phase 1; week numbers are illustrative only.

### Phase 2 (Weeks 3-4)
- Advanced search/filters
- User profiles
- Favorites/wishlist
- Image optimization

### Phase 3 (Weeks 5-6)
- Stripe payment integration
- Shipping label generation
- Transaction history
- Email notifications
- Detailed condition verification
- Photo comparison system
- Dispute resolution

### Phase 4+ (Future)
- SHAREZ credit system
- Two-stage earning (pending â†’ usable)
- Credit-to-cash conversion
- Social features (following, feed)
- AI recommendations
- Reputation system
- Book clubs
- Mobile app

---

## âš¡ SUCCESS METRICS (Phase 1)

**Must achieve:**
- [ ] User can list a book in <30 seconds
- [ ] ISBNdb lookup success rate >85%
- [ ] AI price suggestion generated in <3 seconds
- [ ] Photo upload works on iOS and Android
- [ ] Search returns results in <500ms
- [ ] Mobile responsive on all breakpoints
- [ ] Zero critical bugs in listing flow

**Nice to have:**
- Book cover images display for >90% of listings
- Users can edit listings without page refresh
- Form validation provides helpful error messages

---

## ðŸ”§ TECHNICAL IMPLEMENTATION NOTES

### AI Pricing Logic
```javascript
// Simplified pricing algorithm for Phase 1
function estimatePrice(bookData, condition) {
  // 1. Get base price from Google Books API (list price)
  // 2. Apply condition multiplier:
  //    - Like New: 0.7-0.8x list price
  //    - Very Good: 0.5-0.6x list price
  //    - Good: 0.3-0.4x list price
  //    - Fair: 0.15-0.25x list price
  //    - Poor: 0.05-0.15x list price
  // 3. Round to nearest $0.50
  // 4. Minimum price: $2.00
  // 5. Return price + confidence level
}
```

### Photo Storage
- Store in Supabase Storage bucket: `listing-photos`
- Organize by listing ID: `{listing_id}/{photo_index}.jpg`
- No image processing in Phase 1 (accept as uploaded)
- Max file size: 5MB per photo
- Allowed formats: JPG, PNG, WEBP

### Search Implementation
- Use PostgreSQL full-text search (built-in)
- Search fields: book title, author
- No fuzzy matching in Phase 1
- No autocomplete/suggestions in Phase 1

---

## ðŸ“‹ PHASE 1 CHECKLIST

_Sequence is tracked in ToDo.md; grouping below is logical, not time-boxed._

### Stage 1: Foundation
- [x] Keep the vanilla HTML/CSS/JS prototype as the baseline (committed to git)
- [x] Initialize Supabase client (js/supabase-config.js — URL + publishable key)
- [ ] Set up Supabase (database + auth)
- [ ] Get API keys (ISBNdb, Google Books, DeepSeek) — stored as Edge Function secrets
- [ ] Create database schema with indexes (run the SQL in this spec, verbatim)
- [x] Implement real auth (login, signup, logout) — replaces fake login
- [ ] Build Scanner (camera barcode + manual ISBN entry)
- [ ] ISBN lookup Edge Function — ISBNdb with Google Books fallback + `books`-table cache
- [ ] Test end-to-end book lookup

### Stage 2: Listing & Dashboard
- [ ] Build listing form with validation
- [ ] AI pricing Edge Function (DeepSeek) + fallback algorithm
- [ ] Photo upload to Supabase Storage (3-5 photos)
- [ ] Build out "My Shelf" dashboard
- [ ] Edit / delete / mark-as-sold listing functionality
- [ ] Browse all listings page
- [ ] Basic search implementation
- [ ] Book detail page
- [ ] Mobile responsive polish
- [ ] Load testing with 100 sample listings
- [ ] Deploy static site to a host (e.g. Netlify / Cloudflare Pages / GitHub Pages)

---

## âœ… PHASE 1 COMPLETION CRITERIA

**MVP is complete when:**
1. User can create an account
2. User can scan/enter ISBN and list book with 3 photos in <30 seconds
3. User can view all their listings and edit them
4. User can browse all active listings
5. User can search books by title/author
6. All pages are mobile responsive
7. No critical bugs in core flows
8. Deployed to production at booksharez.com (or subdomain)

**Phase 1 DOES NOT include:**
- Payment processing
- Messaging between users
- Shipping integration
- Transaction history
- SHAREZ credits
- Reputation system
- Detailed condition verification

---

**This specification is authoritative for Phase 1 development. When conflicts arise with other documents, defer to this spec.**
