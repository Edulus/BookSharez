# Phase 1 Operations Guide

**Version:** 1.0  
**Date:** January 23, 2026  
**Updated:** June 14, 2026 — Reflects vanilla JS + Supabase Edge Functions stack (pivoted from Next.js).  
**Status:** Provisional - To be refined before launch

---

## ðŸŽ¯ BUSINESS STRATEGY

### Launch Campus Selection

**Recommended Initial Target: Medium-sized state university (10,000-25,000 students)**

**Selection Criteria:**
1. **Textbook Market Size**
   - High textbook costs ($500-1200/semester average)
   - Large used book demand
   - Active existing textbook exchange (Facebook groups, bulletin boards)

2. **Accessibility**
   - Physical access for on-campus marketing
   - Existing relationships with student organizations
   - Manageable market size for MVP testing

3. **Tech-Savvy Population**
   - High smartphone adoption
   - Active social media presence
   - Early adopter community (CS/engineering programs)

**Campus Selection Process:**
1. Identify 3-5 candidate campuses meeting criteria
2. Research existing textbook exchange activity (Facebook groups, Reddit)
3. Assess competition (Chegg, Amazon, campus bookstore policies)
4. Choose campus with highest demand + lowest friction

**Launch Timeline:**
- Week -2: Finalize campus selection, identify student partners
- Week -1: Seed 20-30 textbook listings (recruit sellers)
- Week 0: Soft launch to 50 users (friends, partners)
- Week 1-2: Active marketing push (target 100 users)
- Week 3-4: Iterate based on feedback, expand to 250 users

---

### User Acquisition Plan (First 100 Users)

**Phase 1: Seed Network (20-30 users)**
- **Who:** Friends, CS students, book enthusiasts you know
- **Ask:** "List 5 books each to populate inventory"
- **Incentive:** First 20 users get free premium features (Phase 2+)

**Phase 2: Student Organization Partnerships (30-50 users)**
- Target groups:
  - Computer Science Club
  - Student Government
  - Environmental/Sustainability groups
  - Book clubs
  - Library student workers
- **Pitch:** "Help students save money on textbooks, reduce waste"
- **Partnership:** Co-branded flyers, social media posts, tabling events

**Phase 3: Grassroots Marketing (50+ users)**
- **Flyers:** Post in high-traffic areas
  - Library
  - Student union
  - Dorms
  - Campus coffee shops
  - Lecture halls (with permission)
- **Message:** "Sell your textbooks in 30 seconds. Keep 100% of the price."

**Phase 4: Social Media (Ongoing)**
- Facebook campus groups: "Books for sale", "Free & For Sale"
- Instagram: @booksharez_[campus]
- TikTok: Short videos of scanning/listing process
- Reddit: r/[campus] (follow self-promotion rules)

**Key Metrics:**
- Week 1: 50 users, 100 listings
- Week 2: 100 users, 250 listings
- Week 4: 250 users, 500 listings
- First transaction within 48 hours of launch

**Early Adopter Incentives:**
- First 100 users: Founder badge on profile (Phase 2)
- First 10 sellers: Featured listings (Phase 2)
- Referral program: "Invite 3 friends, get priority support"

---

### Competitive Analysis

#### Direct Competitors

**1. Chegg**
- **Model:** Rental service, not peer-to-peer
- **Pricing:** $15-50/textbook rental
- **Strengths:** Large inventory, shipping included, brand recognition
- **Weaknesses:** No ownership, rental deadlines, high fees
- **BookSharez Advantage:** Keep books permanently, peer-to-peer = lower prices, sell anytime

**2. Amazon Textbook Exchange**
- **Model:** Marketplace with Amazon as intermediary
- **Pricing:** Variable, Amazon takes 15% commission + shipping
- **Strengths:** Trust, massive user base, Prime shipping
- **Weaknesses:** Fees reduce seller profit, slow listing process, generic experience
- **BookSharez Advantage:** 100% to seller (Phase 1), faster listing (scan ISBN), campus-local = no shipping

**3. Facebook Marketplace**
- **Model:** Free peer-to-peer listings
- **Pricing:** Seller sets price, no fees
- **Strengths:** Free, existing user base, local pickup
- **Weaknesses:** Poor book search, no ISBN lookup, scams, no moderation, generic interface
- **BookSharez Advantage:** Book-specific features (ISBN scan, condition system), trust/reputation, curated for books

**4. Campus Bookstore Buyback**
- **Model:** School buys used books at fixed prices
- **Pricing:** Typically 25-50% of original price
- **Strengths:** Instant cash, convenient
- **Weaknesses:** Very low prices, selective (won't buy many books)
- **BookSharez Advantage:** Sellers keep 100%, set own prices, sell any book

#### Feature Comparison Table

| Feature | BookSharez | Chegg | Amazon | Facebook | Campus Bookstore |
|---------|-----------|-------|--------|----------|------------------|
| Seller keeps % | 100% | N/A (rental) | 85% | 100% | 25-50% |
| Listing time | <30 sec | N/A | 5-10 min | 3-5 min | N/A |
| ISBN scanning | âœ… | N/A | âŒ | âŒ | âœ… (in-store) |
| Condition grading | âœ… | âœ… | âœ… | âŒ | âœ… |
| Local pickup | âœ… | âŒ | âŒ | âœ… | âœ… |
| Shipping option | Phase 3 | âœ… | âœ… | Manual | N/A |
| Trust/reputation | Phase 2 | âœ… | âœ… | âŒ | âœ… |
| Book-specific search | âœ… | âœ… | âœ… | âŒ | âœ… |

**Key Differentiators:**
1. **Speed:** List a book in 30 seconds vs 5+ minutes elsewhere
2. **Seller profit:** 100% vs 50-85% on other platforms
3. **Campus focus:** Local, trusted community vs anonymous marketplace
4. **Book-first design:** Built for books, not generic items

---

### Content Moderation Strategy

**Phase 1 Approach: Lightweight moderation with clear policies**

#### Automated Moderation (Built-in)
- Restrict listings to books only (verified via ISBN)
- Photo requirements enforce visual documentation
- Price limits ($0.01 - $999.99) prevent spam
- Character limits on descriptions (500 chars)

#### Manual Moderation (Minimal for MVP)
**Who moderates:** You (founder) during Phase 1
- Time commitment: ~15 min/day for first 100 users
- Scale to 2-3 moderators at 500+ users

**What requires manual review:**
- User-reported listings (flagging system)
- Listings with suspicious pricing (e.g., $0.01 for new textbook)
- Descriptions with prohibited content (see below)
- Accounts with multiple disputes

#### Prohibited Content
**Not allowed on BookSharez:**
- Non-book items (unless Phase 2+ expands)
- Illegal or pirated content (PDFs, photocopied textbooks)
- Hate speech, harassment, discriminatory content
- Personal contact info in listings (phase 1 - protect privacy)
- Links to external sites (prevent phishing)

#### User Reporting System
**Flagging Options:**
- Not a book / Wrong item
- Inappropriate content
- Suspected scam
- Copyright violation
- Other (with text explanation)

**Response Time SLA:**
- Reported listings: Review within 24 hours
- Disputes between users: Respond within 48 hours
- Account suspension: Review within 12 hours

#### Enforcement Actions
**Progressive discipline:**
1. **Warning:** First offense, email notification
2. **Listing removal:** Second offense, listing taken down
3. **Temporary suspension:** 7-day ban after 3 violations
4. **Permanent ban:** Egregious violations or repeat offenses

**Immediate ban offenses:**
- Posting illegal content
- Harassment of other users
- Fraudulent payment attempts (Phase 3+)
- Multiple fake listings

#### Dispute Resolution
**Between buyer and seller (Phase 1: Manual process)**
1. User reports issue via contact form
2. Moderator reviews photo evidence from both parties
3. Decision within 48 hours
4. Options:
   - Full refund (seller misrepresented condition)
   - Partial refund (minor condition difference)
   - No refund (buyer claim unfounded)
5. Record dispute on both accounts (reputation Phase 2)

**Phase 1 Note:** Without payment processing, disputes are limited to:
- Condition misrepresentation
- Item not as described
- Seller didn't show up for pickup (campus-local)

---

## âš–ï¸ LEGAL & COMPLIANCE

### Privacy Policy (Basic Template)

**Effective Date:** [Launch Date]

**Introduction**
BookSharez ("we," "us," "our") operates booksharez.com and respects your privacy. This policy explains what information we collect and how we use it.

**Information We Collect**
1. **Account Information**
   - Email address (for authentication)
   - Username (public display name)
   - Password (encrypted, never stored in plain text)

2. **Listing Information**
   - Books you list (title, condition, price, photos)
   - Transaction history (when implemented in Phase 3)

3. **Technical Information**
   - IP address (for security)
   - Browser type and version
   - Device information
   - Usage data (pages visited, features used)

**How We Use Your Information**
- Provide and improve our services
- Authenticate your account
- Display your listings to other users
- Send important service notifications (account changes, security alerts)
- Prevent fraud and abuse
- Comply with legal obligations

**Information Sharing**
We do NOT sell your personal information. We share data only:
- With other users (public listings, username)
- With service providers (Supabase for hosting, email service)
- When required by law

**Your Rights**
- Access your data (download your listings)
- Correct inaccurate data (edit profile/listings)
- Delete your account (contact support)
- Opt out of marketing emails

**Data Security**
- HTTPS encryption for all traffic
- Passwords hashed with industry-standard algorithms
- Row Level Security on database
- Regular security audits

**Cookies**
We use essential cookies for authentication. No tracking or advertising cookies in Phase 1.

**Age Requirement**
You must be 18 or older to use BookSharez. If you are under 18, you may use the service with parental consent and supervision.

**Changes to This Policy**
We may update this policy. Changes will be posted on this page with a new effective date.

**Contact Us**
Questions? Email: privacy@booksharez.com

---

### Terms of Service (Basic Template)

**Effective Date:** [Launch Date]

**1. Acceptance of Terms**
By using BookSharez, you agree to these Terms of Service. If you don't agree, don't use our service.

**2. Eligibility**
- You must be 18+ or have parental consent
- You must provide accurate account information
- One account per person

**3. User Responsibilities**

**As a Seller, you agree to:**
- List only books you actually own
- Accurately describe book condition
- Upload truthful photos
- Respond to buyer inquiries within 48 hours (Phase 3+)
- Meet agreed-upon pickup/shipping terms (Phase 3+)

**As a Buyer, you agree to:**
- Pay agreed-upon prices (Phase 3+)
- Meet agreed-upon pickup terms
- Not harass sellers
- Report issues within 48 hours of receiving book

**4. Prohibited Conduct**
You may NOT:
- Post non-book items (Phase 1)
- Use BookSharez for any illegal purpose
- Harass, threaten, or impersonate others
- Scrape or data mine our platform
- Attempt to circumvent security measures
- List pirated or photocopied copyrighted material

**5. Content Ownership**
- You own your listings, photos, and descriptions
- You grant BookSharez a license to display your content
- BookSharez owns the platform and code
- We may remove content that violates these terms

**6. Disputes**
- Disputes between users should be resolved directly (Phase 1)
- We may assist in dispute resolution but are not obligated
- We reserve the right to suspend accounts involved in disputes
- You agree to arbitration for disputes with BookSharez (not small claims court)

**7. Limitation of Liability**
BookSharez is provided "as is." We are not liable for:
- Lost, stolen, or damaged books
- User conduct or disputes
- Technical issues or downtime
- Inaccurate listings or fraud

**Maximum liability: Amount paid to BookSharez in past 12 months (currently $0)**

**8. Termination**
- You may delete your account anytime
- We may suspend or terminate accounts that violate these terms
- Termination does not affect completed transactions

**9. Changes to Terms**
We may update these terms. Continued use = acceptance of new terms.

**10. Governing Law**
These terms are governed by the laws of [Your State/Country].

**11. Contact**
Questions? Email: legal@booksharez.com

---

### Age Verification

**Phase 1 Approach: Self-Declaration with Email Verification**

**Minimum Age: 18 years old**
*(Users 13-17 may use with documented parental consent - to be implemented Phase 2)*

**Verification Method (Phase 1):**
1. **Checkbox on signup:** "I confirm I am 18 years or older"
2. **Email verification:** Must verify email before listing books
3. **No additional verification required** (keep friction low for MVP)

**Why 18+:**
- Simplifies legal compliance (no COPPA requirements)
- Users can enter contracts (buying/selling)
- Reduces liability for platform
- Standard for most marketplace platforms

**Future Enhancement (Phase 2+):**
- .edu email verification (confirms college student status)
- Date of birth field (required)
- ID verification for high-value transactions ($100+)

**Enforcement:**
- Self-reported age stored in database
- No age displayed publicly
- Age confirmed once per account
- Accounts claiming <18 must provide parental consent form

**COPPA Compliance (if allowing under 13 in future):**
- NOT RECOMMENDED for Phase 1-3
- Requires extensive parental consent mechanisms
- Significantly increases legal complexity
- Better to restrict to 18+ for MVP

---

## ðŸ§ª TESTING & QA

### Testing Strategy

**Phase 1 Testing Approach: Manual + Critical E2E Tests**

**Why This Approach:**
- Small codebase (<5k lines)
- Single developer
- MVP timeframe (2 weeks)
- Focus on user experience over coverage %

**Testing Pyramid for Phase 1:**
```
       /\
      /  \  E2E Tests (5-10 critical flows)
     /____\
    /      \ Integration Tests (minimal, API endpoints)
   /________\
  /          \ Unit Tests (utility functions only)
 /____________\
```

#### Unit Tests (Optional for Phase 1, Recommended for Phase 2)

**What to Test:**
- `supabase/functions/isbn-lookup/` (Edge Function) - API fallback logic
- `supabase/functions/pricing/` (Edge Function) - Price calculation functions
- Form validation functions
- Utility functions (date formatting, price formatting)

**Tools:**
- `deno test` for Edge Function logic (Deno runtime)
- Plain JS assertions / a lightweight runner for browser utility functions

**Skip in Phase 1:**
- Component testing (visual testing more valuable)
- 100% coverage (aim for 50% of critical code)

**Sample Test:**
```javascript
// supabase/functions/isbn-lookup/index.test.ts (Deno test)
import { lookupISBN } from './index.ts';

describe('ISBN Lookup', () => {
  it('should fallback to Google Books if ISBNdb fails', async () => {
    // Mock ISBNdb to return 404
    // Mock Google Books to return success
    const result = await lookupISBN('9780134093413');
    expect(result.source).toBe('google_books');
    expect(result.title).toBeDefined();
  });
});
```

---

#### Integration Tests (Minimal for Phase 1)

**What to Test:**
- Supabase Edge Functions respond correctly
- Database queries work with RLS policies
- Supabase auth flow
- File upload to Supabase Storage

**Tools:**
- Supabase CLI local dev stack (`supabase start`)
- `deno test` / `fetch` against locally-served Edge Functions

**Priority Tests:**
1. Create listing with valid data â†’ 200 OK
2. Create listing without auth â†’ 401 Unauthorized
3. Update another user's listing â†’ 403 Forbidden
4. Upload valid photo â†’ returns URL
5. Upload oversized photo â†’ error message

**Skip in Phase 1:**
- Payment integration tests (Phase 3)
- Email delivery tests (Phase 3)
- Complex multi-user scenarios

---

#### E2E Tests (CRITICAL for Phase 1)

**Goal: Ensure critical user flows work end-to-end**

**Tools:**
- Playwright (recommended) or Cypress
- Run on real dev/staging environment

**Critical Flows to Test:**
1. **User Signup Flow**
   - Navigate to /signup
   - Enter email + password
   - Submit form
   - Verify redirected to email confirmation page
   - Confirm email (manual for Phase 1)
   - Login successful

2. **Book Listing Flow**
   - Login as user
   - Navigate to /scan
   - Enter ISBN manually (9780134093413)
   - Wait for book data to populate
   - Select condition: "Very Good"
   - Accept AI price suggestion
   - Upload 3 photos
   - Submit listing
   - Verify listing appears in "My Shelf"

3. **Browse & Search Flow**
   - Navigate to homepage (browse listings)
   - Verify listings display
   - Use search bar: "Clean Code"
   - Verify filtered results
   - Click on a listing
   - Verify book detail page loads

4. **Edit Listing Flow**
   - Login as user
   - Navigate to "My Shelf"
   - Click "Edit" on a listing
   - Change price
   - Update description
   - Save changes
   - Verify changes reflected

5. **Delete Listing Flow**
   - Login as user
   - Navigate to "My Shelf"
   - Click "Delete" on a listing
   - Confirm deletion
   - Verify listing removed from "My Shelf"
   - Verify listing no longer appears in browse

**Sample Playwright Test:**
```typescript
// tests/e2e/listing-flow.spec.ts
import { test, expect } from '@playwright/test';

test('user can create a book listing', async ({ page }) => {
  // Login
  await page.goto('/login');
  await page.fill('input[name="email"]', 'test@example.com');
  await page.fill('input[name="password"]', 'password123');
  await page.click('button[type="submit"]');
  
  // Navigate to scanner
  await page.goto('/scan');
  
  // Enter ISBN
  await page.fill('input[name="isbn"]', '9780134093413');
  await page.click('button:has-text("Look up book")');
  
  // Wait for book data
  await expect(page.locator('h1')).toContainText('Clean Code');
  
  // Select condition
  await page.selectOption('select[name="condition"]', 'very_good');
  
  // Accept AI price
  await page.click('button:has-text("Use suggested price")');
  
  // Upload photos (mock for test)
  await page.setInputFiles('input[type="file"]', [
    'test-fixtures/book-cover.jpg',
    'test-fixtures/book-interior.jpg',
    'test-fixtures/book-spine.jpg'
  ]);
  
  // Submit listing
  await page.click('button:has-text("List Book")');
  
  // Verify success
  await expect(page).toHaveURL('/shelf');
  await expect(page.locator('text=Clean Code')).toBeVisible();
});
```

**Running E2E Tests:**
```bash
# Install Playwright
npm install --save-dev @playwright/test

# Run tests
npx playwright test

# Run with UI (see browser)
npx playwright test --ui

# Run specific test
npx playwright test listing-flow
```

---

#### Manual Testing Checklist (Required before launch)

**Devices to Test:**
- [ ] Desktop Chrome (primary)
- [ ] Desktop Safari
- [ ] Desktop Firefox
- [ ] iPhone Safari
- [ ] Android Chrome

**Critical User Flows (Test on ALL devices):**
- [ ] Signup + email verification
- [ ] Login + logout
- [ ] Scan/enter ISBN and create listing
- [ ] Upload photos (3-5)
- [ ] Edit existing listing
- [ ] Delete listing
- [ ] Browse all listings
- [ ] Search by title
- [ ] Search by author
- [ ] View book detail page
- [ ] Responsive layout on mobile (no horizontal scroll)

**Edge Cases to Test:**
- [ ] Invalid ISBN entered (should show error)
- [ ] ISBN not found in APIs (should allow manual entry)
- [ ] Upload photo >5MB (should reject)
- [ ] Upload non-image file (should reject)
- [ ] Create listing without auth (should redirect to login)
- [ ] Access another user's edit page (should deny)
- [ ] Submit listing with $0 price (should reject)
- [ ] Search with no results (should show "No books found")

**Performance Testing:**
- [ ] Page load <2 seconds on 4G connection
- [ ] Image upload <5 seconds per photo
- [ ] ISBN lookup <3 seconds
- [ ] Search results <500ms

**Accessibility Testing (Basic):**
- [ ] All buttons/links keyboard accessible
- [ ] Form labels present
- [ ] Alt text on images
- [ ] Color contrast passes WCAG AA
- [ ] No critical errors in Lighthouse audit

---

### Pre-Launch Checklist

**1 Week Before Launch:**
- [ ] Complete all E2E tests
- [ ] Manual test on 5 devices
- [ ] Security checklist completed (SECURITY_CHECKLIST.md)
- [ ] Error handling tested (ERROR_HANDLING_PATTERNS.md)
- [ ] Privacy policy + Terms of Service live on site
- [ ] Contact email set up (support@booksharez.com)
- [ ] Domain configured (booksharez.com or subdomain)
- [ ] SSL certificate verified
- [ ] Supabase production database created
- [ ] All environment variables set in hosting provider + Supabase dashboard
- [ ] Seed database with 20-30 test listings

**Launch Day:**
- [ ] Deploy to production
- [ ] Verify all pages load
- [ ] Create test account and list a book
- [ ] Share with first 10 users
- [ ] Monitor error logs (hosting provider dashboard)
- [ ] Check Supabase database health

**Post-Launch (Week 1):**
- [ ] Daily check of error logs
- [ ] Respond to user issues within 24 hours
- [ ] Monitor signup/listing metrics
- [ ] Fix critical bugs immediately
- [ ] Deploy hotfixes as needed
- [ ] Collect user feedback (email, Google Form)

---

## ðŸ“Š SUCCESS METRICS (Phase 1)

**User Acquisition:**
- Week 1: 50 users, 100 listings
- Week 2: 100 users, 250 listings
- Week 4: 250 users, 500 listings

**Engagement:**
- Average listings per user: 3+
- Listing creation time: <30 seconds (measured via analytics)
- Search-to-view rate: >20% (searches that lead to detail page views)

**Technical:**
- Uptime: >99%
- Page load time: <2 seconds
- Critical bug count: 0
- Error rate: <1% of requests

**Quality:**
- User-reported issues: <5% of users
- Listing photo quality: >90% pass (not blurry/dark)
- ISBN lookup success: >85%

---

## ðŸ“ NOTES & FUTURE WORK

**Phase 1 Limitations to Address Later:**
- No payment processing (manual coordination)
- No messaging system (use email for now)
- No reputation/ratings (track informally)
- No shipping integration (local pickup only)
- Basic moderation (founder only)

**Phase 2 Priorities:**
- User profiles and reputation
- In-app messaging
- Advanced search/filters
- Automated moderation tools
- .edu email verification

**Phase 3+ Priorities:**
- Stripe payment integration
- Shipping label generation
- Dispute resolution system
- SHAREZ credit system
- Multi-campus expansion

---

**This document is provisional. Update sections as you make decisions during development.**
