Gap Analysis: Current Site vs. PHASE_1_MVP_SPEC.md
What the current site already does
It's a polished front-end demo with zero persistence — everything lives in JavaScript variables and resets on page refresh:

Homepage with hero search bar, stats section (hardcoded fake numbers), featured books grid (6 hardcoded sample books), and "How It Works" section
Search that filters the in-memory sample books by title/author (client-side only)
Login modal that accepts any email/password combination — no real auth, no signup (it's an alert() placeholder), no logout, no session persistence
Sell modal with title, author, optional ISBN (free text), condition dropdown, price, description, and a single photo input (the file is silently discarded; a stock Unsplash image is used instead)
Dashboard with My Listings (working in-memory delete; Edit is an alert() placeholder) plus Purchases/Messages/Profile placeholder tabs
Buy Now flow showing a fake "purchase successful" confirmation
Solid responsive CSS and modal system — this is genuinely reusable
Gaps, ordered by priority
No backend / no persistence (foundation for everything). Supabase is not integrated at all — no database, no auth, no storage. All listings vanish on refresh. The spec's full schema (books, listings, listing_photos tables, indexes, RLS policies) needs to be created in Supabase before most other gaps can close.

No real authentication. Spec requires signup, login, logout, and protected listing routes. Currently: signup doesn't exist, login accepts anything without verification, there's no logout, and the "must be logged in to sell" check is a trivially bypassed client-side flag.

No ISBN lookup. Spec's core flow is "scan/enter ISBN → auto-fill book details" via ISBNdb with Google Books fallback (patterns fully specified in ERROR_HANDLING_PATTERNS.md). Currently ISBN is an ignored optional text field; the user types everything by hand. ⚠️ Architectural flag: SECURITY_CHECKLIST.md requires API keys never reach the client, and the docs assume Next.js server routes for this — which we don't have. With vanilla JS, the realistic option is Supabase Edge Functions as the server-side proxy for ISBNdb/Google Books/AI calls. This needs your sign-off before any API work.

Condition system mismatch (cheap fix, but blocks the schema). Site uses 5 grades (like-new, very-good, good, fair, poor); the spec mandates exactly 4 (like_new, very_good, good, acceptable) and the database CHECK constraint enforces them. Both the values and the hyphen/underscore format differ. Should be fixed before any data is stored.

Photo upload doesn't actually work. Spec: 3 minimum / 5 maximum photos, 5MB cap, JPG/PNG/WEBP only, stored in Supabase Storage bucket listing-photos/{listing_id}/. Current: one optional file input whose contents are thrown away.

No AI price suggestion. Spec: AI suggests a price from condition + market data, user can override; fallback algorithm (condition multipliers, $2 minimum, round to $0.50) is specified in ERROR_HANDLING_PATTERNS.md. Currently the user just types a price. Same server-side proxy dependency as gap 3.

No barcode scanner. Spec lists camera-based scanning plus manual ISBN entry. Nothing exists. (Manual entry in gap 3 can ship first; camera scanning can follow.)

Dashboard ("My Shelf") is mostly hollow. Missing per spec: working edit (price/condition/description), mark-as-sold toggle, and basic stats (total/active listings). Delete exists but only in memory.

Discovery features incomplete. Spec requires search by title/author/ISBN (ISBN isn't searched despite the placeholder text), filter by condition, and sort by newest / price low-high / price high-low. Only basic title/author matching exists.

No book detail page. Spec requires a full detail view: book info, condition + description, photo gallery, seller username, and a visual-only Buy Now button. Currently clicking a card does nothing; Buy Now lives on the grid card.

Input validation gaps. Per spec and SECURITY_CHECKLIST: 500-char description limit (unenforced), ISBN format validation (10/13 digits), price max $9999.99, file validation. Also worth flagging: book cards are built with innerHTML using unescaped user input (title/author) — an XSS hole once real user data flows in.

Out-of-scope features that should be neutered, not built. The current site over-implements in places the spec defers: a fake working purchase flow (Phase 1 says Buy Now is visual only), Messages/Purchases tabs (Phase 3+), and fabricated stats. These need to be visually toned down or labeled, not extended.

Housekeeping observations (not spec gaps)
css/style_B.css is a byte-identical duplicate of css/style.css and isn't linked from the HTML — candidate for deletion when you're ready.
js/main.js injects some CSS at runtime (#bookCardStyles, #listingCardStyles) instead of using the stylesheet — fine for now, just something to know.
The docs' code samples are TypeScript/Next.js; since we're staying vanilla JS, I'll treat them as patterns to translate, not code to copy.
