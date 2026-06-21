let isLoggedIn = false;
let currentUser = null;
let currentUserId = null;

// Phase 2 state
let myShelfHave = [];
let myShelfWant = [];
let currentListingShelfEntryId = null;
let currentProfileUserId = null;
let currentProfileIsFollowed = false;

// Initialize the app
document.addEventListener("DOMContentLoaded", function () {
  loadHomepageSections();
  loadCommunityStats();
  setupEventListeners();
  initAuth();
});

async function loadCommunityStats() {
  const [listingsRes, membersRes, shelfRes, titlesRes] = await Promise.all([
    supabaseClient.from("listings").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabaseClient.from("profiles").select("*", { count: "exact", head: true }),
    supabaseClient.from("shelf_entries").select("*", { count: "exact", head: true }),
    supabaseClient.from("books").select("*", { count: "exact", head: true }),
  ]);
  const fmt = (n) => n != null ? n.toLocaleString() : "—";
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("statListings",     fmt(listingsRes.count));
  set("statMembers",      fmt(membersRes.count));
  set("statShelfEntries", fmt(shelfRes.count));
  set("statTitles",       fmt(titlesRes.count));
}

// Setup event listeners
function setupEventListeners() {
  // Login form
  document.getElementById("loginForm").addEventListener("submit", handleLogin);

  // Signup form
  document
    .getElementById("signupForm")
    .addEventListener("submit", handleSignup);

  // Sell form
  document
    .getElementById("sellForm")
    .addEventListener("submit", handleSellBook);

  // Add to shelf form
  document
    .getElementById("addToShelfForm")
    .addEventListener("submit", handleAddToShelf);

  // Profile settings form
  document
    .getElementById("profileSettingsForm")
    .addEventListener("submit", handleSaveProfile);

  // Search functionality
  document
    .getElementById("searchInput")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        searchBooks();
      }
    });

  // Close modals when clicking outside
  window.addEventListener("click", function (e) {
    if (e.target.classList.contains("modal")) {
      e.target.style.display = "none";
    }
  });

  // Enter key on book search inputs
  document.getElementById("shelfSearchQuery").addEventListener("keypress", (e) => {
    if (e.key === "Enter") { e.preventDefault(); searchShelfBooks(); }
  });
  document.getElementById("sellSearchQuery").addEventListener("keypress", (e) => {
    if (e.key === "Enter") { e.preventDefault(); searchSellBooks(); }
  });
}

// Load featured books
// --- Buyer-side browse/search (Supabase-backed, Phase 1) --------------------
// Reads ACTIVE listings joined to their book from Supabase (local DB only,
// never external sources) — see docs/SEARCH_SYSTEMS.md §2.

let myListings = []; // the logged-in user's own listings (My Shelf)
let pendingCover = { isbn: null, url: null }; // cover from the last ISBN lookup
let currentDetailId = null; // listing id shown on the book detail page

// Search results pagination
const SEARCH_PAGE_SIZE = 9;
let allSearchResults = []; // full merged result set (local + external)
let searchResultsLoaded = 0; // how many cards are currently rendered

// Vanilla JS has no auto-escaping; escape user text before putting it in HTML.
function escapeHTML(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}


// ─── Book object contract §6A ──────────────────────────────────────────────────
// One normalizer, one renderer. See docs/BOOKSHAREZ_ARCHITECTURE.md §6A.

const FALLBACK_COVER = "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=600&fit=crop";

// Accepts a listings row (with books join), a plain books row, or an external
// API result and returns the canonical Book shape.
function normalizeBook(raw) {
  const b = raw.books || raw;
  return {
    bookId: b.id || null,
    isbn:   b.isbn      || raw.isbn  || null,
    title:  b.title     || raw.title || "",
    author: b.author    || raw.author || "",
    coverUrl: b.cover_url || b.cover || raw.cover_url || raw.cover || raw.image || null,
    year:   b.year || raw.year || null,
  };
}

// Returns a DOM element (tile/thumb) or populates the fixed detail DOM (full).
function renderBook(book, context, density) {
  if (density === "thumb") return _renderThumb(book, context);
  if (density === "full")  { _renderFull(book, context); return null; }
  return _renderTile(book, context);
}

function _renderTile(book, context) {
  _ensureBookCardStyles();
  const card = document.createElement("div");
  card.className = "book-card";

  if (context.myListingId) {
    card.onclick = () => viewListing(context.myListingId);
  } else if (book.bookId) {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => browseBookById(book.bookId, book.title));
  } else {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => viewExternalBook(book));
  }

  let badgeHtml = "";
  if (context.condition) {
    badgeHtml = `<div class="book-condition">${formatCondition(context.condition)}</div>`;
  } else if (context.isListedLocally === false) {
    badgeHtml = `<div class="book-condition" style="background:rgba(108,117,125,0.85);">Not listed locally</div>`;
  }

  let footerHtml = "";
  if (context.price != null) {
    const priceLabel = `$${Number(context.price).toFixed(2)}`;
    footerHtml = `
      <div class="book-footer">
        <span class="book-price">${priceLabel}</span>
        <button class="btn btn-primary btn-small" data-action="buy">
          <i class="fas fa-cart-plus"></i> Buy Now
        </button>
      </div>`;
  } else if (context.isListedLocally === false) {
    footerHtml = `
      <div class="book-footer" style="margin-bottom:0.5rem;">
        <span class="book-price" style="font-size:1rem;color:#667eea;">Be the first to list this!</span>
      </div>`;
  }

  let sellerHtml = "";
  if (context.myListingId) {
    sellerHtml = `<p class="book-seller"><i class="fas fa-check-circle" style="color:#28a745;"></i> Available from a BookSharez seller</p>`;
  }

  const yearSpan = (context.isListedLocally === false && book.year)
    ? ` <span style="color:#aaa;font-size:0.85em;">(${escapeHTML(book.year)})</span>`
    : "";

  card.innerHTML = `
    <div class="book-image">
      <img src="${escapeHTML(book.coverUrl || "")}" alt="${escapeHTML(book.title)}"
        onerror="this.src='${FALLBACK_COVER}'">
      ${badgeHtml}
    </div>
    <div class="book-info">
      <h3 class="book-title">${escapeHTML(book.title)}</h3>
      <p class="book-author">by <span class="author-link">${escapeHTML(book.author || "")}</span>${yearSpan}</p>
      ${footerHtml}
      ${sellerHtml}
    </div>
  `;

  if (book.author) {
    const span = card.querySelector(".author-link");
    if (span) span.addEventListener("click", (e) => { e.stopPropagation(); searchByAuthor(book.author); });
  }
  if (context.myListingId && context.price != null) {
    const btn = card.querySelector("[data-action='buy']");
    if (btn) btn.addEventListener("click", (e) => {
      e.stopPropagation();
      buyBook(context.myListingId, context.price, book.title);
    });
  }

  return card;
}

function _renderThumb(book, context) {
  const item = document.createElement("div");
  item.style.cssText = "text-align:center;width:90px;cursor:pointer;";
  item.title = book.title || "";

  const imgWrapper = document.createElement("div");
  imgWrapper.style.cssText = "position:relative;width:80px;height:110px;margin:0 auto;";

  const img = document.createElement("img");
  img.src = book.coverUrl || "";
  img.alt = book.title || "";
  img.style.cssText =
    "width:80px;height:110px;object-fit:contain;background:#f5f5f5;" +
    "border-radius:8px;box-shadow:0 3px 8px rgba(0,0,0,0.12);display:block;";
  img.onerror = () => { img.src = FALLBACK_COVER; };
  imgWrapper.appendChild(img);

  if (context.isForSale) {
    const badge = document.createElement("div");
    badge.textContent = "For Sale";
    badge.style.cssText =
      "position:absolute;top:4px;right:4px;background:rgba(102,126,234,0.92);" +
      "color:#fff;font-size:0.6rem;font-weight:700;padding:2px 5px;" +
      "border-radius:4px;line-height:1.3;white-space:nowrap;";
    imgWrapper.appendChild(badge);
  }

  const titleEl = document.createElement("p");
  titleEl.style.cssText =
    "font-size:0.75rem;margin:0.4rem 0 0;color:#333;overflow:hidden;" +
    "text-overflow:ellipsis;white-space:nowrap;max-width:90px;";
  titleEl.textContent = book.title || "";

  item.appendChild(imgWrapper);
  item.appendChild(titleEl);
  if (book.bookId) {
    item.addEventListener("click", () => browseBookById(book.bookId, book.title));
  }
  return item;
}

function _renderFull(book, context) {
  const cover = document.getElementById("detailCover");
  cover.src = book.coverUrl || FALLBACK_COVER;
  cover.onerror = () => { cover.src = FALLBACK_COVER; };

  document.getElementById("detailTitle").textContent = book.title || "Untitled";

  const authorEl = document.getElementById("detailAuthor");
  authorEl.textContent = "";
  if (book.author) {
    authorEl.appendChild(document.createTextNode("by "));
    const span = document.createElement("span");
    span.className = "author-link";
    span.textContent = book.author;
    span.addEventListener("click", () => searchByAuthor(book.author));
    authorEl.appendChild(span);
  }

  document.getElementById("detailIsbn").textContent = book.isbn ? "ISBN: " + book.isbn : "";
  document.getElementById("detailCondition").textContent = formatCondition(context.condition || "");
  document.getElementById("detailPrice").textContent =
    context.price != null ? "$" + Number(context.price).toFixed(2) : "";
  document.getElementById("detailDescription").textContent =
    context.description || "No description provided.";

  const wantEl = document.getElementById("detailWantCount");
  if (wantEl) wantEl.textContent = "";

  const buyBtn = document.getElementById("detailBuyBtn");
  buyBtn.style.display = "inline-flex";
  buyBtn.onclick = () => buyBook(context.myListingId, context.price, book.title);

  // Listing path: hide the book-page sections (community offers + Add to Shelf
  // + affiliates) and restore the discussion section (the book page hides it).
  const offers = document.getElementById("detailOffers");
  if (offers) offers.style.display = "none";
  const externalActions = document.getElementById("detailExternalActions");
  if (externalActions) externalActions.style.display = "none";
  const discussion = document.getElementById("detailDiscussion");
  if (discussion) discussion.style.display = "";
}

function _ensureBookCardStyles() {
  if (document.querySelector("#bookCardStyles")) return;
  const style = document.createElement("style");
  style.id = "bookCardStyles";
  style.textContent = `
    .book-card { background:white; border-radius:15px; overflow:hidden; box-shadow:0 5px 20px rgba(0,0,0,0.1); transition:transform 0.3s ease,box-shadow 0.3s ease; cursor:pointer; }
    .book-card:hover { transform:translateY(-5px); box-shadow:0 10px 30px rgba(0,0,0,0.15); }
    .book-image { position:relative; height:288px; overflow:hidden; }
    .book-image img { width:100%; height:100%; object-fit:contain; background:#f5f5f5; }
    .book-condition { position:absolute; top:10px; right:10px; background:rgba(102,126,234,0.9); color:white; padding:0.25rem 0.5rem; border-radius:12px; font-size:0.8rem; font-weight:500; }
    .book-info { padding:1.5rem; }
    .book-title { font-size:1.2rem; margin-bottom:0.5rem; color:#333; font-weight:600; }
    .book-author { color:#666; margin-bottom:1rem; font-style:italic; }
    .book-footer { display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem; }
    .book-price { font-size:1.4rem; font-weight:bold; color:#667eea; }
    .btn-small { padding:0.5rem 1rem; font-size:0.9rem; }
    .book-seller { color:#888; font-size:0.9rem; margin-top:0.5rem; }
  `;
  document.head.appendChild(style);
}

// ─── end §6A contract ──────────────────────────────────────────────────────────

function showGridMessage(message) {
  document.getElementById("booksGrid").innerHTML =
    '<p style="text-align:center;grid-column:1/-1;color:#666;">' +
    escapeHTML(message) +
    "</p>";
}

function renderListings(rows) {
  const booksGrid = document.getElementById("booksGrid");
  if (!rows || rows.length === 0) { showGridMessage("No books found."); return; }
  booksGrid.innerHTML = "";
  rows.forEach(row => {
    const book = normalizeBook(row);
    const context = { myListingId: row.id, price: row.price, condition: row.condition, isListedLocally: true };
    booksGrid.appendChild(renderBook(book, context, "tile"));
  });
}

// Read the current browse controls (condition filter + sort).
function currentCondition() {
  const el = document.getElementById("conditionFilter");
  return el ? el.value : "all";
}
function currentSort() {
  const el = document.getElementById("sortSelect");
  return el ? el.value : "newest";
}

// Base query: active listings joined to their book, with the condition filter
// applied. Sort is added separately via applySort() (so search can compose it).
function baseListingsQuery() {
  let query = supabaseClient
    .from("listings")
    .select(
      "id, price, condition, created_at, books!inner(title, author, cover_url, isbn)"
    )
    .eq("status", "active");
  const condition = currentCondition();
  if (condition !== "all") query = query.eq("condition", condition);
  return query;
}

function applySort(query, sort) {
  if (sort === "price_asc") return query.order("price", { ascending: true });
  if (sort === "price_desc") return query.order("price", { ascending: false });
  return query.order("created_at", { ascending: false }); // newest (default)
}

// Re-run whichever view is active (browse or search) when a control changes.
function applyControls() {
  const term = document.getElementById("searchInput").value.trim();
  if (term) {
    searchBooks();
  } else {
    loadHomepageSections();
  }
}

// Show or hide the community want/have sections (hidden during search).
function setCommunityShelvesVisible(visible) {
  const display = visible ? "" : "none";
  const want = document.getElementById("communityWantSection");
  const have = document.getElementById("communityHaveSection");
  if (want) want.style.display = display;
  if (have) have.style.display = display;
}

// Load active listings into the homepage grid.
async function loadFeaturedBooks() {
  const sectionTitle = document.getElementById("featuredTitle");
  if (sectionTitle) sectionTitle.textContent = "Books Our Members Are Selling";
  const sub = document.querySelector(".search-subtitle");
  if (sub) sub.remove();
  showGridMessage("Loading books…");
  setViewMoreBtn(false);
  setCommunityShelvesVisible(true);

  const { data, error } = await applySort(
    baseListingsQuery(),
    currentSort()
  ).limit(24);
  if (error) {
    console.error("Failed to load listings:", error);
    showGridMessage("Couldn't load books. Please try again.");
    return;
  }
  renderListings(data);
}

// Load a community shelf section (want or have) with deduplicated books.
async function loadCommunityShelfSection(shelfType, gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = '<p style="text-align:center;grid-column:1/-1;color:#888;">Loading…</p>';

  const { data, error } = await supabaseClient
    .from("shelf_entries")
    .select("book_id, books!inner(id, title, author, cover_url)")
    .eq("shelf_type", shelfType)
    .order("added_at", { ascending: false })
    .limit(54);

  if (error || !data || data.length === 0) {
    grid.innerHTML = '<p style="text-align:center;grid-column:1/-1;color:#888;">None yet — be the first!</p>';
    return;
  }

  const seen = new Set();
  const unique = [];
  for (const entry of data) {
    if (!seen.has(entry.book_id)) {
      seen.add(entry.book_id);
      unique.push(entry.books);
      if (unique.length >= 9) break;
    }
  }

  grid.innerHTML = "";
  unique.forEach((bookRow) => {
    grid.appendChild(renderBook(normalizeBook(bookRow), {}, "tile"));
  });
}

// Load all three homepage sections.
function loadHomepageSections() {
  loadFeaturedBooks();
  loadCommunityShelfSection("want", "communityWantGrid");
  loadCommunityShelfSection("have", "communityHaveGrid");
}

// Format condition for display
function formatCondition(condition) {
  const conditions = {
    like_new: "Like New",
    very_good: "Very Good",
    good: "Good",
    fair: "Fair",
    poor: "Poor",
  };
  return conditions[condition] || condition;
}

// Search: queries local DB listings AND Google Books in parallel.
// Local results (BookSharez sellers) appear first and are highlighted;
// API results fill the remainder. Results are paginated 6 at a time.
async function searchBooks() {
  const searchTerm = document.getElementById("searchInput").value.trim();
  const sectionTitle = document.getElementById("featuredTitle");

  if (!searchTerm) {
    loadHomepageSections();
    return;
  }

  setCommunityShelvesVisible(false);
  if (sectionTitle) sectionTitle.textContent = `Results for "${searchTerm}"`;
  showGridMessage("Searching…");
  setViewMoreBtn(false);

  // Run both in parallel; API failure is non-fatal.
  let apiBooks = [];
  let apiOk = true;
  const [localData] = await Promise.all([
    searchLocalListings(searchTerm),
    searchBooksAPI(searchTerm)
      .then((r) => { apiBooks = r; })
      .catch((e) => { console.error("Google Books search failed:", e); apiOk = false; }),
  ]);

  // Local results first.
  const localPairs = (localData || []).map(row => ({
    book: normalizeBook(row),
    context: { myListingId: row.id, price: row.price, condition: row.condition, isListedLocally: true },
  }));

  // External: only books not already represented by a local listing.
  const localISBNs = new Set(localPairs.map(({ book }) => book.isbn).filter(Boolean));
  const externalPairs = apiBooks
    .filter(b => !localISBNs.has(b.isbn))
    .map(b => ({ book: normalizeBook(b), context: { isListedLocally: false } }));

  allSearchResults = [...localPairs, ...externalPairs];
  searchResultsLoaded = 0;

  // Update the section title with a source breakdown.
  const subtitle = localPairs.length > 0
    ? `${localPairs.length} on BookSharez · ${externalPairs.length} online`
    : externalPairs.length > 0
      ? `${externalPairs.length} results online`
      : "";
  const apiNote = !apiOk ? " (online sources unavailable)" : "";
  if (sectionTitle) {
    sectionTitle.textContent = `Results for "${searchTerm}"`;
    sectionTitle.nextElementSibling &&
    sectionTitle.nextElementSibling.classList.contains("search-subtitle")
      ? (sectionTitle.nextElementSibling.textContent = subtitle + apiNote)
      : (() => {
          const sub = document.createElement("p");
          sub.className = "search-subtitle";
          sub.style.cssText = "color:#888;font-size:0.9rem;margin:-0.75rem 0 1rem;";
          sub.textContent = subtitle + apiNote;
          sectionTitle.insertAdjacentElement("afterend", sub);
        })();
  }

  const grid = document.getElementById("booksGrid");
  grid.innerHTML = "";

  if (allSearchResults.length === 0) {
    showGridMessage("No books found.");
    return;
  }

  showNextSearchResults();

  const resultsSection = document.querySelector(".featured");
  if (resultsSection) {
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// Query local DB for active listings matching title or author.
async function searchLocalListings(term) {
  const safe = term.replace(/[,()%*]/g, " ").trim();
  const pattern = `%${safe}%`;
  const { data } = await applySort(
    baseListingsQuery().or(`title.ilike.${pattern},author.ilike.${pattern}`, {
      referencedTable: "books",
    }),
    currentSort()
  ).limit(48);
  return data || [];
}

// Append the next page of search results to the grid.
function showNextSearchResults() {
  const grid = document.getElementById("booksGrid");
  const page = allSearchResults.slice(
    searchResultsLoaded,
    searchResultsLoaded + SEARCH_PAGE_SIZE
  );
  page.forEach(({ book, context }) => grid.appendChild(renderBook(book, context, "tile")));
  searchResultsLoaded += page.length;
  const remaining = allSearchResults.length - searchResultsLoaded;
  setViewMoreBtn(remaining > 0, remaining);
}

// Called by the "View more" button.
function showMoreSearchResults() {
  showNextSearchResults();
}

// Show or hide the "View more" button.
function setViewMoreBtn(show, remaining) {
  const btn = document.getElementById("viewMoreBtn");
  if (!btn) return;
  btn.style.display = show ? "inline-flex" : "none";
  if (show) btn.textContent = `View ${Math.min(remaining, SEARCH_PAGE_SIZE)} more`;
}

// When a user clicks an external (not-yet-listed) book card, open the add-to-shelf
// modal pre-filled so they can add it to their shelf or list it for sale.
function openExternalBookOptions(book) {
  if (!isLoggedIn) { showLogin(); return; }
  const modal = document.getElementById("addToShelfModal");
  document.getElementById("shelfType").value = "have";
  document.getElementById("shelfISBN").value = book.isbn || "";
  document.getElementById("shelfTitle").value = book.title || "";
  document.getElementById("shelfAuthor").value = book.author || "";
  document.getElementById("shelfIsbnStatus").textContent = book.isbn ? "ISBN filled from search ✓" : "";
  document.getElementById("shelfSearchQuery").value = book.title || "";
  document.getElementById("shelfSearchStatus").textContent = `"${escapeHTML(book.title)}" selected ✓`;
  document.getElementById("shelfSearchResults").style.display = "none";
  pendingCover = { isbn: book.isbn || null, url: book.coverUrl || null };
  modal.style.display = "block";
}

// Open the rich book detail page for a book with no local listing yet (an
// external search result). Reuses the bookDetail page, hides the listing-only
// sections, and offers "Add to Shelf" + affiliate buy links. A click on a book
// always means "tell me more about this book" — never the add-to-shelf modal.
// Thin wrapper: open the book page for an external search result (no catalog
// id known yet; community offers are looked up by ISBN during enrichment).
function viewExternalBook(book) {
  _renderBookPage(book, []);
}

// The unified, book-centric detail page (architecture §5.4). Shows book
// metadata, community seller offers (primary), affiliate offers (secondary),
// the community want-count (social proof), and discussion — never a dead end.
// `book` is a normalized Book; `offers` is an array of active listing rows
// (with their books join) already fetched for this book.
function _renderBookPage(book, offers) {
  ensureDetailStyles();

  document.getElementById("homepage").style.display = "none";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("bookDetail").style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Synthetic page token so async enrichment can tell if the user navigated
  // away before it resolved. (viewListing uses the real listing id instead.)
  const token = "book:" + (book.bookId || book.isbn || Date.now());
  currentDetailId = token;

  const cover = document.getElementById("detailCover");
  cover.src = book.coverUrl || FALLBACK_COVER;
  cover.onerror = () => { cover.src = FALLBACK_COVER; };
  document.getElementById("detailTitle").textContent = book.title || "Untitled";

  const authorEl = document.getElementById("detailAuthor");
  authorEl.textContent = "";
  if (book.author) {
    authorEl.appendChild(document.createTextNode("by "));
    const span = document.createElement("span");
    span.className = "author-link";
    span.textContent = book.author;
    span.addEventListener("click", () => searchByAuthor(book.author));
    authorEl.appendChild(span);
  }

  document.getElementById("detailIsbn").textContent = book.isbn ? "ISBN: " + book.isbn : "";
  document.getElementById("detailDescription").textContent =
    book.year ? `First published ${book.year}.` : "";

  // Hide the single-listing elements — this is a book page, not one offer.
  document.getElementById("detailCondition").textContent = "";
  document.getElementById("detailPrice").textContent = "";
  document.getElementById("detailSeller").textContent = "";
  document.getElementById("detailWantCount").textContent = "";
  document.getElementById("detailGallery").innerHTML = "";
  document.getElementById("detailBuyBtn").style.display = "none";
  document.getElementById("detailDiscussion").style.display = "none";

  // Community offers (primary). Each tile routes to its listing via renderBook.
  renderBookOffers(offers);

  // Add to Shelf + affiliate buy links (secondary).
  document.getElementById("detailExternalActions").style.display = "block";
  document.getElementById("detailAddShelfBtn").onclick = () => openExternalBookOptions(book);
  renderAffiliateLinks(book);

  // Community want-count + discussion. Use the known catalog id directly, or
  // look it up by ISBN for external books not yet matched to the catalog.
  if (book.bookId) _loadBookSocial(book.bookId, token);
  else enrichExternalBook(book, token);
}

// Render community seller offers into the book page as renderBook tiles
// (§6A contract — never hand-build cards). Each tile links to its listing.
function renderBookOffers(offers) {
  const section = document.getElementById("detailOffers");
  const grid = document.getElementById("detailOffersGrid");
  grid.innerHTML = "";
  if (!offers || offers.length === 0) { section.style.display = "none"; return; }
  offers.forEach((row) => {
    const offerBook = normalizeBook(row);
    const context = { myListingId: row.id, price: row.price, condition: row.condition, isListedLocally: true };
    grid.appendChild(renderBook(offerBook, context, "tile"));
  });
  section.style.display = "block";
}

// For an external book with no catalog id, match it to the `books` catalog by
// ISBN, then load its social data. Guards on the page token throughout.
async function enrichExternalBook(book, token) {
  if (!book.isbn) return;
  const { data: catalogBook } = await supabaseClient
    .from("books")
    .select("id")
    .eq("isbn", book.isbn)
    .maybeSingle();
  if (currentDetailId !== token || !catalogBook) return; // navigated away, or not in catalog
  _loadBookSocial(catalogBook.id, token);
}

// Populate the book page's want-count and discussion for a known catalog book.
// Guards on the page token so a fast navigate-away can't populate a stale page.
function _loadBookSocial(bookId, token) {
  const wantEl = document.getElementById("detailWantCount");
  supabaseClient
    .from("shelf_entries")
    .select("*", { count: "exact", head: true })
    .eq("book_id", bookId)
    .eq("shelf_type", "want")
    .then(({ count }) => {
      if (currentDetailId !== token || !wantEl || !count) return;
      const label = count === 1 ? "person wants" : "people want";
      wantEl.innerHTML = `<i class="fas fa-heart"></i> ${count} ${label} this book`;
    });

  document.getElementById("detailDiscussion").style.display = "";
  loadDiscussion(bookId, token);
}

// Build "Buy on …" affiliate links for an external book — search URLs keyed on
// ISBN (title fallback). No API keys; affiliate tags can be appended later.
function renderAffiliateLinks(book) {
  const container = document.getElementById("detailAffiliates");
  container.innerHTML = "";
  const isbn = book.isbn || "";
  const titleQuery = encodeURIComponent(book.title || "");
  const links = [
    {
      label: "Buy on Amazon",
      url: `https://www.amazon.com/s?k=${isbn ? encodeURIComponent(isbn) : titleQuery}`,
    },
    {
      label: "Buy on AbeBooks",
      url: isbn
        ? `https://www.abebooks.com/servlet/SearchResults?isbn=${encodeURIComponent(isbn)}`
        : `https://www.abebooks.com/servlet/SearchResults?kn=${titleQuery}`,
    },
  ];
  links.forEach(({ label, url }) => {
    const a = document.createElement("a");
    a.className = "affiliate-link";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = `<i class="fas fa-external-link-alt"></i> ${escapeHTML(label)}`;
    container.appendChild(a);
  });
}

// Show buy books page
function showBuyBooks() {
  document.getElementById("homepage").style.display = "block";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.querySelector(".hero").scrollIntoView({ behavior: "smooth" });
}

function showHomePage() { showBuyBooks(); }

// Show login modal
function showLogin() {
  closeModal("signupModal");
  clearAuthMessage("loginMessage");
  document.getElementById("loginModal").style.display = "block";
}

// Show signup modal
function showSignup() {
  closeModal("loginModal");
  clearAuthMessage("signupMessage");
  document.getElementById("signupModal").style.display = "block";
}

// Show sell modal — selling flows through the shelf (Phase 2 architecture).
// "Sell Books" opens "Add to Books I Have"; from there the user taps
// "List for Sale" on a shelf item to open the actual listing form.
function showSellModal() {
  if (!isLoggedIn) {
    alert("Please login first to sell books");
    showLogin();
    return;
  }
  showAddToShelfModal("have");
}

// ---------------------------------------------------------------------------
// Authentication (Supabase)
// ---------------------------------------------------------------------------

// Initialise auth: react to the current session and any future changes.
function initAuth() {
  // Fires once with the restored session (INITIAL_SESSION event) and again on
  // every sign in / sign out, so a page refresh keeps the user logged in.
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    applyAuthState(session);
  });
}

// Sync global state + header UI to the current session (null when logged out).
function applyAuthState(session) {
  const loginBtn = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  if (session && session.user) {
    isLoggedIn = true;
    currentUser = session.user.email;
    currentUserId = session.user.id;
    loginBtn.innerHTML = '<i class="fas fa-user-circle"></i> Dashboard';
    loginBtn.onclick = showDashboard;
    logoutBtn.style.display = "inline-flex";
  } else {
    isLoggedIn = false;
    currentUser = null;
    currentUserId = null;
    loginBtn.innerHTML = '<i class="fas fa-user"></i> Login';
    loginBtn.onclick = showLogin;
    logoutBtn.style.display = "none";
    // If the user was viewing the dashboard or profile, send them back to homepage.
    document.getElementById("homepage").style.display = "block";
    document.getElementById("dashboard").style.display = "none";
    document.getElementById("profilePage").style.display = "none";
  }
}

// Handle login form submission.
async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    showAuthMessage("loginMessage", mapAuthError(error), "error");
    return;
  }

  // onAuthStateChange updates the UI; just close the modal and reset the form.
  closeModal("loginModal");
  e.target.reset();
}

// Handle signup form submission.
async function handleSignup(e) {
  e.preventDefault();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const confirm = document.getElementById("signupPasswordConfirm").value;

  if (password.length < 8) {
    showAuthMessage(
      "signupMessage",
      "Password must be at least 8 characters.",
      "error"
    );
    return;
  }
  if (password !== confirm) {
    showAuthMessage("signupMessage", "Passwords do not match.", "error");
    return;
  }

  const { data, error } = await supabaseClient.auth.signUp({ email, password });

  if (error) {
    showAuthMessage("signupMessage", mapAuthError(error), "error");
    return;
  }

  // With email confirmation OFF, signUp returns an active session and
  // onAuthStateChange logs the user in. If confirmation is later turned on,
  // there is no session yet, so prompt the user to check their email.
  if (data.session) {
    closeModal("signupModal");
    e.target.reset();
  } else {
    showAuthMessage(
      "signupMessage",
      "Account created. Please check your email to confirm before logging in.",
      "success"
    );
    e.target.reset();
  }
}

// Handle logout. onAuthStateChange resets the UI to the logged-out state.
async function handleLogout() {
  await supabaseClient.auth.signOut();
}

// Map Supabase auth errors to friendly messages (never expose internals).
function mapAuthError(error) {
  const msg = error && error.message ? error.message.toLowerCase() : "";
  if (msg.includes("invalid login")) {
    return "Incorrect email or password.";
  }
  if (msg.includes("already registered")) {
    return "Email already registered. Try logging in instead.";
  }
  if (msg.includes("password")) {
    return "Password must be at least 8 characters.";
  }
  if (msg.includes("email")) {
    return "Please enter a valid email address.";
  }
  return "Something went wrong. Please try again.";
}

// Show an inline message inside a modal (type: "error" | "success").
function showAuthMessage(elId, text, type) {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.className = "form-message " + type;
}

// Clear an inline modal message.
function clearAuthMessage(elId) {
  const el = document.getElementById(elId);
  el.textContent = "";
  el.className = "form-message";
}

// Show dashboard — defaults to Books I Have tab
function showDashboard() {
  if (!isLoggedIn) {
    showLogin();
    return;
  }
  document.getElementById("homepage").style.display = "none";
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  activateDashboardTab("shelf-have");
  loadShelfHave();
}

function activateDashboardTab(tabName) {
  document.querySelectorAll('[id$="-tab"]').forEach((tab) => {
    tab.style.display = "none";
  });
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });
  document.getElementById(tabName + "-tab").style.display = "block";
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (btn) btn.classList.add("active");
}

function showDashboardTab(tabName) {
  activateDashboardTab(tabName);
  if (tabName === "shelf-have") loadShelfHave();
  else if (tabName === "shelf-want") loadShelfWant();
  else if (tabName === "listings") loadUserListings();
  else if (tabName === "profile") loadProfileSettings();
}

// Handle sell book form
// ISBN auto-fill: calls the isbn-lookup Edge Function (cache → ISBNdb →
// Google Books, all server-side; keys never reach the browser). Falls back to
// the old client-side pipeline only if the function itself is unreachable.
function setLookupStatus(message) {
  const el = document.getElementById("isbnLookupStatus");
  if (el) el.textContent = message;
}

function setPriceSuggestStatus(message) {
  const el = document.getElementById("priceSuggestStatus");
  if (el) el.textContent = message;
}

// AI price suggestion: calls the `pricing` Edge Function (holds the DeepSeek
// key server-side), falling back to a simple condition-multiplier algorithm
// if the AI call fails for any reason. See docs/ERROR_HANDLING_PATTERNS.md
// "AI Pricing Errors" — this mirrors that pattern.
async function estimatePrice(bookData, condition) {
  try {
    const { data, error } = await supabaseClient.functions.invoke("pricing", {
      body: { bookData, condition },
    });
    if (error) throw new Error(`Pricing function error: ${error.message}`);

    const { price, confidence } = data;
    if (!(price >= 0.5 && price <= 1000)) {
      throw new Error("Invalid price estimate");
    }
    return { price, confidence, source: "ai" };
  } catch (err) {
    console.error("AI pricing failed:", err);
    return { ...fallbackPricing(bookData, condition), source: "fallback" };
  }
}

function fallbackPricing(bookData, condition) {
  const basePrice = bookData.listPrice || 20; // no list-price source yet; default $20
  const multipliers = {
    like_new: 0.75,
    very_good: 0.55,
    good: 0.35,
    fair: 0.2,
    poor: 0.1,
  };
  const estimated = basePrice * (multipliers[condition] || 0.35);
  return {
    price: Math.max(2, Math.round(estimated * 2) / 2), // min $2, round to $0.50
    confidence: "low",
  };
}

// Wired to the sell form's "Suggest price" button.
async function suggestPrice() {
  const title = document.getElementById("bookTitle").value.trim();
  const author = document.getElementById("bookAuthor").value.trim();
  const isbn = document.getElementById("bookISBN").value.trim();
  const condition = document.getElementById("bookCondition").value;

  if (!title) {
    setPriceSuggestStatus("Enter a title (or look up the ISBN) first.");
    return;
  }
  if (!condition) {
    setPriceSuggestStatus("Select a condition first.");
    return;
  }

  setPriceSuggestStatus("Estimating price…");
  const { price, confidence, source } = await estimatePrice(
    { title, author, isbn },
    condition
  );

  document.getElementById("bookPrice").value = price.toFixed(2);
  setPriceSuggestStatus(
    source === "ai"
      ? `Suggested price: $${price.toFixed(2)} (based on condition and market data) — feel free to adjust.`
      : `Estimated price: $${price.toFixed(2)} (you can adjust this).`
  );
}

function fillBookFields(isbn, result) {
  document.getElementById("bookTitle").value = result.title || "";
  document.getElementById("bookAuthor").value = result.author || "";
  pendingCover = { isbn, url: result.cover || null };
  showSellCoverPreview(result.cover || null, result.title || "");
}

function hideSellCoverPreview() {
  const box = document.getElementById("sellCoverPreviewBox");
  if (box) box.style.display = "none";
}

// Show the found cover image + a note in the sell modal.
function showSellCoverPreview(coverUrl, title) {
  const box = document.getElementById("sellCoverPreviewBox");
  const img = document.getElementById("sellCoverPreview");
  const note = document.getElementById("sellCoverNote");
  if (!box) return;
  if (coverUrl) {
    img.src = coverUrl;
    img.style.display = "block";
    note.textContent =
      `Cover found for "${title}". Upload photos of your actual copy below so buyers can see its real condition.`;
  } else {
    img.style.display = "none";
    note.textContent =
      `No cover image found. Add photos of your copy so buyers know what they're getting.`;
  }
  box.style.display = "block";
}

// isbn-lookup Edge Function — primary lookup path. Returns the book if found,
// null if not found, or throws if the function itself is unreachable.
async function lookupViaEdgeFunction(isbn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  let data, error;
  try {
    ({ data, error } = await supabaseClient.functions.invoke("isbn-lookup", {
      body: { isbn },
      signal: controller.signal,
    }));
  } finally {
    clearTimeout(timer);
  }
  if (error) throw new Error(`isbn-lookup function error: ${error.message}`);
  if (!data.found) return null;
  const b = data.book;
  return { title: b.title || "", author: b.author || "", cover: b.coverUrl };
}

// Client-side fallback pipeline — used only if the Edge Function is unreachable.
// These are keyless/free sources, so calling them from the browser is fine.
async function lookupOpenLibrary(isbn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let res;
  try {
    res = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`,
      { signal: controller.signal }
    );
  } finally { clearTimeout(timer); }
  if (!res.ok) return null;
  const data = await res.json();
  const entry = data[`ISBN:${isbn}`];
  if (!entry) return null;
  return {
    title: entry.title || "",
    author: (entry.authors || []).map((a) => a.name).join(", "),
    cover:
      (entry.cover &&
        (entry.cover.medium || entry.cover.large || entry.cover.small)) ||
      null,
  };
}

async function lookupGoogleBooks(isbn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let res;
  try {
    res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&country=US`,
      { signal: controller.signal }
    );
  } finally { clearTimeout(timer); }
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.totalItems || !(data.items && data.items.length)) return null;
  const info = data.items[0].volumeInfo || {};
  const cover =
    info.imageLinks &&
    (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail);
  return {
    title: info.title || "",
    author: (info.authors || []).join(", "),
    cover: cover ? cover.replace(/^http:/, "https:") : null,
  };
}

async function lookupISBN() {
  const isbn = (document.getElementById("bookISBN").value || "").replace(
    /[\s-]/g,
    ""
  );
  if (!/^(\d{13}|\d{9}[\dXx])$/.test(isbn)) {
    setLookupStatus("Enter a valid ISBN (10 or 13 digits) first.");
    return;
  }

  setLookupStatus("Looking up…");

  // Primary: Edge Function (cache → ISBNdb → Google Books, server-side).
  try {
    const result = await lookupViaEdgeFunction(isbn);
    if (result && result.title) {
      fillBookFields(isbn, result);
      setLookupStatus("Details filled ✓ — add condition & price.");
      return;
    }
    if (result === null) {
      // function responded but book wasn't found in any source
      setLookupStatus("Not found — please type the details in.");
      return;
    }
  } catch (e) {
    console.error("isbn-lookup Edge Function unavailable, trying fallback:", e);
  }

  // Fallback: client-side Open Library → Google Books (keyless, browser-safe).
  const fallbacks = [
    { name: "Open Library", fn: lookupOpenLibrary },
    { name: "Google Books", fn: lookupGoogleBooks },
  ];
  for (const src of fallbacks) {
    try {
      const result = await src.fn(isbn);
      if (result && result.title) {
        fillBookFields(isbn, result);
        setLookupStatus(
          `Details filled from ${src.name} ✓ — add condition & price.`
        );
        return;
      }
    } catch (e) {
      console.error(src.name, "lookup error:", e);
    }
  }

  setLookupStatus("Not found — please type the details in.");
}

// Persist a new listing to Supabase (Step 2). Ensures the catalog book row
// exists (by ISBN), then inserts the listing under the logged-in user. Photos
// are a later step; the grid uses the book's cover (fallback image for now).
async function handleSellBook(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const title = (formData.get("bookTitle") || "").trim();
  const author = (formData.get("bookAuthor") || "").trim();
  const isbn = (formData.get("bookISBN") || "").replace(/[\s-]/g, "");
  const condition = formData.get("bookCondition");
  const price = parseFloat(formData.get("bookPrice"));
  const description = (formData.get("bookDescription") || "").trim();
  const photos = Array.from(formData.getAll("bookPhoto")).filter(
    (f) => f instanceof File && f.size > 0
  );

  // Validate (DB also enforces these via CHECK constraints).
  if (!/^(\d{13}|\d{9}[\dXx])$/.test(isbn)) {
    alert("Please enter a valid ISBN — 10 or 13 digits.");
    return;
  }
  if (!(price >= 0.01 && price <= 9999.99)) {
    alert("Please enter a price between $0.01 and $9999.99.");
    return;
  }
  if (description.length > 500) {
    alert("Description must be 500 characters or fewer.");
    return;
  }
  if (photos.length > 5) {
    alert("You can add up to 5 photos of your book.");
    return;
  }
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // matches the bucket's 5 MB cap
  const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
  if (photos.some((f) => !ALLOWED_TYPES.includes(f.type))) {
    alert("Photos must be JPEG, PNG, or WebP images.");
    return;
  }
  if (photos.some((f) => f.size > MAX_PHOTO_BYTES)) {
    alert("Each photo must be 5 MB or smaller.");
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const coverUrl = pendingCover.isbn === isbn ? pendingCover.url : null;
    const bookId = await ensureBook({ isbn, title, author, coverUrl });
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    const { data: listing, error } = await supabaseClient
      .from("listings")
      .insert({
        user_id: user.id,
        book_id: bookId,
        price,
        condition,
        description: description || null,
        status: "active",
        shelf_entry_id: currentListingShelfEntryId || null,
      })
      .select("id")
      .single();
    if (error) throw error;

    // Photos must be uploaded AFTER the listing exists: the Storage + table RLS
    // policies require the path's first folder to be a listing the user owns.
    const photoWarning = await uploadListingPhotos(listing.id, photos);

    closeModal("sellModal");
    e.target.reset();
    currentListingShelfEntryId = null;
    hideSellCoverPreview();
    alert(
      photoWarning
        ? "Book listed, but some photos didn't upload. You can edit the listing later."
        : "Book listed successfully!"
    );
    showBuyBooks(); // back to the homepage...
    loadHomepageSections(); // ...where the new listing now appears
  } catch (err) {
    console.error("Failed to list book:", err);
    alert("Sorry, something went wrong listing your book. Please try again.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

// Ensure a catalog book row exists for this ISBN; return its book_id. Reuses an
// existing row (so multiple sellers share one canonical book) and only inserts
// when the ISBN is new.
async function ensureBook({ isbn, title, author, coverUrl }) {
  const { data: existing, error: selErr } = await supabaseClient
    .from("books")
    .select("id")
    .eq("isbn", isbn)
    .maybeSingle();
  if (selErr) throw selErr;
  if (existing) return existing.id;

  const { data: created, error: insErr } = await supabaseClient
    .from("books")
    .insert({ isbn, title, author, cover_url: coverUrl || null })
    .select("id")
    .single();
  if (!insErr) return created.id;

  // Race: another insert won the UNIQUE(isbn) between our select and insert.
  if (insErr.code === "23505") {
    const { data: again } = await supabaseClient
      .from("books")
      .select("id")
      .eq("isbn", isbn)
      .maybeSingle();
    if (again) return again.id;
  }
  throw insErr;
}

// Upload listing photos to the private `listing-photos` bucket under
// `<listingId>/...` (the path the RLS policies key off), then record one
// listing_photos row per file. The listing already exists, so we never throw —
// we return true if anything failed so the caller can soften its message.
async function uploadListingPhotos(listingId, photos) {
  let hadFailure = false;

  for (let i = 0; i < photos.length; i++) {
    const file = photos[i];
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${listingId}/${i}-${Date.now()}.${ext}`;

    const { error: upErr } = await supabaseClient.storage
      .from("listing-photos")
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) {
      console.error("Photo upload failed:", upErr);
      hadFailure = true;
      continue;
    }

    // Store the storage PATH (bucket is private; reads use signed URLs).
    const { error: rowErr } = await supabaseClient
      .from("listing_photos")
      .insert({ listing_id: listingId, photo_url: path, display_order: i });
    if (rowErr) {
      console.error("Photo record insert failed:", rowErr);
      hadFailure = true;
    }
  }

  return hadFailure;
}

// Load user listings
// My Shelf: the logged-in user's own listings, read from Supabase (all
// statuses), with working edit/mark-sold/delete. (RLS lets a user see and
// modify only their own rows.)
async function loadUserListings() {
  const userListingsDiv = document.getElementById("userListings");
  userListingsDiv.innerHTML = "<p>Loading your listings…</p>";

  const {
    data: { user },
  } = await supabaseClient.auth.getUser();
  if (!user) {
    userListingsDiv.innerHTML = "<p>Please log in to see your listings.</p>";
    return;
  }

  const { data, error } = await supabaseClient
    .from("listings")
    .select("id, price, condition, status, description, books!inner(title, author, cover_url)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load your listings:", error);
    userListingsDiv.innerHTML =
      "<p>Couldn't load your listings. Please try again.</p>";
    return;
  }

  myListings = data || [];

  if (myListings.length === 0) {
    userListingsDiv.innerHTML =
      '<p>You haven\'t listed any books yet. <a href="#" onclick="showSellModal()">List your first book!</a></p>';
    return;
  }

  userListingsDiv.innerHTML = "";
  myListings.forEach((row) => {
    const book = row.books || {};
    const priceLabel = `$${Number(row.price).toFixed(2)}`;
    const isActive = row.status === "active";
    const listingCard = document.createElement("div");
    listingCard.className = "listing-card";
    listingCard.innerHTML = `
      <div class="listing-main">
        <img class="listing-cover" src="${escapeHTML(book.cover_url || "")}" alt="${escapeHTML(book.title)}"
          onerror="this.style.display='none'">
        <div class="listing-info">
          <h4>${escapeHTML(book.title)}</h4>
          <p>by ${escapeHTML(book.author)}</p>
          <p>Condition: ${formatCondition(row.condition)}</p>
          <p class="listing-price">${priceLabel}</p>
          <p>Status: ${escapeHTML(row.status)}</p>
        </div>
      </div>
      <div class="listing-actions">
        <button class="btn btn-secondary btn-small" onclick="editListing('${row.id}')">
          <i class="fas fa-edit"></i> Edit price
        </button>
        ${
          isActive
            ? `<button class="btn btn-secondary btn-small" onclick="markAsSold('${row.id}')">
          <i class="fas fa-check"></i> Mark sold
        </button>`
            : ""
        }
        <button class="btn btn-primary btn-small" onclick="deleteListing('${row.id}')">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    `;
    userListingsDiv.appendChild(listingCard);
  });

}

// Buy book functionality (Phase 1: visual only — no real payment; Stripe is Phase 3)
// Inject the detail-page CSS once, lazily (matches the #bookCardStyles pattern).
function ensureDetailStyles() {
  if (document.querySelector("#bookDetailStyles")) return;
  const style = document.createElement("style");
  style.id = "bookDetailStyles";
  style.textContent = `
    #bookDetail {
      padding: 2rem 0 4rem;
    }
    #bookDetail .container {
      max-width: 1000px;
    }
    .detail-layout {
      display: grid;
      grid-template-columns: 320px 1fr;
      gap: 2.5rem;
      margin-top: 1.5rem;
    }
    .detail-cover {
      position: relative;
    }
    .detail-cover img {
      width: 100%;
      border-radius: 15px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.15);
      object-fit: cover;
    }
    .detail-condition {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(102, 126, 234, 0.9);
      color: white;
      padding: 0.3rem 0.6rem;
      border-radius: 12px;
      font-size: 0.85rem;
      font-weight: 500;
    }
    .detail-title {
      font-size: 2rem;
      color: #333;
      margin-bottom: 0.5rem;
    }
    .detail-author {
      color: #666;
      font-style: italic;
      font-size: 1.1rem;
      margin-bottom: 0.5rem;
    }
    .detail-isbn {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    .detail-price {
      font-size: 2rem;
      font-weight: bold;
      color: #667eea;
      margin-bottom: 1.5rem;
    }
    .detail-description {
      color: #444;
      line-height: 1.6;
      margin-bottom: 1.5rem;
      white-space: pre-wrap;
    }
    .detail-seller {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 0.5rem;
    }
    .detail-want-count {
      color: #e74c3c;
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
    }
    .detail-gallery {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .detail-thumb {
      width: 110px;
      height: 110px;
      object-fit: cover;
      border-radius: 10px;
      box-shadow: 0 3px 10px rgba(0,0,0,0.12);
    }
    .detail-offers {
      margin: 1.5rem 0;
    }
    .detail-offers-heading {
      font-size: 1.1rem;
      color: #333;
      margin-bottom: 1rem;
    }
    .detail-offers-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1.25rem;
    }
    #detailAddShelfBtn {
      margin-bottom: 1rem;
    }
    .detail-affiliates {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .affiliate-link {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.6rem 1.1rem;
      border: 1px solid #667eea;
      border-radius: 8px;
      color: #667eea;
      font-weight: 600;
      font-size: 0.9rem;
      text-decoration: none;
      transition: background 0.2s ease, color 0.2s ease;
    }
    .affiliate-link:hover {
      background: #667eea;
      color: #fff;
    }
    @media (max-width: 700px) {
      .detail-layout {
        grid-template-columns: 1fr;
      }
      .detail-cover {
        max-width: 280px;
        margin: 0 auto;
      }
    }
    .detail-discussion {
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid #eee;
    }
    .discussion-heading {
      font-size: 1.3rem;
      color: #333;
      margin-bottom: 1.5rem;
    }
    .discussion-post {
      padding: 1rem 0;
      border-bottom: 1px solid #f0f0f0;
    }
    .discussion-post:last-child {
      border-bottom: none;
    }
    .discussion-post-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.4rem;
    }
    .discussion-username {
      font-weight: 600;
      color: #667eea;
      text-decoration: none;
      font-size: 0.9rem;
    }
    .discussion-username:hover { text-decoration: underline; }
    .discussion-time {
      color: #aaa;
      font-size: 0.8rem;
    }
    .discussion-delete {
      margin-left: auto;
      background: none;
      border: none;
      color: #ccc;
      cursor: pointer;
      font-size: 0.8rem;
      padding: 0;
    }
    .discussion-delete:hover { color: #e74c3c; }
    .discussion-post-body {
      color: #444;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .discussion-empty {
      color: #999;
      font-style: italic;
      text-align: center;
      padding: 1.5rem 0;
    }
    .discussion-compose {
      margin-top: 1.5rem;
    }
    .discussion-input {
      width: 100%;
      padding: 0.75rem;
      border: 1px solid #ddd;
      border-radius: 8px;
      font-size: 0.95rem;
      font-family: inherit;
      resize: vertical;
      box-sizing: border-box;
    }
    .discussion-input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 2px rgba(102,126,234,0.15);
    }
    .discussion-form-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 0.5rem;
    }
    .discussion-char-count { color: #aaa; font-size: 0.8rem; }
    .discussion-auth-prompt { color: #888; font-size: 0.9rem; margin-top: 1rem; }
    .discussion-login-link { color: #667eea; }
  `;
  document.head.appendChild(style);
}

// Book detail page: fetch the full listing by id and show it as a toggled
// "page" (same display-toggle approach as homepage/dashboard; no routing).
async function viewListing(listingId) {
  ensureDetailStyles();
  const detail = document.getElementById("bookDetail");

  // Show the detail page immediately with a loading state.
  document.getElementById("homepage").style.display = "none";
  document.getElementById("dashboard").style.display = "none";
  detail.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });

  const { data, error } = await supabaseClient
    .from("listings")
    .select(
      "id, user_id, price, condition, created_at, description, book_id, books!inner(title, author, cover_url, isbn)"
    )
    .eq("id", listingId)
    .single();

  if (error || !data) {
    console.error("Failed to load listing:", error);
    document.getElementById("detailTitle").textContent =
      "Sorry, we couldn't load this book.";
    document.getElementById("detailAuthor").textContent = "";
    document.getElementById("detailIsbn").textContent = "";
    document.getElementById("detailPrice").textContent = "";
    document.getElementById("detailDescription").textContent = "";
    document.getElementById("detailCondition").textContent = "";
    document.getElementById("detailGallery").innerHTML = "";
    document.getElementById("detailWantCount").textContent = "";
    document.getElementById("discussionPosts").innerHTML = "";
    document.getElementById("discussionForm").style.display = "none";
    document.getElementById("discussionAuthPrompt").style.display = "none";
    document.getElementById("detailBuyBtn").style.display = "none";
    return;
  }

  currentDetailId = data.id;
  _renderFull(normalizeBook(data), {
    myListingId: data.id,
    price: data.price,
    condition: data.condition,
    description: data.description,
    isListedLocally: true,
  });

  // Show want count (async; page is already visible)
  if (data.book_id) {
    const wantEl = document.getElementById("detailWantCount");
    supabaseClient
      .from("shelf_entries")
      .select("*", { count: "exact", head: true })
      .eq("book_id", data.book_id)
      .eq("shelf_type", "want")
      .then(({ count }) => {
        if (currentDetailId !== data.id || !wantEl || !count) return;
        const label = count === 1 ? "person wants" : "people want";
        wantEl.innerHTML =
          `<i class="fas fa-heart"></i> ${count} ${label} this book`;
      });
  }

  // Show seller name with profile link (async; page is already visible)
  const sellerEl = document.getElementById("detailSeller");
  if (sellerEl && data.user_id) {
    sellerEl.textContent = "Sold by a BookSharez seller";
    supabaseClient
      .from("profiles")
      .select("username")
      .eq("id", data.user_id)
      .maybeSingle()
      .then(({ data: profile }) => {
        if (!profile) return;
        const name = profile.username || "BookSharez seller";
        sellerEl.innerHTML =
          `Sold by <a href="#" onclick="viewProfile('${data.user_id}'); return false;"
            style="color:#667eea;">${escapeHTML(name)}</a>`;
      });
  }

  renderDetailGallery(data.id);
  loadDiscussion(data.book_id, data.id);
}

// Fetch this listing's photos and render them as a gallery. The bucket is
// private, so each stored path is turned into a short-lived signed URL.
async function renderDetailGallery(listingId) {
  const gallery = document.getElementById("detailGallery");
  gallery.innerHTML = "";

  const { data: rows, error } = await supabaseClient
    .from("listing_photos")
    .select("photo_url, display_order")
    .eq("listing_id", listingId)
    .order("display_order", { ascending: true });
  if (error || !rows || rows.length === 0) return; // cover alone is fine

  const paths = rows.map((r) => r.photo_url);
  const { data: signed, error: signErr } = await supabaseClient.storage
    .from("listing-photos")
    .createSignedUrls(paths, 3600);
  if (signErr || !signed) {
    console.error("Failed to sign photo URLs:", signErr);
    return;
  }

  // Bail if the user navigated away while we were fetching.
  if (currentDetailId !== listingId) return;

  signed.forEach((item) => {
    if (!item.signedUrl) return;
    const img = document.createElement("img");
    img.className = "detail-thumb";
    img.src = item.signedUrl;
    img.alt = "Book photo";
    gallery.appendChild(img);
  });
}

// ─── Discussion ───────────────────────────────────────────────────────────────

let currentDiscussionBookId = null;

async function loadDiscussion(bookId, listingId) {
  currentDiscussionBookId = bookId;
  const postsEl  = document.getElementById("discussionPosts");
  const formEl   = document.getElementById("discussionForm");
  const authEl   = document.getElementById("discussionAuthPrompt");
  if (!postsEl) return;

  postsEl.innerHTML = '<p class="discussion-empty">Loading…</p>';
  formEl.style.display = "none";
  authEl.style.display = "none";

  const { data: posts, error } = await supabaseClient
    .from("discussion_posts")
    .select("id, body, created_at, user_id")
    .eq("book_id", bookId)
    .order("created_at", { ascending: true })
    .limit(100);

  if (currentDetailId !== listingId) return;

  if (error) {
    postsEl.innerHTML = '<p class="discussion-empty">Couldn\'t load discussion.</p>';
    return;
  }

  // Batch-fetch usernames for all unique authors in one query.
  let profileMap = {};
  if (posts && posts.length > 0) {
    const userIds = [...new Set(posts.map(p => p.user_id))];
    const { data: profiles } = await supabaseClient
      .from("profiles")
      .select("id, username")
      .in("id", userIds);
    if (profiles) profiles.forEach(p => { profileMap[p.id] = p.username; });
  }

  if (currentDetailId !== listingId) return;

  _renderDiscussionPosts(posts || [], profileMap);

  if (isLoggedIn) {
    formEl.style.display = "block";
    authEl.style.display = "none";
  } else {
    formEl.style.display = "none";
    authEl.style.display = "block";
  }
}

function _renderDiscussionPosts(posts, profileMap) {
  const postsEl = document.getElementById("discussionPosts");
  if (!postsEl) return;
  if (posts.length === 0) {
    postsEl.innerHTML =
      '<p class="discussion-empty">No posts yet — be the first to start the conversation!</p>';
    return;
  }
  postsEl.innerHTML = posts.map(p => {
    const name = escapeHTML(profileMap[p.user_id] || "BookSharez reader");
    const time = _relativeTime(p.created_at);
    const body = escapeHTML(p.body);
    const isOwn = currentUserId && currentUserId === p.user_id;
    const del = isOwn
      ? `<button type="button" class="discussion-delete" onclick="deleteDiscussionPost('${p.id}')">` +
        `<i class="fas fa-trash"></i></button>`
      : "";
    return `<div class="discussion-post" data-id="${p.id}">
      <div class="discussion-post-header">
        <a href="#" class="discussion-username"
           onclick="viewProfile('${p.user_id}'); return false;">${name}</a>
        <span class="discussion-time">${time}</span>
        ${del}
      </div>
      <div class="discussion-post-body">${body}</div>
    </div>`;
  }).join("");
}

async function submitDiscussionPost() {
  if (!isLoggedIn || !currentDiscussionBookId) return;
  const input = document.getElementById("discussionInput");
  const body  = input.value.trim();
  if (!body) return;

  const btn = document.querySelector("#discussionForm .btn");
  btn.disabled    = true;
  btn.textContent = "Posting…";

  const { error } = await supabaseClient
    .from("discussion_posts")
    .insert({ book_id: currentDiscussionBookId, user_id: currentUserId, body });

  btn.disabled   = false;
  btn.innerHTML  = "Post";

  if (error) { alert("Couldn't post. Please try again."); return; }

  input.value = "";
  document.getElementById("discussionCharCount").textContent = "0 / 2000";
  loadDiscussion(currentDiscussionBookId, currentDetailId);
}

async function deleteDiscussionPost(postId) {
  if (!confirm("Delete this post?")) return;
  const { error } = await supabaseClient
    .from("discussion_posts")
    .delete()
    .eq("id", postId);
  if (!error) loadDiscussion(currentDiscussionBookId, currentDetailId);
}

function _relativeTime(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)  return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── end Discussion ────────────────────────────────────────────────────────────

// Return from the detail page to the browse grid.
function backToBrowse() {
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("homepage").style.display = "block";
  currentDetailId = null;
}

function buyBook(listingId, price, title) {
  if (!isLoggedIn) { alert("Please login first to buy books"); showLogin(); return; }
  const priceLabel = Number.isFinite(+price) ? ` for $${Number(price).toFixed(2)}` : "";
  if (confirm(`Are you sure you want to buy "${title || "this book"}"${priceLabel}?`)) {
    alert("Purchase successful! You will receive shipping information via email.");
  }
}

// Edit a listing's price (basic; condition/description editing can follow).
async function editListing(listingId) {
  const current = myListings.find((l) => l.id === listingId);
  if (!current) return;

  const input = prompt("New price (USD):", Number(current.price).toFixed(2));
  if (input === null) return; // cancelled
  const price = parseFloat(input);
  if (!(price >= 0.01 && price <= 9999.99)) {
    alert("Please enter a price between $0.01 and $9999.99.");
    return;
  }

  const { error } = await supabaseClient
    .from("listings")
    .update({ price })
    .eq("id", listingId);
  if (error) {
    console.error("Edit failed:", error);
    alert("Couldn't update the price. Please try again.");
    return;
  }
  await loadUserListings();
  loadFeaturedBooks();
  alert("Price updated.");
}

// Mark a listing as sold (removes it from public browse; stays on My Shelf).
async function markAsSold(listingId) {
  if (!confirm("Mark this listing as sold?")) return;

  const { error } = await supabaseClient
    .from("listings")
    .update({ status: "sold" })
    .eq("id", listingId);
  if (error) {
    console.error("Mark-sold failed:", error);
    alert("Couldn't update the listing. Please try again.");
    return;
  }
  await loadUserListings();
  loadFeaturedBooks();
  alert("Marked as sold.");
}

// Delete a listing for good.
async function deleteListing(listingId) {
  if (!confirm("Are you sure you want to delete this listing?")) return;

  const { error } = await supabaseClient
    .from("listings")
    .delete()
    .eq("id", listingId);
  if (error) {
    console.error("Delete failed:", error);
    alert("Couldn't delete the listing. Please try again.");
    return;
  }
  await loadUserListings();
  loadFeaturedBooks();
  alert("Listing deleted.");
}

// Close modal
function closeModal(modalId) {
  document.getElementById(modalId).style.display = "none";
}

// Utility function to handle responsive behavior
function handleResize() {
  if (window.innerWidth <= 768) {
    // Mobile adjustments
    document.querySelectorAll(".btn").forEach((btn) => {
      btn.style.fontSize = "0.85rem";
      btn.style.padding = "0.6rem 1.2rem";
    });
  }
}

window.addEventListener("resize", handleResize);
handleResize(); // Call on load

// Navigate from a shelf card to the browse grid, searching by ISBN (exact) or
// title (fallback). ISBN gives the cleanest single-book result.
function searchByAuthor(author) {
  document.getElementById("homepage").style.display = "block";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("searchInput").value = author;
  searchBooks();
}

function browseBook(isbn, title) {
  const term = isbn || title;
  document.getElementById("homepage").style.display = "block";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("searchInput").value = term;
  searchBooks();
}

// Open the unified book page for a catalog book (architecture §5.4): book
// metadata + its community seller offers (primary) + affiliate offers + want
// count + discussion. Uses book_id, so no external API calls are needed.
async function browseBookById(bookId, title) {
  ensureDetailStyles();
  document.getElementById("homepage").style.display = "none";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("bookDetail").style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Show the title immediately so the page isn't blank while we fetch.
  document.getElementById("detailTitle").textContent = title || "Book";

  // Fetch the catalog book row and its active listings in parallel.
  const [bookRes, listingRes] = await Promise.all([
    supabaseClient
      .from("books")
      .select("id, isbn, title, author, cover_url")
      .eq("id", bookId)
      .maybeSingle(),
    applySort(baseListingsQuery().eq("book_id", bookId), currentSort()),
  ]);

  const book = bookRes.data
    ? normalizeBook(bookRes.data)
    : normalizeBook({ id: bookId, title });
  _renderBookPage(book, (listingRes && listingRes.data) || []);
}

// ─────────────────────────────────────────────────────────────────────────────
// Book search via Google Books API (title/author — both modals share this)
// ─────────────────────────────────────────────────────────────────────────────

// Convert ISBN-10 to ISBN-13 (for Google Books results that only carry ISBN-10)
function isbn10to13Client(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return null;
  const base = "978" + s.slice(0, 9);
  const digits = base.split("").map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return base + (10 - (sum % 10)) % 10;
}

// Search Google Books; returns up to 12 results with ISBNs.
// Throws on quota/network error so the caller can fall back to Open Library.
async function searchGoogleBooks(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=20&country=US`,
      { signal: controller.signal }
    );
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 429 || res.status === 403) {
    throw new Error(`Google Books quota exceeded (${res.status})`);
  }
  if (!res.ok) throw new Error(`Google Books error ${res.status}`);
  const json = await res.json();
  if (!json.items) return [];

  return json.items.map((item) => {
    const info = item.volumeInfo || {};
    const sale = item.saleInfo || {};
    const ids = info.industryIdentifiers || [];
    const isbn13raw = ids.find((i) => i.type === "ISBN_13")?.identifier;
    const isbn10raw = ids.find((i) => i.type === "ISBN_10")?.identifier;
    const isbn = isbn13raw || (isbn10raw ? isbn10to13Client(isbn10raw) : null);
    if (!isbn || !info.title) return null;
    const cover = (info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || "")
      .replace(/^http:/, "https:");
    return {
      isbn, title: info.title,
      author: (info.authors || []).join(", "),
      year: (info.publishedDate || "").slice(0, 4),
      cover,
      buyLink: sale.buyLink || info.infoLink || null,
    };
  }).filter(Boolean);
}

// Search Open Library — free, no API key, no daily quota.
async function searchOpenLibrary(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(
      `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=20&fields=title,author_name,isbn,cover_i,first_publish_year`,
      { signal: controller.signal }
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return [];
  const json = await res.json();
  if (!json.docs) return [];

  return json.docs.map((doc) => {
    const isbns = doc.isbn || [];
    const isbn13 = isbns.find((i) => /^\d{13}$/.test(i));
    const isbn10 = isbns.find((i) => /^\d{9}[\dX]$/.test(i));
    const isbn = isbn13 || (isbn10 ? isbn10to13Client(isbn10) : null);
    if (!isbn || !doc.title) return null;
    const cover = doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : "";
    return {
      isbn, title: doc.title,
      author: (doc.author_name || []).join(", "),
      year: doc.first_publish_year ? String(doc.first_publish_year) : "",
      cover,
      buyLink: `https://openlibrary.org/isbn/${isbn}`,
    };
  }).filter(Boolean);
}

// Public entry point used by all three call sites (hero search, shelf modal,
// sell modal). Tries Google Books first; falls back to Open Library on quota
// or any network error so there is always a result.
async function searchBooksAPI(query) {
  try {
    const results = await searchGoogleBooks(query);
    if (results.length > 0) return results;
    // Google Books returned OK but empty — still try Open Library.
  } catch (e) {
    console.warn("Google Books unavailable, using Open Library:", e.message);
  }
  return searchOpenLibrary(query);
}

// Render search results into a container div; onSelect(book) is called on click.
function renderBookSearchResults(results, container, onSelect) {
  container.innerHTML = "";
  results.forEach((book) => {
    const item = document.createElement("div");
    item.style.cssText =
      "display:flex;gap:0.75rem;align-items:center;padding:0.5rem 0.75rem;" +
      "cursor:pointer;border-bottom:1px solid #f0f0f0;";
    item.onmouseenter = () => { item.style.background = "#f8f9fa"; };
    item.onmouseleave = () => { item.style.background = ""; };
    const img = document.createElement("img");
    img.src = book.cover || "";
    img.alt = "";
    img.style.cssText = "width:36px;height:50px;object-fit:cover;border-radius:4px;flex-shrink:0;";
    img.onerror = () => { img.style.display = "none"; };
    const meta = document.createElement("div");
    meta.style.minWidth = "0";
    const titleEl = document.createElement("div");
    titleEl.style.cssText = "font-weight:600;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    titleEl.textContent = book.title;
    const subEl = document.createElement("div");
    subEl.style.cssText = "color:#666;font-size:0.8rem;";
    subEl.textContent = book.author + (book.year ? " · " + book.year : "");
    meta.appendChild(titleEl);
    meta.appendChild(subEl);
    item.appendChild(img);
    item.appendChild(meta);
    item.onclick = () => onSelect(book);
    container.appendChild(item);
  });
}

// ── Shelf modal search ────────────────────────────────────────────────────────

async function searchShelfBooks() {
  const query = document.getElementById("shelfSearchQuery").value.trim();
  if (!query) return;
  const statusEl = document.getElementById("shelfSearchStatus");
  const resultsDiv = document.getElementById("shelfSearchResults");
  statusEl.textContent = "Searching…";
  resultsDiv.style.display = "none";
  try {
    const results = await searchBooksAPI(query);
    if (!results.length) {
      statusEl.textContent = "No results found — try different terms or enter the ISBN directly.";
      return;
    }
    statusEl.textContent = "";
    resultsDiv.style.cssText =
      "display:block;max-height:240px;overflow-y:auto;" +
      "border:1px solid #e9ecef;border-radius:8px;margin-bottom:0.75rem;";
    renderBookSearchResults(results, resultsDiv, (book) => {
      selectShelfBook(book.isbn, book.title, book.author, book.cover);
    });
  } catch (e) {
    console.error("Shelf book search failed:", e);
    statusEl.textContent = "Search failed. Please try again.";
  }
}

function selectShelfBook(isbn, title, author, coverUrl) {
  document.getElementById("shelfISBN").value = isbn;
  document.getElementById("shelfTitle").value = title;
  document.getElementById("shelfAuthor").value = author || "";
  pendingCover = { isbn, url: coverUrl || null };
  document.getElementById("shelfSearchResults").style.display = "none";
  document.getElementById("shelfSearchQuery").value = title;
  document.getElementById("shelfSearchStatus").textContent = `"${title}" selected ✓`;
  document.getElementById("shelfIsbnStatus").textContent = "";
}

// ── Sell modal search ─────────────────────────────────────────────────────────

async function searchSellBooks() {
  const query = document.getElementById("sellSearchQuery").value.trim();
  if (!query) return;
  const statusEl = document.getElementById("sellSearchStatus");
  const resultsDiv = document.getElementById("sellSearchResults");
  statusEl.textContent = "Searching…";
  resultsDiv.style.display = "none";
  try {
    const results = await searchBooksAPI(query);
    if (!results.length) {
      statusEl.textContent = "No results found — try different terms or enter the ISBN directly.";
      return;
    }
    statusEl.textContent = "";
    resultsDiv.style.cssText =
      "display:block;max-height:240px;overflow-y:auto;" +
      "border:1px solid #e9ecef;border-radius:8px;margin-bottom:0.75rem;";
    renderBookSearchResults(results, resultsDiv, (book) => {
      selectSellBook(book.isbn, book.title, book.author, book.cover);
    });
  } catch (e) {
    console.error("Sell book search failed:", e);
    statusEl.textContent = "Search failed. Please try again.";
  }
}

function selectSellBook(isbn, title, author, coverUrl) {
  document.getElementById("bookISBN").value = isbn;
  document.getElementById("bookTitle").value = title;
  document.getElementById("bookAuthor").value = author || "";
  pendingCover = { isbn, url: coverUrl || null };
  showSellCoverPreview(coverUrl || null, title);
  document.getElementById("sellSearchResults").style.display = "none";
  document.getElementById("sellSearchQuery").value = title;
  document.getElementById("sellSearchStatus").textContent = `"${title}" selected ✓`;
  setLookupStatus("");
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Shelf system
// ─────────────────────────────────────────────────────────────────────────────

function showAddToShelfModal(defaultType = "have") {
  if (!isLoggedIn) { showLogin(); return; }
  document.getElementById("shelfType").value = defaultType;
  document.getElementById("shelfISBN").value = "";
  document.getElementById("shelfTitle").value = "";
  document.getElementById("shelfAuthor").value = "";
  document.getElementById("shelfIsbnStatus").textContent = "";
  document.getElementById("shelfSearchQuery").value = "";
  document.getElementById("shelfSearchStatus").textContent = "";
  document.getElementById("shelfSearchResults").style.display = "none";
  document.getElementById("shelfSearchResults").innerHTML = "";
  document.getElementById("addToShelfModal").style.display = "block";
}

function setShelfLookupStatus(msg) {
  const el = document.getElementById("shelfIsbnStatus");
  if (el) el.textContent = msg;
}

async function lookupShelfISBN() {
  const isbn = (document.getElementById("shelfISBN").value || "").replace(/[\s-]/g, "");
  if (!/^(\d{13}|\d{9}[\dXx])$/.test(isbn)) {
    setShelfLookupStatus("Enter a valid ISBN (10 or 13 digits) first.");
    return;
  }
  setShelfLookupStatus("Looking up…");

  try {
    const result = await lookupViaEdgeFunction(isbn);
    if (result && result.title) {
      document.getElementById("shelfTitle").value = result.title;
      document.getElementById("shelfAuthor").value = result.author || "";
      pendingCover = { isbn, url: result.cover || null };
      setShelfLookupStatus("Details filled ✓");
      return;
    }
    if (result === null) {
      setShelfLookupStatus("Not found — please type the details in.");
      return;
    }
  } catch (e) {
    console.error("isbn-lookup unavailable, trying fallback:", e);
  }

  const fallbacks = [
    { name: "Open Library", fn: lookupOpenLibrary },
    { name: "Google Books", fn: lookupGoogleBooks },
  ];
  for (const src of fallbacks) {
    try {
      const result = await src.fn(isbn);
      if (result && result.title) {
        document.getElementById("shelfTitle").value = result.title;
        document.getElementById("shelfAuthor").value = result.author || "";
        pendingCover = { isbn, url: result.cover || null };
        setShelfLookupStatus(`Details filled from ${src.name} ✓`);
        return;
      }
    } catch (e) {
      console.error(src.name, "lookup error:", e);
    }
  }
  setShelfLookupStatus("Not found — please type the details in.");
}

async function handleAddToShelf(e) {
  e.preventDefault();
  const isbn = (document.getElementById("shelfISBN").value || "").replace(/[\s-]/g, "");
  const title = document.getElementById("shelfTitle").value.trim();
  const author = document.getElementById("shelfAuthor").value.trim();
  const shelfType = document.getElementById("shelfType").value;

  if (!/^(\d{13}|\d{9}[\dXx])$/.test(isbn)) {
    alert("Please enter a valid ISBN.");
    return;
  }
  if (!title) {
    alert("Please enter a title.");
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const coverUrl = pendingCover.isbn === isbn ? pendingCover.url : null;
    const bookId = await ensureBook({ isbn, title, author, coverUrl });
    const { data: { user } } = await supabaseClient.auth.getUser();

    const { error } = await supabaseClient
      .from("shelf_entries")
      .upsert(
        { user_id: user.id, book_id: bookId, shelf_type: shelfType },
        { onConflict: "user_id,book_id,shelf_type" }
      );
    if (error) throw error;

    closeModal("addToShelfModal");
    activateDashboardTab(shelfType === "have" ? "shelf-have" : "shelf-want");
    document.getElementById("homepage").style.display = "none";
    document.getElementById("bookDetail").style.display = "none";
    document.getElementById("dashboard").style.display = "block";
    if (shelfType === "have") loadShelfHave();
    else loadShelfWant();
  } catch (err) {
    console.error("Failed to add to shelf:", err);
    alert("Sorry, something went wrong. Please try again.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function loadShelfHave() {
  const container = document.getElementById("shelfHaveList");
  container.innerHTML = "<p>Loading…</p>";

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) { container.innerHTML = "<p>Please log in.</p>"; return; }

  const [shelfRes, listingsRes] = await Promise.all([
    supabaseClient
      .from("shelf_entries")
      .select("id, added_at, books!inner(id, isbn, title, author, cover_url)")
      .eq("user_id", user.id)
      .eq("shelf_type", "have")
      .order("added_at", { ascending: false }),
    supabaseClient
      .from("listings")
      .select("book_id")
      .eq("user_id", user.id)
      .eq("status", "active"),
  ]);

  if (shelfRes.error) {
    console.error("Failed to load Books I Have:", shelfRes.error);
    container.innerHTML = "<p>Couldn't load your shelf. Please try again.</p>";
    return;
  }

  myShelfHave = shelfRes.data || [];
  const listedBookIds = new Set((listingsRes.data || []).map((l) => l.book_id));

  if (myShelfHave.length === 0) {
    container.innerHTML =
      '<p>Your "Books I Have" shelf is empty. ' +
      '<a href="#" onclick="showAddToShelfModal(\'have\')">Add a book</a></p>';
    return;
  }

  container.innerHTML = "";
  myShelfHave.forEach((entry) => {
    const book = entry.books || {};
    const isListed = listedBookIds.has(book.id);
    const card = document.createElement("div");
    card.className = "listing-card";

    const main = document.createElement("div");
    main.className = "listing-main";
    main.style.cursor = "pointer";

    const imgWrapper = document.createElement("div");
    imgWrapper.style.cssText = "position:relative;flex-shrink:0;";

    const img = document.createElement("img");
    img.className = "listing-cover";
    img.src = book.cover_url || "";
    img.alt = book.title || "";
    img.onerror = () => {
      img.src = "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=70&h=95&fit=crop";
    };
    imgWrapper.appendChild(img);

    if (isListed) {
      const badge = document.createElement("div");
      badge.textContent = "For Sale";
      badge.style.cssText =
        "position:absolute;top:3px;right:3px;background:rgba(102,126,234,0.92);" +
        "color:#fff;font-size:0.55rem;font-weight:700;padding:2px 5px;" +
        "border-radius:3px;line-height:1.3;white-space:nowrap;";
      imgWrapper.appendChild(badge);
    }

    const info = document.createElement("div");
    info.innerHTML = `
      <h4 style="margin:0 0 0.2rem;">${escapeHTML(book.title)}</h4>
      <p style="margin:0;color:#666;font-style:italic;">${escapeHTML(book.author || "")}</p>
    `;

    main.appendChild(imgWrapper);
    main.appendChild(info);
    main.addEventListener("click", () => browseBookById(book.id, book.title));

    const actions = document.createElement("div");
    actions.className = "listing-actions";
    actions.innerHTML = `
      ${!isListed
        ? `<button class="btn btn-primary btn-small" onclick="listShelfItemForSale('${entry.id}')">
             <i class="fas fa-tags"></i> List for Sale
           </button>`
        : ""}
      <button class="btn btn-secondary btn-small" onclick="removeFromShelf('${entry.id}','have')">
        <i class="fas fa-times"></i> Remove
      </button>
    `;

    card.appendChild(main);
    card.appendChild(actions);
    container.appendChild(card);
  });
}

async function loadShelfWant() {
  const container = document.getElementById("shelfWantList");
  container.innerHTML = "<p>Loading…</p>";

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) { container.innerHTML = "<p>Please log in.</p>"; return; }

  const { data, error } = await supabaseClient
    .from("shelf_entries")
    .select("id, added_at, books!inner(id, isbn, title, author, cover_url)")
    .eq("user_id", user.id)
    .eq("shelf_type", "want")
    .order("added_at", { ascending: false });

  if (error) {
    console.error("Failed to load Books I Want:", error);
    container.innerHTML = "<p>Couldn't load your shelf. Please try again.</p>";
    return;
  }

  myShelfWant = data || [];

  if (myShelfWant.length === 0) {
    container.innerHTML =
      '<p>Your "Books I Want" shelf is empty. ' +
      '<a href="#" onclick="showAddToShelfModal(\'want\')">Add a book</a></p>';
    return;
  }

  container.innerHTML = "";
  myShelfWant.forEach((entry) => {
    const book = entry.books || {};
    const card = document.createElement("div");
    card.className = "listing-card";

    const main = document.createElement("div");
    main.className = "listing-main";
    main.style.cursor = "pointer";

    const img = document.createElement("img");
    img.className = "listing-cover";
    img.src = book.cover_url || "";
    img.alt = book.title || "";
    img.onerror = () => {
      img.src = "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=70&h=95&fit=crop";
    };

    const info = document.createElement("div");
    info.innerHTML = `
      <h4 style="margin:0 0 0.2rem;">${escapeHTML(book.title)}</h4>
      <p style="margin:0;color:#666;font-style:italic;">${escapeHTML(book.author || "")}</p>
    `;

    main.appendChild(img);
    main.appendChild(info);
    main.addEventListener("click", () => browseBookById(book.id, book.title));

    const actions = document.createElement("div");
    actions.className = "listing-actions";
    actions.innerHTML = `
      <button class="btn btn-secondary btn-small" onclick="removeFromShelf('${entry.id}','want')">
        <i class="fas fa-times"></i> Remove
      </button>
    `;

    card.appendChild(main);
    card.appendChild(actions);
    container.appendChild(card);
  });
}

async function removeFromShelf(entryId, shelfType) {
  if (!confirm("Remove this book from your shelf?")) return;
  const { error } = await supabaseClient
    .from("shelf_entries")
    .delete()
    .eq("id", entryId);
  if (error) {
    console.error("Remove from shelf failed:", error);
    alert("Couldn't remove the book. Please try again.");
    return;
  }
  if (shelfType === "have") loadShelfHave();
  else loadShelfWant();
}

// Open the sell modal pre-populated from a "Books I Have" shelf entry.
function listShelfItemForSale(shelfEntryId) {
  const entry = myShelfHave.find((e) => e.id === shelfEntryId);
  if (!entry) return;
  const book = entry.books || {};

  currentListingShelfEntryId = shelfEntryId;
  document.getElementById("bookISBN").value = book.isbn || "";
  document.getElementById("bookTitle").value = book.title || "";
  document.getElementById("bookAuthor").value = book.author || "";
  document.getElementById("bookCondition").value = "";
  document.getElementById("bookPrice").value = "";
  document.getElementById("bookDescription").value = "";
  pendingCover = { isbn: book.isbn, url: book.cover_url || null };
  showSellCoverPreview(book.cover_url || null, book.title || "");

  document.getElementById("sellSearchQuery").value = book.title || "";
  document.getElementById("sellSearchStatus").textContent = "Book pre-filled from shelf ✓";
  document.getElementById("sellSearchResults").style.display = "none";
  document.getElementById("sellSearchResults").innerHTML = "";
  setLookupStatus("");
  setPriceSuggestStatus("");
  document.getElementById("sellModal").style.display = "block";
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Profile page (viewing another user's public shelves)
// ─────────────────────────────────────────────────────────────────────────────

async function viewProfile(userId) {
  currentProfileUserId = userId;
  document.getElementById("homepage").style.display = "none";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("profilePage").style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Reset UI before async loads
  document.getElementById("profileDisplayName").textContent = "Loading…";
  document.getElementById("profileDisplayBio").textContent = "";
  document.getElementById("profileFollowerCount").textContent = "";
  document.getElementById("profileFollowingCount").textContent = "";
  document.getElementById("followBtn").style.display = "none";
  document.getElementById("profileShelfHave").innerHTML = "";
  document.getElementById("profileShelfWant").innerHTML = "";

  const [profileRes, followerRes, followingRes, haveRes, wantRes, listingsRes] = await Promise.all([
    supabaseClient.from("profiles").select("username, bio").eq("id", userId).maybeSingle(),
    supabaseClient.from("follows").select("*", { count: "exact", head: true }).eq("followed_id", userId),
    supabaseClient.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
    supabaseClient
      .from("shelf_entries")
      .select("id, books!inner(isbn, title, author, cover_url)")
      .eq("user_id", userId).eq("shelf_type", "have").eq("visibility", "public")
      .order("added_at", { ascending: false }).limit(24),
    supabaseClient
      .from("shelf_entries")
      .select("id, books!inner(isbn, title, author, cover_url)")
      .eq("user_id", userId).eq("shelf_type", "want").eq("visibility", "public")
      .order("added_at", { ascending: false }).limit(24),
    supabaseClient
      .from("listings")
      .select("books!inner(isbn)")
      .eq("user_id", userId)
      .eq("status", "active"),
  ]);

  const profile = profileRes.data;
  document.getElementById("profileDisplayName").textContent =
    profile?.username || "BookSharez Reader";
  document.getElementById("profileDisplayBio").textContent = profile?.bio || "";
  document.getElementById("profileFollowerCount").textContent =
    `${followerRes.count || 0} followers`;
  document.getElementById("profileFollowingCount").textContent =
    `${followingRes.count || 0} following`;

  // Follow button — only for other users when logged in
  if (isLoggedIn && currentUserId && currentUserId !== userId) {
    const { data: existingFollow } = await supabaseClient
      .from("follows")
      .select("id")
      .eq("follower_id", currentUserId)
      .eq("followed_id", userId)
      .maybeSingle();
    currentProfileIsFollowed = !!existingFollow;
    const followBtn = document.getElementById("followBtn");
    followBtn.textContent = currentProfileIsFollowed ? "Unfollow" : "Follow";
    followBtn.style.display = "inline-flex";
  }

  const listedIsbns = new Set(
    (listingsRes.data || []).map((l) => l.books?.isbn).filter(Boolean)
  );
  renderProfileShelf("profileShelfHave", haveRes.data || [], listedIsbns);
  renderProfileShelf("profileShelfWant", wantRes.data || [], listedIsbns);
}

function renderProfileShelf(containerId, entries, listedIsbns = new Set()) {
  const container = document.getElementById(containerId);
  if (!entries.length) {
    container.innerHTML = '<p style="color:#888;">Nothing here yet.</p>';
    return;
  }
  const grid = document.createElement("div");
  grid.style.cssText = "display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem;";
  entries.forEach((entry) => {
    const book = normalizeBook(entry);
    grid.appendChild(renderBook(book, { isForSale: listedIsbns.has(book.isbn) }, "thumb"));
  });
  container.appendChild(grid);
}

function backFromProfile() {
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("homepage").style.display = "block";
  currentProfileUserId = null;
}

async function toggleFollow() {
  if (!isLoggedIn) { showLogin(); return; }
  const followBtn = document.getElementById("followBtn");
  followBtn.disabled = true;

  if (currentProfileIsFollowed) {
    const { error } = await supabaseClient
      .from("follows")
      .delete()
      .eq("follower_id", currentUserId)
      .eq("followed_id", currentProfileUserId);
    if (error) { console.error("Unfollow failed:", error); followBtn.disabled = false; return; }
    currentProfileIsFollowed = false;
    followBtn.textContent = "Follow";
    const el = document.getElementById("profileFollowerCount");
    el.textContent = `${Math.max(0, parseInt(el.textContent) - 1)} followers`;
  } else {
    const { error } = await supabaseClient
      .from("follows")
      .insert({ follower_id: currentUserId, followed_id: currentProfileUserId });
    if (error) { console.error("Follow failed:", error); followBtn.disabled = false; return; }
    currentProfileIsFollowed = true;
    followBtn.textContent = "Unfollow";
    const el = document.getElementById("profileFollowerCount");
    el.textContent = `${(parseInt(el.textContent) || 0) + 1} followers`;
  }
  followBtn.disabled = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2: Profile settings (own account)
// ─────────────────────────────────────────────────────────────────────────────

async function loadProfileSettings() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { data: profile } = await supabaseClient
    .from("profiles")
    .select("username, bio")
    .eq("id", user.id)
    .maybeSingle();

  document.getElementById("profileUsername").value = profile?.username || "";
  document.getElementById("profileBioInput").value = profile?.bio || "";
  document.getElementById("profileSaveStatus").textContent = "";
}

async function handleSaveProfile(e) {
  e.preventDefault();
  const username = document.getElementById("profileUsername").value.trim();
  const bio = document.getElementById("profileBioInput").value.trim();
  const status = document.getElementById("profileSaveStatus");

  if (username && !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    status.textContent = "Username must be 3–30 characters: letters, numbers, underscores only.";
    return;
  }
  if (bio.length > 300) {
    status.textContent = "Bio must be 300 characters or fewer.";
    return;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  const { error } = await supabaseClient
    .from("profiles")
    .upsert(
      { id: user.id, username: username || null, bio: bio || null },
      { onConflict: "id" }
    );

  if (error) {
    if (error.code === "23505") {
      status.textContent = "That username is taken. Please choose another.";
    } else {
      console.error("Profile save failed:", error);
      status.textContent = "Couldn't save profile. Please try again.";
    }
    return;
  }
  status.textContent = "Profile saved ✓";
  setTimeout(() => { status.textContent = ""; }, 3000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Barcode / cover scanner
// ─────────────────────────────────────────────────────────────────────────────

let _scanStream = null;      // MediaStream from getUserMedia
let _scanAnimFrame = null;   // requestAnimationFrame id
let _scannerFallback = null; // html5-qrcode instance (fallback only)
let _scannerTarget = null;   // 'shelf' | 'sell' | 'dashboard'
let _scannedBookData = null;
let _lastScanFile = null;    // File kept for AI barcode retry after Quagga/BarcodeDetector fails

function openBookScanner() {
  _scannerTarget = "dashboard";
  _openScannerModal();
}

function openBarcodeScanner(target) {
  _scannerTarget = target;
  _openScannerModal();
}

function _openScannerModal() {
  _scannedBookData = null;
  _showScannerState("scanning");
  _resetCameraView();
  document.getElementById("scannerPhotoInput").value = "";
  document.getElementById("scannerGalleryInput").value = "";
  document.getElementById("barcodeScannerModal").style.display = "block";
}

function _resetCameraView() {
  const view = document.getElementById("barcodeScannerView");
  const statusEl = document.getElementById("scannerStatus");
  const btn = document.getElementById("btnLiveCamera");
  view.style.display = "none";
  view.innerHTML = "";
  statusEl.style.display = "none";
  statusEl.textContent = "";
  if (btn) btn.style.display = "";
}

function startLiveCamera() {
  const view = document.getElementById("barcodeScannerView");
  const statusEl = document.getElementById("scannerStatus");
  const btn = document.getElementById("btnLiveCamera");
  view.style.display = "";
  statusEl.style.display = "";
  statusEl.textContent = "Starting camera…";
  if (btn) btn.style.display = "none";
  _startLiveScanner();
}

function _showScannerState(state) {
  document.getElementById("scannerStateScanning").style.display = state === "scanning" ? "" : "none";
  document.getElementById("scannerStateFound").style.display   = state === "found"    ? "block" : "none";
}

async function _startLiveScanner() {
  const view = document.getElementById("barcodeScannerView");
  const statusEl = document.getElementById("scannerStatus");
  view.innerHTML = "";

  try {
    _scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    });

    const video = document.createElement("video");
    video.srcObject = _scanStream;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.style.cssText = "width:100%;border-radius:8px;display:block;";
    view.appendChild(video);
    await video.play();

    if ("BarcodeDetector" in window) {
      // Native BarcodeDetector — hardware-accelerated, works great on Android Chrome
      const detector = new BarcodeDetector({
        formats: ["ean_13", "ean_8", "code_128", "upc_a", "upc_e"],
      });
      statusEl.textContent = "Point the barcode at the camera";
      let detected = false;
      const scan = async () => {
        if (detected) return;
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            detected = true;
            await _onBarcodeDetected(barcodes[0].rawValue);
            return;
          }
        } catch (e) { /* per-frame errors are normal */ }
        _scanAnimFrame = requestAnimationFrame(scan);
      };
      _scanAnimFrame = requestAnimationFrame(scan);
    } else {
      // BarcodeDetector not available — use html5-qrcode over the stream
      statusEl.textContent = "Point the barcode at the camera";
      _scannerFallback = new Html5Qrcode("barcodeScannerView");
      // html5-qrcode will create its own video; remove ours first
      view.innerHTML = "";
      _scanStream.getTracks().forEach(t => t.stop());
      _scanStream = null;
      await _scannerFallback.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 100 } },
        (isbn) => _onBarcodeDetected(isbn),
        () => {}
      );
    }
  } catch (err) {
    statusEl.textContent = "Camera access denied — please allow camera access, then reopen.";
    console.warn("Camera error:", err);
  }
}

async function _stopLiveScanner() {
  if (_scanAnimFrame) { cancelAnimationFrame(_scanAnimFrame); _scanAnimFrame = null; }
  if (_scanStream) { _scanStream.getTracks().forEach(t => t.stop()); _scanStream = null; }
  if (_scannerFallback) {
    try {
      if (_scannerFallback.isScanning) await _scannerFallback.stop();
      _scannerFallback.clear();
    } catch (e) { /* ignore */ }
    _scannerFallback = null;
  }
}

async function _onBarcodeDetected(isbn) {
  // Reject non-ISBN barcodes (UPC-A, store price codes, etc.)
  const isIsbn13 = /^97[89]\d{10}$/.test(isbn);
  const isIsbn10 = /^\d{9}[\dXx]$/.test(isbn);
  if (!isIsbn13 && !isIsbn10) {
    const statusEl = document.getElementById("scannerStatus");
    statusEl.style.display = "";
    statusEl.textContent = "That’s a price barcode, not an ISBN — enter the ISBN below:";
    document.getElementById("scannerManualEntry").style.display = "";
    document.getElementById("scannerManualISBN").focus();
    document.getElementById("scannerPhotoInput").value = "";
    document.getElementById("scannerGalleryInput").value = "";
    return;
  }

  await _stopLiveScanner();
  document.getElementById("barcodeScannerView").innerHTML = "";

  if (_scannerTarget !== "dashboard") {
    await closeBarcodeScanner();
    if (_scannerTarget === "shelf") {
      document.getElementById("shelfISBN").value = isbn;
      await lookupShelfISBN();
    } else {
      document.getElementById("bookISBN").value = isbn;
      await lookupISBN();
    }
    return;
  }

  const statusEl = document.getElementById("scannerStatus");
  statusEl.textContent = "ISBN " + isbn + " — looking up…";

  const book = await _fetchBookByISBN(isbn);

  if (!book) {
    // Lookup failed — let the user add it manually with the ISBN pre-filled
    statusEl.textContent = "Couldn't load book info. You can still add it manually.";
    _scannedBookData = { isbn, title: "ISBN: " + isbn, author: "", cover_url: "" };
    document.getElementById("scannerBookCover").src =
      "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=140&h=190&fit=crop";
    document.getElementById("scannerBookTitle").textContent = "ISBN: " + isbn;
    document.getElementById("scannerBookAuthor").textContent = "Title unknown — tap below to add anyway";
    _showScannerState("found");
    return;
  }

  _scannedBookData = book;
  document.getElementById("scannerBookCover").src =
    book.cover_url || "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=140&h=190&fit=crop";
  document.getElementById("scannerBookTitle").textContent  = book.title  || "Unknown Title";
  document.getElementById("scannerBookAuthor").textContent = book.author ? "by " + book.author : "";
  _showScannerState("found");
}

async function _fetchBookByISBN(isbn) {
  const timeout = (ms) => new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), ms));

  try {
    const { data } = await Promise.race([
      supabaseClient.from("books").select("id, isbn, title, author, cover_url")
        .eq("isbn", isbn).maybeSingle(),
      timeout(2000),
    ]);
    if (data) return data;
  } catch (e) { /* timeout or error — fall through */ }

  try {
    const results = await Promise.race([searchBooksAPI(isbn), timeout(5000)]);
    if (results && results.length > 0) {
      const b = results[0];
      return { isbn, title: b.title, author: b.author, cover_url: b.cover };
    }
  } catch (e) { /* ignore */ }

  return null;
}

async function addScannedBook(shelfType) {
  if (!_scannedBookData) return;
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) { alert("Please log in first."); return; }

  const book = _scannedBookData;
  let bookId = book.id;

  if (!bookId) {
    const { data: upserted, error } = await supabaseClient
      .from("books")
      .upsert({ isbn: book.isbn, title: book.title, author: book.author, cover_url: book.cover_url },
               { onConflict: "isbn" })
      .select("id").single();
    if (error || !upserted) { alert("Couldn't save book. Please try again."); return; }
    bookId = upserted.id;
  }

  const { error: shelfError } = await supabaseClient
    .from("shelf_entries")
    .insert({ user_id: user.id, book_id: bookId, shelf_type: shelfType });

  if (shelfError && shelfError.code !== "23505") {
    alert("Couldn't add to shelf. Please try again.");
    return;
  }

  await closeBarcodeScanner();
  alert(`"${book.title}" added to ${shelfType === "have" ? "Books I Have" : "Books I Want"}!`);
  if (shelfType === "have") loadShelfHave(); else loadShelfWant();
}

async function scannerReset() {
  await _stopLiveScanner();
  _scannedBookData = null;
  _lastScanFile = null;
  _showScannerState("scanning");
  _resetCameraView();
  document.getElementById("scannerPhotoInput").value = "";
  document.getElementById("scannerGalleryInput").value = "";
  document.getElementById("scannerCoverInput").value = "";
  document.getElementById("scannerVisionFallback").style.display = "none";
  document.getElementById("scannerCoverResults").style.display = "none";
}

async function closeBarcodeScanner() {
  await _stopLiveScanner();
  document.getElementById("barcodeScannerModal").style.display = "none";
  document.getElementById("barcodeScannerView").innerHTML = "";
  document.getElementById("scannerPhotoInput").value = "";
  document.getElementById("scannerGalleryInput").value = "";
  document.getElementById("scannerCoverInput").value = "";
  document.getElementById("scannerVisionFallback").style.display = "none";
  document.getElementById("scannerCoverResults").style.display = "none";
  _scannedBookData = null;
  _lastScanFile = null;
}

async function scanFromPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  _lastScanFile = file; // saved for AI barcode retry
  const statusEl = document.getElementById("scannerStatus");
  statusEl.style.display = "";
  statusEl.textContent = "Scanning photo…";
  await _stopLiveScanner();

  // Native BarcodeDetector handles full-res photos perfectly
  if ("BarcodeDetector" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector({
        formats: ["ean_13", "ean_8", "code_128", "upc_a", "upc_e"],
      });
      const barcodes = await detector.detect(bitmap);
      if (barcodes.length > 0) {
        await _onBarcodeDetected(barcodes[0].rawValue);
        return;
      }
    } catch (e) { console.warn("BarcodeDetector photo scan failed:", e); }
  }

  // Quagga2 fallback — purpose-built for 1D barcodes from static images.
  // html5-qrcode's bundled ZXing-js is kept only for the live camera path.
  const objUrl = URL.createObjectURL(file);
  try {
    const isbn = await new Promise((resolve) => {
      Quagga.decodeSingle({
        src: objUrl,
        numOfWorkers: 0,
        decoder: { readers: ["ean_reader", "ean_8_reader", "code_128_reader", "upc_reader"] },
        locate: true,
      }, (result) => {
        resolve(result && result.codeResult ? result.codeResult.code : null);
      });
    });
    if (isbn) {
      await _onBarcodeDetected(isbn);
    } else {
      statusEl.textContent = "Couldn't read barcode — try AI reader, scan the cover, or enter manually.";
      document.getElementById("scannerVisionFallback").style.display = "";
      input.value = "";
      document.getElementById("scannerPhotoInput").value = "";
      document.getElementById("scannerGalleryInput").value = "";
    }
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vision OCR helpers (vision-extract Edge Function)
// ─────────────────────────────────────────────────────────────────────────────

// Compress a File to under 4.5 MB and return { base64, mimeType }.
// Uses canvas resize when the file is oversized; reads directly otherwise.
async function _compressAndEncode(file) {
  const MAX_BYTES = 4.5 * 1024 * 1024;

  if (file.size <= MAX_BYTES) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const [header, base64] = dataUrl.split(",");
        const mimeType = header.match(/:(.*?);/)?.[1] || "image/jpeg";
        const allowed = ["image/jpeg", "image/png", "image/webp"];
        resolve({ base64, mimeType: allowed.includes(mimeType) ? mimeType : "image/jpeg" });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Oversized — scale down via canvas (preserves aspect ratio).
  const bitmap = await createImageBitmap(file);
  const scale = Math.sqrt(MAX_BYTES / file.size);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("Canvas compression failed")); return; }
      const reader = new FileReader();
      reader.onload = () => {
        resolve({ base64: reader.result.split(",")[1], mimeType: "image/jpeg" });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }, "image/jpeg", 0.85);
  });
}

// Call the vision-extract Edge Function. Returns the parsed `data` object,
// or throws with a user-safe message on failure.
async function _callVisionExtract(base64, mimeType, mode) {
  const { data, error } = await supabaseClient.functions.invoke("vision-extract", {
    body: { imageBase64: base64, mimeType, mode },
  });
  if (error) throw new Error(error.message || "Vision read failed");
  if (!data.ok) throw new Error(data.error || "Couldn't read the image.");
  return data.data;
}

// Called by the "Try AI barcode reader" button — retries the last failed
// scan photo through the vision-extract Edge Function (barcode mode).
async function retryWithVision() {
  if (!_lastScanFile) return;
  const statusEl = document.getElementById("scannerStatus");
  document.getElementById("scannerVisionFallback").style.display = "none";
  statusEl.style.display = "";
  statusEl.textContent = "Reading barcode with AI…";

  try {
    const { base64, mimeType } = await _compressAndEncode(_lastScanFile);
    const result = await _callVisionExtract(base64, mimeType, "barcode");
    const isbn = (result.isbn || "").replace(/[\s-]/g, "");

    if (/^(\d{13}|\d{9}[\dXx])$/.test(isbn)) {
      statusEl.textContent = "Barcode read: " + isbn + " — looking up…";
      await _onBarcodeDetected(isbn);
    } else {
      statusEl.textContent = "Couldn't read the ISBN. Try scanning the cover or enter manually.";
      document.getElementById("scannerManualEntry").style.display = "";
    }
  } catch (e) {
    console.error("Vision barcode retry failed:", e);
    statusEl.textContent = e.message || "Couldn't read the image. Enter details manually.";
    document.getElementById("scannerManualEntry").style.display = "";
  }
}

// Called by the "Read Book Cover" file input. Sends the cover photo to
// vision-extract (cover mode), searches by the returned title/author,
// and shows candidates for the user to confirm — never silently auto-fills.
async function scanCoverPhoto(input) {
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById("scannerStatus");
  const coverResultsDiv = document.getElementById("scannerCoverResults");
  statusEl.style.display = "";
  statusEl.textContent = "Reading cover…";
  coverResultsDiv.style.display = "none";
  document.getElementById("scannerVisionFallback").style.display = "none";

  try {
    const { base64, mimeType } = await _compressAndEncode(file);
    const result = await _callVisionExtract(base64, mimeType, "cover");

    const title = (result.title || "").trim();
    const author = (result.author || "").trim();
    const isbnRaw = (result.isbn || "").replace(/[\s-]/g, "");

    // High-confidence ISBN on the cover — route straight to barcode flow.
    if (isbnRaw && /^(\d{13}|\d{9}[\dXx])$/.test(isbnRaw) && result.confidence === "high") {
      statusEl.textContent = "ISBN found on cover: " + isbnRaw + " — looking up…";
      await _onBarcodeDetected(isbnRaw);
      return;
    }

    if (!title) {
      statusEl.textContent = "Couldn't read the cover. Try a clearer photo or enter details manually.";
      document.getElementById("scannerManualEntry").style.display = "";
      return;
    }

    const query = [title, author].filter(Boolean).join(" ");
    statusEl.textContent = "Searching: " + [title, author].filter(Boolean).join(" · ") + "…";

    const results = await searchBooksAPI(query);
    if (!results.length) {
      statusEl.textContent = "No matches found. Try entering the ISBN or title manually.";
      document.getElementById("scannerManualEntry").style.display = "";
      return;
    }

    statusEl.textContent = "Select the correct book:";
    coverResultsDiv.style.display = "";
    renderBookSearchResults(results.slice(0, 5), coverResultsDiv, async (book) => {
      coverResultsDiv.style.display = "none";
      statusEl.textContent = "";
      if (book.isbn) {
        // Route confirmed candidate through the existing isbn-lookup flow.
        await _onBarcodeDetected(book.isbn);
      } else {
        // No ISBN available — fill fields directly from search metadata.
        if (_scannerTarget === "sell") {
          await closeBarcodeScanner();
          selectSellBook("", book.title, book.author, book.cover);
        } else if (_scannerTarget === "shelf") {
          await closeBarcodeScanner();
          selectShelfBook("", book.title, book.author, book.cover);
        } else {
          _scannedBookData = { isbn: "", title: book.title, author: book.author, cover_url: book.cover };
          document.getElementById("scannerBookCover").src =
            book.cover || "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=140&h=190&fit=crop";
          document.getElementById("scannerBookTitle").textContent = book.title;
          document.getElementById("scannerBookAuthor").textContent = book.author ? "by " + book.author : "";
          _showScannerState("found");
        }
      }
    });
  } catch (e) {
    console.error("Cover scan failed:", e);
    statusEl.textContent = e.message || "Couldn't read the cover. Enter details manually.";
    document.getElementById("scannerManualEntry").style.display = "";
  } finally {
    input.value = "";
  }
}
