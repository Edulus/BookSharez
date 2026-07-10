// BookSharez app entry (ES module). Module split in progress — plan §5.2:
// js/router.js (hash routing), js/api-lookup.js (external book lookups),
// js/dom-utils.js (escapeHTML), js/book-render.js (the §6A contract), and
// js/scanner.js (barcode/cover scanner + loop metrics) are extracted;
// everything else still lives here and moves out over time.
// Functions referenced from HTML (inline onclick / generated markup) are
// attached to window at the bottom of this file — see the export block.
import { initRouter, setRoute, applyInitialRoute } from "./router.js";
import {
  lookupViaEdgeFunction,
  lookupOpenLibrary,
  lookupGoogleBooks,
  isbn10to13Client,
  searchBooksAPI,
} from "./api-lookup.js";
import { escapeHTML } from "./dom-utils.js";
import {
  FALLBACK_COVER,
  initBookRender,
  formatCondition,
  normalizeBook,
  renderBook,
} from "./book-render.js";
import {
  initScanner,
  loopListingCreated,
  loopListingCancelled,
  openBookScanner, openBarcodeScanner, startLiveCamera, scanFromPhoto,
  scanCoverPhoto, retryWithVision, addScannedBook, addScannedBookAndList,
  scannerReset, closeBarcodeScanner, scannerManualLookup, loopMetricsSummary,
  _compressAndEncode, _callVisionExtract,
} from "./scanner.js";

let isLoggedIn = false;
let currentUser = null;
let currentUserId = null;

// Phase 2 state
let myShelfHave = [];
let myShelfWant = [];
let currentListingShelfEntryId = null;
let currentListingBookId = null; // canonical books.id when the sell modal was pre-filled from a known catalog row
let currentProfileUserId = null;
let currentProfileIsFollowed = false;

// Hash routing lives in js/router.js; page functions are handed to it here.
// External-search books (no catalog id) are deliberately unrouted: their page
// is built from an in-memory object a URL can't reconstruct.
initRouter({
  home: () => showBuyBooks(),
  listing: (id) => viewListing(id),
  book: (id) => browseBookById(id),
  profile: (id) => viewProfile(id),
  members: () => showMembers(),
  dashboard: (tab) => showDashboard(tab),
});

// book-render.js renders tiles/thumbs/the detail page but has no page-nav
// logic of its own; wire its click handlers back into this file's functions.
initBookRender({
  viewListing: (id) => viewListing(id),
  browseBookById: (id, title) => browseBookById(id, title),
  viewExternalBook: (book) => viewExternalBook(book),
  searchByAuthor: (author) => searchByAuthor(author),
  buyBook: (id, price, title) => buyBook(id, price, title),
  openCoverLightbox: (src, title) => openCoverLightbox(src, title),
});

let coverLightboxReturnFocus = null;
let coverLightboxScale = 1;

function setCoverLightboxZoom(scale, originX = 50, originY = 50) {
  const image = document.getElementById("coverLightboxImage");
  coverLightboxScale = Math.min(5, Math.max(1, scale));
  image.style.transformOrigin = `${originX}% ${originY}%`;
  image.style.transform = `scale(${coverLightboxScale})`;
  image.classList.toggle("is-zoomed", coverLightboxScale > 1);
  document.getElementById("coverLightboxZoom").textContent =
    `${Math.round(coverLightboxScale * 100)}%`;
}

function handleCoverLightboxWheel(event) {
  event.preventDefault();
  const image = event.currentTarget;
  const rect = image.getBoundingClientRect();
  const originX = ((event.clientX - rect.left) / rect.width) * 100;
  const originY = ((event.clientY - rect.top) / rect.height) * 100;
  const step = event.deltaY < 0 ? 0.25 : -0.25;
  setCoverLightboxZoom(coverLightboxScale + step, originX, originY);
}

// Request the largest version exposed by common cover providers. If that URL
// fails, the lightbox falls back to the exact cover already shown on the page.
function highResolutionCoverUrl(src) {
  if (!src) return "";
  if (/books\.google\./i.test(src) || /googleusercontent\.com/i.test(src)) {
    try {
      const url = new URL(src, window.location.href);
      url.protocol = "https:";
      url.searchParams.set("zoom", "3");
      url.searchParams.delete("edge");
      return url.href;
    } catch {
      return src;
    }
  }
  if (/covers\.openlibrary\.org/i.test(src)) {
    return src.replace(/-[SM]\.(jpg|png)$/i, "-L.$1").replace(/^http:/, "https:");
  }
  return src.replace(/^http:/, "https:");
}

function openCoverLightbox(src, title = "") {
  if (!src || src === FALLBACK_COVER) return;
  const lightbox = document.getElementById("coverLightbox");
  const image = document.getElementById("coverLightboxImage");
  const heading = document.getElementById("coverLightboxTitle");
  coverLightboxReturnFocus = document.activeElement;
  heading.textContent = title ? `Enlarged cover for ${title}` : "Enlarged book cover";
  image.alt = title ? `Cover of ${title}` : "Enlarged book cover";
  let triedFallback = false;
  image.onerror = () => {
    if (!triedFallback) {
      triedFallback = true;
      image.src = src;
    } else {
      image.onerror = null;
    }
  };
  image.src = highResolutionCoverUrl(src);
  setCoverLightboxZoom(1);
  lightbox.classList.add("is-open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  document.getElementById("coverLightboxClose").focus();
}

function closeCoverLightbox() {
  const lightbox = document.getElementById("coverLightbox");
  if (!lightbox.classList.contains("is-open")) return;
  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
  document.getElementById("coverLightboxImage").src = "";
  setCoverLightboxZoom(1);
  document.body.style.overflow = "";
  coverLightboxReturnFocus?.focus?.();
  coverLightboxReturnFocus = null;
}

// js/scanner.js drives the scanner modal itself; everything that crosses the
// module boundary — catalog writes, shelf refreshes, sell pre-fill, the
// compact search-result picker — is injected here (never imported back).
initScanner({
  ensureBook: (book) => ensureBook(book),
  loadShelfHave: () => loadShelfHave(),
  loadShelfWant: () => loadShelfWant(),
  lookupISBN: () => lookupISBN(),
  lookupShelfISBN: () => lookupShelfISBN(),
  renderBookSearchResults: (results, container, onSelect) =>
    renderBookSearchResults(results, container, onSelect),
  selectSellBook: (isbn, title, author, cover) => selectSellBook(isbn, title, author, cover),
  selectShelfBook: (isbn, title, author, cover) => selectShelfBook(isbn, title, author, cover),
  openSellModalPrefilled: (book, entryId, msg, bookId) =>
    _openSellModalPrefilled(book, entryId, msg, bookId),
});

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
  const coverLightboxImage = document.getElementById("coverLightboxImage");
  coverLightboxImage?.addEventListener("wheel", handleCoverLightboxWheel, { passive: false });
  coverLightboxImage?.addEventListener("dblclick", () => setCoverLightboxZoom(1));
  document.getElementById("coverLightboxClose")?.addEventListener("click", closeCoverLightbox);
  document.getElementById("coverLightbox")?.addEventListener("click", (event) => {
    if (event.target.id === "coverLightbox") closeCoverLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCoverLightbox();
  });
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

  // Content report form (§6.2)
  document
    .getElementById("reportForm")
    .addEventListener("submit", handleSubmitReport);

  // Password reset form (§6.5)
  document
    .getElementById("resetPasswordForm")
    .addEventListener("submit", handleResetPassword);

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
      if (e.target.id === "sellModal") _resetSellLinkage();
    }
    // Close the notifications dropdown on any click outside it (or its bell).
    const notifPanel = document.getElementById("notifPanel");
    const notifBell = document.getElementById("notifBell");
    if (
      notifPanel &&
      notifPanel.style.display !== "none" &&
      !notifPanel.contains(e.target) &&
      !notifBell.contains(e.target)
    ) {
      notifPanel.style.display = "none";
    }
  });

  // Auto-suggest a price the moment a condition is picked, if the seller
  // hasn't typed one yet (vision: "accept or adjust the suggested price").
  // suggestPrice falls back silently to the local algorithm on any failure.
  document.getElementById("bookCondition").addEventListener("change", () => {
    const hasPrice = document.getElementById("bookPrice").value.trim() !== "";
    const hasTitle = document.getElementById("bookTitle").value.trim() !== "";
    if (!hasPrice && hasTitle) suggestPrice();
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

// escapeHTML moved to js/dom-utils.js; normalizeBook / renderBook / the §6A
// contract renderers moved to js/book-render.js (imported at the top of this
// file).

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

// Treat duplicate catalog rows as the same displayed work. Community grids are
// work-centric rather than edition-centric, so matching title + author wins
// even when two members scanned editions with different ISBNs.
function communityBookKey(entry) {
  const book = entry.books || {};
  const normalizeText = (value) => String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const title = normalizeText(book.title);
  const author = normalizeText(book.author);
  if (title && author) return `work:${title}|${author}`;

  // ISBN is the safest fallback when either half of the work identity is
  // missing. Last-resort title/id keys keep incomplete legacy rows stable.
  const isbn = String(book.isbn || "").replace(/[^0-9X]/gi, "").toUpperCase();
  if (isbn) return `isbn:${isbn}`;
  return title ? `title:${title}` : `id:${entry.book_id}`;
}

// Load a community shelf section (want or have) with deduplicated books.
async function loadCommunityShelfSection(shelfType, gridId) {
  const grid = document.getElementById(gridId);
  if (!grid) return;
  grid.innerHTML = '<p style="text-align:center;grid-column:1/-1;color:#888;">Loading…</p>';

  const { data, error } = await supabaseClient
    .from("shelf_entries")
    .select("book_id, books!inner(id, isbn, title, author, cover_url)")
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
    const key = communityBookKey(entry);
    if (!seen.has(key)) {
      seen.add(key);
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

// formatCondition moved to js/book-render.js (imported at the top of this file).

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

// ── One-tap Want/Have on the book page (plan §3.3) ──────────────────────────
// The book page is the canonical hub; building shelf identity from it must be
// one tap, not a detour through the Add Book modal. Duplicates are safe: the
// same user_id+book_id+shelf_type upsert handleAddToShelf uses (shelf_entries
// only — never a books upsert, §6.1; unknown external books go through the
// shared ensureBook select→insert).

function _shelfBtn(shelfType) {
  return document.getElementById(shelfType === "have" ? "detailHaveBtn" : "detailWantBtn");
}

function _setShelfBtnAdded(shelfType) {
  const btn = _shelfBtn(shelfType);
  if (!btn) return;
  btn.disabled = true;
  btn.classList.add("shelf-btn-added");
  btn.innerHTML =
    shelfType === "have"
      ? '<i class="fas fa-check"></i> On “Books I Have”'
      : '<i class="fas fa-check"></i> On “Books I Want”';
}

// Reset both buttons for a fresh book, wire their clicks, then (logged in,
// known catalog book) pre-mark the shelves it's already on. The token guards
// the async pre-check against navigate-away, like every detail-page fill.
function _wireShelfButtons(book, token) {
  [["have", '<i class="fas fa-bookmark"></i> I have this'],
   ["want", '<i class="fas fa-heart"></i> I want this']].forEach(([type, label]) => {
    const btn = _shelfBtn(type);
    if (!btn) return;
    btn.disabled = false;
    btn.classList.remove("shelf-btn-added");
    btn.innerHTML = label;
    btn.onclick = () => addBookToShelf(book, type, token);
  });
  if (isLoggedIn && book.bookId) _markShelfState(book.bookId, token);
}

async function _markShelfState(bookId, token) {
  const { data } = await supabaseClient
    .from("shelf_entries")
    .select("shelf_type")
    .eq("user_id", currentUserId)
    .eq("book_id", bookId);
  if (currentDetailId !== token || !data) return;
  data.forEach((e) => {
    if (e.shelf_type === "have" || e.shelf_type === "want") _setShelfBtnAdded(e.shelf_type);
  });
}

async function addBookToShelf(book, shelfType, token) {
  if (!isLoggedIn) { showLogin(); return; }
  const btn = _shelfBtn(shelfType);
  if (btn) btn.disabled = true;
  let added = false;
  try {
    let bookId = book.bookId || null;
    if (!bookId) {
      if (!book.isbn) {
        // Pre-ISBN external books can't be catalog-matched here (needs the
        // scanner's cover-confirm path, which carries verified metadata).
        alert("This edition has no ISBN — add it with the scanner's cover capture instead.");
        return;
      }
      bookId = await ensureBook({
        isbn: book.isbn,
        title: book.title,
        author: book.author,
        coverUrl: book.coverUrl || null,
      });
    }
    const { data: { user } } = await supabaseClient.auth.getUser();
    const { error } = await supabaseClient
      .from("shelf_entries")
      .upsert(
        { user_id: user.id, book_id: bookId, shelf_type: shelfType },
        { onConflict: "user_id,book_id,shelf_type" }
      );
    if (error) throw error;
    added = true;
    _setShelfBtnAdded(shelfType);
    if (shelfType === "have") loadShelfHave(); else loadShelfWant(); // background refresh
    // The want-count on this very page just changed — repaint it.
    if (shelfType === "want" && token) _loadBookSocial(bookId, token);
  } catch (err) {
    console.error("Failed to add to shelf:", err);
    alert("Sorry, couldn't add to your shelf. Please try again.");
  } finally {
    if (!added && btn) btn.disabled = false;
  }
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
  cover.classList.toggle("cover-zoomable", Boolean(book.coverUrl));
  cover.tabIndex = book.coverUrl ? 0 : -1;
  cover.setAttribute("role", book.coverUrl ? "button" : "img");
  cover.setAttribute("aria-label", book.coverUrl ? `Enlarge cover for ${book.title || "this book"}` : "Book cover unavailable");
  cover.title = book.coverUrl ? "Click to enlarge cover" : "";
  cover.onclick = book.coverUrl ? () => openCoverLightbox(book.coverUrl, book.title) : null;
  cover.onkeydown = book.coverUrl ? (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCoverLightbox(book.coverUrl, book.title);
    }
  } : null;
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
  document.getElementById("detailSellerTrust").textContent = "";
  document.getElementById("detailWantCount").textContent = "";
  document.getElementById("detailGallery").innerHTML = "";
  document.getElementById("detailBuyBtn").style.display = "none";
  document.getElementById("detailReportBtn").style.display = "none";
  document.getElementById("detailDiscussion").style.display = "none";

  // Community offers (primary). Each tile routes to its listing via renderBook.
  renderBookOffers(offers);

  // One-tap Want/Have (§3.3) + affiliate buy links (secondary).
  document.getElementById("detailExternalActions").style.display = "block";
  _wireShelfButtons(book, token);
  renderAffiliateLinks(book);

  // Community want-count + discussion. Use the known catalog id directly, or
  // look it up by ISBN for external books not yet matched to the catalog.
  if (book.bookId) _loadBookSocial(book.bookId, token);
  else enrichExternalBook(book, token);

  // Hardcover enrichment (non-blocking; fills in below the ISBN line).
  runBookEnrichment(book.isbn, token, book.title, book.author);
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

// ─── Book detail enrichment (Hardcover) ─────────────────────────────────────────
// Progressive enhancement: the detail page renders instantly from listing/book
// data, then these sections fill in async. Wired into both detail render paths
// (_renderFull via viewListing, and _renderBookPage). Section styles live in
// css/style.css; the data source is the book-enrichment Edge Function.

function enrichmentPayloadFromBookRow(row) {
  if (!row?.hc_enriched_at) return null;
  return {
    enriched: true,
    source: "public-cache",
    description: row.description ?? null,
    rating: row.hc_rating ?? null,
    ratingCount: row.hc_rating_count ?? null,
    usersRead: row.hc_users_read ?? null,
    genres: Array.isArray(row.hc_genres) ? row.hc_genres : null,
    seriesName: row.hc_series_name ?? null,
    seriesPosition: row.hc_series_pos ?? null,
    category: row.hc_book_category ?? null,
    slug: row.hc_slug ?? null,
    pageCount: row.page_count ?? null,
    publisher: row.publisher ?? null,
    publishDate: row.publish_date ?? null,
    enrichedAt: row.hc_enriched_at,
  };
}

async function fetchPublicCachedEnrichment(isbn) {
  const { data, error } = await supabaseClient
    .from("books")
    .select(
      "description, page_count, publisher, publish_date, hc_rating, " +
      "hc_rating_count, hc_users_read, hc_genres, hc_series_name, " +
      "hc_series_pos, hc_slug, hc_book_category, hc_enriched_at"
    )
    .eq("isbn", isbn)
    .maybeSingle();
  if (error) {
    console.error("Public enrichment cache read failed:", error);
    return null;
  }
  return enrichmentPayloadFromBookRow(data);
}

async function fetchBookEnrichment(isbn, title, author) {
  if (!isbn) return null;
  const cached = await fetchPublicCachedEnrichment(isbn);
  const cacheAge = cached?.enrichedAt
    ? Date.now() - new Date(cached.enrichedAt).getTime()
    : Infinity;
  if (cached && cacheAge < 30 * 24 * 60 * 60 * 1000) return cached;

  // Anonymous visitors may read cached enrichment but cannot spend Hardcover
  // API quota. Only authenticated sessions may refresh stale/missing cache.
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return cached;
  try {
    const resp = await supabaseClient.functions.invoke("book-enrichment", {
      body: { isbn, title, author },
    });
    if (resp.error || !resp.data?.enriched) return cached;
    return resp.data;
  } catch (e) {
    console.error("Enrichment fetch failed:", e);
    return cached;
  }
}

// Kick off enrichment for the book currently on screen. `token` is the value of
// currentDetailId captured at render time; if the user navigates away before
// Hardcover responds we drop the result instead of painting a stale book.
function runBookEnrichment(isbn, token, title, author) {
  const container = document.getElementById("detailEnrichment");
  if (!container) return;
  container.innerHTML = "";
  if (!isbn) return;

  container.innerHTML =
    '<div class="detail-enrichment-skeleton">' +
    '<div class="skeleton-bar"></div>' +
    '<div class="skeleton-bar"></div>' +
    '<div class="skeleton-bar"></div></div>';

  fetchBookEnrichment(isbn, title, author).then((data) => {
    if (currentDetailId !== token) return; // navigated away
    if (!data) {
      container.innerHTML = ""; // graceful degradation — page looks as before
      return;
    }
    renderEnrichment(data);
  });
}

function formatSeriesPos(pos) {
  const n = Number(pos);
  if (!Number.isFinite(n)) return String(pos);
  return Number.isInteger(n) ? String(n) : String(n);
}

// Set the search box to a genre and run a browse search (mirrors searchByAuthor).
function searchByGenre(genre) {
  document.getElementById("homepage").style.display = "block";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("searchInput").value = genre;
  searchBooks();
}

// Build the enrichment sections into #detailEnrichment. Any section whose data
// is null/empty is skipped. User-controlled text is set via textContent.
function renderEnrichment(data) {
  const container = document.getElementById("detailEnrichment");
  if (!container) return;
  container.innerHTML = "";

  // Description with a Read more toggle when long.
  if (data.description) {
    const desc = document.createElement("div");
    desc.className = "detail-book-description";
    const LIMIT = 500;
    const full = data.description;
    if (full.length > LIMIT) {
      const shortText = full.slice(0, LIMIT).trimEnd() + "… ";
      const span = document.createElement("span");
      span.textContent = shortText;
      const toggle = document.createElement("span");
      toggle.className = "read-more-toggle";
      toggle.textContent = "Read more";
      let expanded = false;
      toggle.addEventListener("click", () => {
        expanded = !expanded;
        span.textContent = expanded ? full + " " : shortText;
        toggle.textContent = expanded ? "Show less" : "Read more";
      });
      desc.appendChild(span);
      desc.appendChild(toggle);
    } else {
      desc.textContent = full;
    }
    container.appendChild(desc);
  }

  // Meta row: page count, publisher, year, category.
  const metaParts = [];
  if (data.pageCount) metaParts.push(`${data.pageCount} pages`);
  if (data.publisher) metaParts.push(data.publisher);
  if (data.publishDate) {
    const yr = String(data.publishDate).slice(0, 4);
    if (/^\d{4}$/.test(yr)) metaParts.push(yr);
  }
  if (data.category) metaParts.push(data.category);
  if (metaParts.length) {
    const row = document.createElement("div");
    row.className = "detail-meta-row";
    metaParts.forEach((p) => {
      const pill = document.createElement("span");
      pill.className = "detail-pill";
      pill.textContent = p;
      row.appendChild(pill);
    });
    container.appendChild(row);
  }

  // Community rating (CSS stars).
  if (data.rating != null) {
    const rating = document.createElement("div");
    rating.className = "detail-rating";
    const rounded = Math.round(Number(data.rating));
    const stars = document.createElement("span");
    stars.className = "detail-stars";
    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("span");
      star.className = i <= rounded ? "star-filled" : "star-empty";
      star.textContent = "★";
      stars.appendChild(star);
    }
    rating.appendChild(stars);
    const num = document.createElement("span");
    num.className = "detail-rating-num";
    num.textContent = Number(data.rating).toFixed(1);
    rating.appendChild(num);
    const metaBits = [];
    if (data.ratingCount) metaBits.push(`${data.ratingCount.toLocaleString()} ratings`);
    if (data.usersRead) metaBits.push(`${data.usersRead.toLocaleString()} readers`);
    if (metaBits.length) {
      const meta = document.createElement("span");
      meta.className = "detail-rating-meta";
      meta.textContent = "· " + metaBits.join(" · ");
      rating.appendChild(meta);
    }
    container.appendChild(rating);
  }

  // Genre pills (clickable → browse search).
  if (Array.isArray(data.genres) && data.genres.length) {
    const genres = document.createElement("div");
    genres.className = "detail-genres";
    data.genres.slice(0, 5).forEach((g) => {
      const pill = document.createElement("button");
      pill.className = "detail-genre-pill";
      pill.textContent = g;
      pill.addEventListener("click", () => searchByGenre(g));
      genres.appendChild(pill);
    });
    container.appendChild(genres);
  }

  // Series line.
  if (data.seriesName) {
    const series = document.createElement("div");
    series.className = "detail-series";
    const icon = document.createElement("i");
    icon.className = "fas fa-layer-group";
    series.appendChild(icon);
    const label =
      data.seriesPosition != null
        ? `Book ${formatSeriesPos(data.seriesPosition)} in ${data.seriesName}`
        : `Part of ${data.seriesName}`;
    series.appendChild(document.createTextNode(label));
    container.appendChild(series);
  }

  // Hardcover link now lives in the affiliate buy row (rendered there so it sits
  // alongside Amazon/AbeBooks). Possible only when enrichment matched a slug.
  renderHardcoverBuyLink(data.slug);
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

// Append the Hardcover button to the affiliate buy row. Unlike Amazon/AbeBooks
// (ISBN-pattern search URLs that always resolve), Hardcover needs a catalog
// `slug` from a successful enrichment match — so this renders only when one
// exists, and it arrives async (after renderAffiliateLinks has painted the row).
function renderHardcoverBuyLink(slug) {
  const container = document.getElementById("detailAffiliates");
  if (!container) return;
  const existing = container.querySelector("[data-hc-link]");
  if (existing) existing.remove();
  if (!slug) return;
  const a = document.createElement("a");
  a.className = "affiliate-link";
  a.setAttribute("data-hc-link", "");
  a.href = `https://hardcover.app/books/${slug}`;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.innerHTML = `<i class="fas fa-external-link-alt"></i> ${escapeHTML("View on Hardcover")}`;
  container.appendChild(a);
}

// Show buy books page
function showBuyBooks() {
  setRoute("#/");
  document.getElementById("homepage").style.display = "block";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.querySelector(".hero").scrollIntoView({ behavior: "smooth" });
}

// "How BookSharez Works" step 1 (Register) — already-registered users
// clicking this should land on their shelf, not see a signup form.
function goRegisterOrDashboard() {
  if (isLoggedIn) showDashboard(); else showSignup();
}

function showHomePage() { showBuyBooks(); }

// Show login modal
function showLogin() {
  closeModal("signupModal");
  clearAuthMessage("loginMessage");
  const rememberedEmail = localStorage.getItem("booksharez:login-email");
  const emailInput = document.getElementById("email");
  const rememberInput = document.getElementById("rememberLoginEmail");
  if (rememberedEmail) emailInput.value = rememberedEmail;
  rememberInput.checked = Boolean(rememberedEmail) || rememberInput.checked;
  document.getElementById("loginModal").style.display = "block";
  (rememberedEmail ? document.getElementById("password") : emailInput).focus();
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
    // Arriving from a password-reset email: prompt for the new password.
    if (_event === "PASSWORD_RECOVERY") _openResetPasswordModal();
    // Apply the URL's route only after the first auth state is known, so a
    // direct link to #/dashboard works when a session is restored (and the
    // logged-out homepage reset above doesn't clobber a public deep link).
    applyInitialRoute();
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
    document.getElementById("notifBell").style.display = "inline-flex";
    refreshNotifBadge();
  } else {
    isLoggedIn = false;
    currentUser = null;
    currentUserId = null;
    loginBtn.innerHTML = '<i class="fas fa-user"></i> Login';
    loginBtn.onclick = showLogin;
    logoutBtn.style.display = "none";
    document.getElementById("notifBell").style.display = "none";
    document.getElementById("notifPanel").style.display = "none";
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

  if (document.getElementById("rememberLoginEmail").checked) {
    localStorage.setItem("booksharez:login-email", email);
  } else {
    localStorage.removeItem("booksharez:login-email");
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

// ── Password reset (§6.5) ────────────────────────────────────────────────────
// Request: "Forgot password?" on the login modal emails a reset link
// (redirects back to this site). Completion: Supabase fires the
// PASSWORD_RECOVERY auth event on arrival, which opens the set-new-password
// modal; updateUser({ password }) finishes the job.

async function handleForgotPassword() {
  const email = document.getElementById("email").value.trim();
  if (!email) {
    showAuthMessage("loginMessage", "Enter your email above first, then tap “Forgot password?”.", "error");
    document.getElementById("email").focus();
    return;
  }
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin + location.pathname,
  });
  if (error) {
    console.error("Password reset request failed:", error);
    showAuthMessage("loginMessage", "Couldn't send the reset email right now. Please try again later.", "error");
    return;
  }
  // Same message either way — never leak whether an account exists.
  showAuthMessage("loginMessage", "If an account exists for that email, a reset link is on its way.", "success");
}

function _openResetPasswordModal() {
  closeModal("loginModal");
  clearAuthMessage("resetPasswordMessage");
  document.getElementById("newPassword").value = "";
  document.getElementById("newPasswordConfirm").value = "";
  document.getElementById("resetPasswordModal").style.display = "block";
}

async function handleResetPassword(e) {
  e.preventDefault();
  const pw = document.getElementById("newPassword").value;
  const confirm = document.getElementById("newPasswordConfirm").value;
  if (pw.length < 8) {
    showAuthMessage("resetPasswordMessage", "Password must be at least 8 characters.", "error");
    return;
  }
  if (pw !== confirm) {
    showAuthMessage("resetPasswordMessage", "Passwords do not match.", "error");
    return;
  }
  const { error } = await supabaseClient.auth.updateUser({ password: pw });
  if (error) {
    console.error("Password update failed:", error);
    showAuthMessage("resetPasswordMessage", mapAuthError(error), "error");
    return;
  }
  closeModal("resetPasswordModal");
  e.target.reset();
  alert("Password updated — you're logged in.");
}

// Handle logout. onAuthStateChange resets the UI to the logged-out state.
async function handleLogout() {
  await supabaseClient.auth.signOut();
  // The auth handler already shows the homepage; keep the URL in step so a
  // refresh doesn't try to reopen a login-only page.
  setRoute("#/");
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
// ---------------------------------------------------------------------------
// Notifications (rail: db/notifications.sql — v1 type: want_match)
// ---------------------------------------------------------------------------
// Rows are created server-side by the want-match trigger when someone lists a
// book on the user's Want shelf. The client only reads and marks read.
// Degrades silently if db/notifications.sql isn't applied yet: the badge
// stays hidden and the panel shows a friendly message.

async function refreshNotifBadge() {
  if (!currentUserId) return;
  const { count, error } = await supabaseClient
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", currentUserId)
    .is("read_at", null);
  const badge = document.getElementById("notifBadge");
  if (!badge) return;
  if (error || !count) {
    badge.style.display = "none";
    return;
  }
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.style.display = "flex";
}

function toggleNotifications() {
  const panel = document.getElementById("notifPanel");
  if (panel.style.display === "none") {
    panel.style.display = "block";
    loadNotifications();
  } else {
    panel.style.display = "none";
  }
}

async function loadNotifications() {
  const list = document.getElementById("notifList");
  list.innerHTML = '<p class="notif-empty">Loading…</p>';
  const { data, error } = await supabaseClient
    .from("notifications")
    .select("id, type, subject_type, subject_id, payload, read_at, created_at")
    .eq("user_id", currentUserId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    list.innerHTML = '<p class="notif-empty">Notifications are unavailable right now.</p>';
    return;
  }
  if (!data || !data.length) {
    list.innerHTML =
      '<p class="notif-empty">Nothing yet — when someone lists a book from your Want shelf, you\'ll see it here.</p>';
    return;
  }
  list.innerHTML = "";
  data.forEach((n) => list.appendChild(_renderNotifItem(n)));
}

function _renderNotifItem(n) {
  const item = document.createElement("div");
  item.className = "notif-item" + (n.read_at ? "" : " notif-unread");
  const p = n.payload || {};
  let text;
  if (n.type === "want_match") {
    const price = Number.isFinite(+p.price) ? ` for $${Number(p.price).toFixed(2)}` : "";
    const seller = p.seller_username ? ` by ${escapeHTML(p.seller_username)}` : "";
    text = `<strong>${escapeHTML(p.title || "A book you want")}</strong> was just listed${price}${seller} — it's on your Want shelf.`;
  } else {
    // Future types (interested/follow/mention/…) get renderers as they ship.
    text = escapeHTML(p.title || "New activity");
  }
  item.innerHTML = `<p>${text}</p><span class="notif-time">${_relativeTime(n.created_at)}</span>`;
  item.addEventListener("click", () => _openNotification(n));
  return item;
}

async function _openNotification(n) {
  document.getElementById("notifPanel").style.display = "none";
  if (!n.read_at) {
    // Fire-and-forget; the badge refreshes when the update lands.
    supabaseClient
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", n.id)
      .then(() => refreshNotifBadge());
  }
  if (n.subject_type === "listing") viewListing(n.subject_id);
  else if (n.subject_type === "book") browseBookById(n.subject_id);
  else if (n.subject_type === "profile") viewProfile(n.subject_id);
}

async function markAllNotificationsRead() {
  await supabaseClient
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", currentUserId)
    .is("read_at", null);
  refreshNotifBadge();
  loadNotifications();
}

// ---------------------------------------------------------------------------
// Content reporting (§6.2 — db/reports.sql)
// ---------------------------------------------------------------------------
// Lightweight moderation intake: logged-in users flag a listing / profile /
// discussion post via one shared modal. The snapshot captures what the
// reporter saw, so the report stays actionable if the subject is edited or
// deleted. Clients can only INSERT (RLS); review happens in the dashboard.
// Degrades to a friendly message if db/reports.sql isn't applied yet.

let _reportSubject = null; // { type, id, snapshot }

function openReportModal(subjectType, subjectId, snapshot, label) {
  if (!isLoggedIn) {
    showLogin();
    return;
  }
  _reportSubject = { type: subjectType, id: subjectId, snapshot: snapshot || {} };
  document.getElementById("reportModalTitle").textContent = label || "Report";
  document.getElementById("reportReason").value = "";
  document.getElementById("reportDetails").value = "";
  document.getElementById("reportStatus").textContent = "";
  document.getElementById("reportModal").style.display = "block";
}

async function handleSubmitReport(e) {
  e.preventDefault();
  if (!_reportSubject) return;
  const statusEl = document.getElementById("reportStatus");
  const reason = document.getElementById("reportReason").value;
  if (!reason) {
    statusEl.textContent = "Pick a reason first.";
    return;
  }
  statusEl.textContent = "Submitting…";

  const { error } = await supabaseClient.from("reports").insert({
    reporter_id: currentUserId,
    subject_type: _reportSubject.type,
    subject_id: _reportSubject.id,
    reason,
    details: document.getElementById("reportDetails").value.trim() || null,
    snapshot: _reportSubject.snapshot,
  });

  if (error && error.code === "23505") {
    statusEl.textContent = "You've already reported this — thank you.";
    return;
  }
  if (error) {
    console.error("Report failed:", error);
    statusEl.textContent = "Couldn't submit the report right now. Please try again later.";
    return;
  }
  closeModal("reportModal");
  _reportSubject = null;
  alert("Thanks — a moderator will take a look.");
}

// Generated-markup entry point for discussion posts (UUID args only — the
// text excerpt is read from the DOM to avoid HTML-quoting bugs).
function reportDiscussionPost(postId, authorId) {
  const postEl = document.querySelector(`.discussion-post[data-id="${postId}"] .discussion-post-body`);
  openReportModal(
    "discussion_post",
    postId,
    { owner_id: authorId, excerpt: (postEl ? postEl.textContent : "").slice(0, 300) },
    "Report post"
  );
}

const DASHBOARD_TABS = ["shelf-have", "shelf-want", "listings", "profile"];

// `tab` is optional; non-string values (e.g. the MouseEvent from
// `loginBtn.onclick = showDashboard`) and unknown names fall back to the
// default tab.
function showDashboard(tab) {
  if (!isLoggedIn) {
    showLogin();
    return;
  }
  document.getElementById("homepage").style.display = "none";
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  showDashboardTab(DASHBOARD_TABS.includes(tab) ? tab : "shelf-have");
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
  // Push when arriving at the dashboard, replace when switching tabs inside it.
  setRoute("#/dashboard/" + tabName, location.hash.startsWith("#/dashboard"));
  activateDashboardTab(tabName);
  if (tabName === "shelf-have") loadShelfHave();
  else if (tabName === "shelf-want") loadShelfWant();
  else if (tabName === "listings") loadUserListings();
  else if (tabName === "profile") loadProfileSettings();
}

// Handle sell book form
// ISBN auto-fill: calls the isbn-lookup Edge Function (cache → optional ISBNdb →
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
  _resetSellLinkage(); // a fresh ISBN lookup replaces any pre-filled shelf link
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
// lookupViaEdgeFunction / lookupOpenLibrary / lookupGoogleBooks moved to
// js/api-lookup.js (imported at the top of this file).

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

  // Primary: Edge Function (cache → optional ISBNdb → Google Books, server-side).
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

  // Validate (DB also enforces these via CHECK constraints). A known catalog
  // book id (pre-filled from shelf / Add & List) stands in for the ISBN —
  // pre-ISBN era books have none and are still listable.
  if (!currentListingBookId && !/^(\d{13}|\d{9}[\dXx])$/.test(isbn)) {
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
    const bookId =
      currentListingBookId || (await ensureBook({ isbn, title, author, coverUrl }));
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

    // metric: an Add & List flow completed — the seller actually submitted.
    loopListingCreated();

    // Photos must be uploaded AFTER the listing exists: the Storage + table RLS
    // policies require the path's first folder to be a listing the user owns.
    const photoWarning = await uploadListingPhotos(listing.id, photos);

    closeModal("sellModal");
    e.target.reset();
    _resetSellLinkage();
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
      // Do not leave an object behind when its metadata row cannot be saved.
      const { error: cleanupErr } = await supabaseClient.storage
        .from("listing-photos")
        .remove([path]);
      if (cleanupErr) console.error("Failed to roll back photo upload:", cleanupErr);
      hadFailure = true;
    }
  }

  return hadFailure;
}

// Remove a listing's private Storage objects before its DB row disappears or
// becomes sold. Storage is not covered by Postgres ON DELETE CASCADE, and the
// DELETE policy needs the owning listing row to exist while removal happens.
async function cleanupListingPhotos(listingId) {
  const { data: photos, error: loadErr } = await supabaseClient
    .from("listing_photos")
    .select("photo_url")
    .eq("listing_id", listingId);
  if (loadErr) {
    console.error("Photo cleanup lookup failed:", loadErr);
    return false;
  }

  const paths = (photos || []).map((photo) => photo.photo_url).filter(Boolean);
  if (paths.length > 0) {
    const { error: storageErr } = await supabaseClient.storage
      .from("listing-photos")
      .remove(paths);
    if (storageErr) {
      console.error("Photo Storage cleanup failed:", storageErr);
      return false;
    }
  }

  // Needed for sold listings, which remain in the DB. Delete listings cascade
  // these rows, but doing it here makes the helper safe for both paths.
  const { error: rowsErr } = await supabaseClient
    .from("listing_photos")
    .delete()
    .eq("listing_id", listingId);
  if (rowsErr) {
    console.error("Photo metadata cleanup failed:", rowsErr);
    return false;
  }
  return true;
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
          loading="lazy" onerror="this.style.display='none'">
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
    .detail-seller-trust {
      color: #999;
      font-size: 0.82rem;
      margin: -0.25rem 0 0.75rem;
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
    .detail-shelf-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .detail-shelf-actions .btn {
      min-height: 44px;
    }
    /* .btn-secondary is white-outline (built for the purple header) —
       restyle it for the white page so "I want this" is actually visible. */
    .detail-shelf-actions .btn-secondary {
      background: white;
      color: #667eea;
      border: 2px solid #667eea;
    }
    .detail-shelf-actions .btn-secondary:hover {
      background: #f0f2ff;
    }
    .detail-shelf-actions .btn.shelf-btn-added {
      background: #e8f5e9;
      color: #2e7d32;
      border: 1px solid #a5d6a7;
      cursor: default;
      opacity: 1;
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
  setRoute("#/listing/" + encodeURIComponent(listingId));
  ensureDetailStyles();
  const detail = document.getElementById("bookDetail");

  // Show the detail page immediately with a loading state.
  document.getElementById("homepage").style.display = "none";
  document.getElementById("dashboard").style.display = "none";
  detail.style.display = "block";
  document.getElementById("detailEnrichment").innerHTML = "";
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
    document.getElementById("detailReportBtn").style.display = "none";
    return;
  }

  currentDetailId = data.id;
  renderBook(normalizeBook(data), {
    myListingId: data.id,
    price: data.price,
    condition: data.condition,
    description: data.description,
    isListedLocally: true,
  }, "full");

  // Report link (§6.2) — for other people's listings only
  const reportBtn = document.getElementById("detailReportBtn");
  if (currentUserId && currentUserId !== data.user_id) {
    reportBtn.style.display = "inline-flex";
    reportBtn.onclick = () =>
      openReportModal("listing", data.id, {
        owner_id: data.user_id,
        title: data.books?.title || null,
        isbn: data.books?.isbn || null,
        price: data.price,
      }, "Report listing");
  } else {
    reportBtn.style.display = "none";
  }

  // Hardcover enrichment (non-blocking; fills in below the ISBN line).
  runBookEnrichment(data.books?.isbn, data.id, data.books?.title, data.books?.author);

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

  // Show seller name + trust signals (§3.2: member-since, shelf size,
  // follower count, active listings — reader identity, not just a name).
  // Async; page is already visible. Guarded on data.id like the want-count
  // fetch above, so a fast navigate-away can't paint a stale listing.
  const sellerEl = document.getElementById("detailSeller");
  const trustEl = document.getElementById("detailSellerTrust");
  if (sellerEl && data.user_id) {
    sellerEl.textContent = "Sold by a BookSharez seller";
    const sellerId = data.user_id;
    Promise.all([
      supabaseClient.from("profiles").select("username, created_at").eq("id", sellerId).maybeSingle(),
      supabaseClient.from("shelf_entries").select("*", { count: "exact", head: true }).eq("user_id", sellerId),
      supabaseClient.from("follows").select("*", { count: "exact", head: true }).eq("followed_id", sellerId),
      supabaseClient.from("listings").select("*", { count: "exact", head: true }).eq("user_id", sellerId).eq("status", "active"),
    ]).then(([profileRes, shelfRes, followerRes, listingsRes]) => {
      if (currentDetailId !== data.id) return;
      const profile = profileRes.data;
      const name = profile?.username || "BookSharez seller";
      sellerEl.innerHTML =
        `Sold by <a href="#" onclick="viewProfile('${sellerId}'); return false;"
          style="color:#667eea;">${escapeHTML(name)}</a>`;
      if (!trustEl) return;
      const parts = [];
      if (profile?.created_at) parts.push("Member since " + _formatMemberSince(profile.created_at));
      const shelfCount = shelfRes.count || 0;
      if (shelfCount) parts.push(`${shelfCount} book${shelfCount === 1 ? "" : "s"} on shelf`);
      const followerCount = followerRes.count || 0;
      if (followerCount) parts.push(`${followerCount} follower${followerCount === 1 ? "" : "s"}`);
      const listingCount = listingsRes.count || 0;
      if (listingCount) parts.push(`${listingCount} active listing${listingCount === 1 ? "" : "s"}`);
      trustEl.textContent = parts.join(" · ");
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
    img.loading = "lazy";
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
    // UUID args only — reportDiscussionPost reads the excerpt from the DOM
    const report = !isOwn && isLoggedIn
      ? `<button type="button" class="discussion-report" onclick="reportDiscussionPost('${p.id}', '${p.user_id}')">` +
        `<i class="fas fa-flag"></i> Report</button>`
      : "";
    return `<div class="discussion-post" data-id="${p.id}">
      <div class="discussion-post-header">
        <a href="#" class="discussion-username"
           onclick="viewProfile('${p.user_id}'); return false;">${name}</a>
        <span class="discussion-time">${time}</span>
        ${del}${report}
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

// "Member since Jul 2026" — coarser than _relativeTime on purpose; a seller
// trust signal cares about tenure, not precise recency.
function _formatMemberSince(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", year: "numeric" });
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
  setRoute("#/");
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("homepage").style.display = "block";
  document.getElementById("detailEnrichment").innerHTML = "";
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
  const photosRemoved = await cleanupListingPhotos(listingId);
  await loadUserListings();
  loadFeaturedBooks();
  alert(photosRemoved
    ? "Marked as sold."
    : "Marked as sold, but some photo cleanup failed. Delete the listing later to retry cleanup.");
}

// Delete a listing for good.
async function deleteListing(listingId) {
  if (!confirm("Are you sure you want to delete this listing?")) return;

  if (!(await cleanupListingPhotos(listingId))) {
    alert("Couldn't remove the listing photos, so the listing was not deleted. Please try again.");
    return;
  }

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
  if (modalId === "sellModal") _resetSellLinkage();
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
  setRoute("#/");
  document.getElementById("homepage").style.display = "block";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("searchInput").value = author;
  searchBooks();
}

function browseBook(isbn, title) {
  setRoute("#/");
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
  setRoute("#/book/" + encodeURIComponent(bookId));
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

// isbn10to13Client / searchGoogleBooks / searchOpenLibrary / searchBooksAPI
// moved to js/api-lookup.js (imported at the top of this file).

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
    img.loading = "lazy";
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
  _resetSellLinkage(); // a different book replaces any pre-filled shelf link
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

// Build one shelf tile (cover, title/author, management actions) for the Have /
// Want shelves. Laid out in a horizontal .shelf-grid so a shelf reads like a row
// of books, not a column of full-width cards. `isListed` only applies to "have".
function _renderShelfTile(book, entryId, shelfType, isListed) {
  const card = document.createElement("div");
  card.className = "shelf-card";

  const coverWrap = document.createElement("div");
  coverWrap.className = "shelf-cover-wrap";

  const img = document.createElement("img");
  img.className = "shelf-cover";
  img.loading = "lazy";
  img.src = book.cover_url || "";
  img.alt = book.title || "";
  img.onerror = () => { img.src = FALLBACK_COVER; };
  coverWrap.appendChild(img);

  if (isListed) {
    const badge = document.createElement("div");
    badge.textContent = "For Sale";
    badge.style.cssText =
      "position:absolute;top:4px;right:4px;background:rgba(102,126,234,0.92);" +
      "color:#fff;font-size:0.6rem;font-weight:700;padding:2px 5px;" +
      "border-radius:4px;line-height:1.3;white-space:nowrap;";
    coverWrap.appendChild(badge);
  }
  coverWrap.addEventListener("click", () => browseBookById(book.id, book.title));

  const info = document.createElement("div");
  info.className = "shelf-card-info";
  info.innerHTML = `
    <h4>${escapeHTML(book.title)}</h4>
    <p>${escapeHTML(book.author || "")}</p>
  `;

  const actions = document.createElement("div");
  actions.className = "shelf-card-actions";
  actions.innerHTML = `
    ${shelfType === "have" && !isListed
      ? `<button class="btn btn-primary btn-small" onclick="listShelfItemForSale('${entryId}')">
           <i class="fas fa-tags"></i> List for Sale
         </button>`
      : ""}
    <button class="btn btn-secondary btn-small" onclick="removeFromShelf('${entryId}','${shelfType}')">
      <i class="fas fa-times"></i> Remove
    </button>
  `;

  card.appendChild(coverWrap);
  card.appendChild(info);
  card.appendChild(actions);
  return card;
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
  const grid = document.createElement("div");
  grid.className = "shelf-grid";
  myShelfHave.forEach((entry) => {
    const book = entry.books || {};
    const isListed = listedBookIds.has(book.id);
    grid.appendChild(_renderShelfTile(book, entry.id, "have", isListed));
  });
  container.appendChild(grid);
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
  const grid = document.createElement("div");
  grid.className = "shelf-grid";
  myShelfWant.forEach((entry) => {
    grid.appendChild(_renderShelfTile(entry.books || {}, entry.id, "want", false));
  });
  container.appendChild(grid);
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
  _openSellModalPrefilled(book, shelfEntryId, "Book pre-filled from shelf ✓", book.id || null);
}

// Pre-fill and open the sell modal for a shelf-linked book. Used by the shelf
// "List for Sale" button and the scanner's Add & List path. Condition and
// price start empty on purpose — the seller must confirm them to submit.
// The pre-fill linkage must never outlive the pre-filled book: stale ids
// would silently attach the next listing to the wrong shelf entry / catalog
// row. Cleared on modal close and whenever the form's book changes.
function _resetSellLinkage() {
  currentListingShelfEntryId = null;
  currentListingBookId = null;
  loopListingCancelled(); // cancelled/abandoned Add & List is not a created listing
}

// bookId (when known) lets handleSellBook skip the ISBN-keyed ensureBook —
// which is also what makes no-ISBN books listable.
function _openSellModalPrefilled(book, shelfEntryId, statusMsg, bookId = null) {
  currentListingShelfEntryId = shelfEntryId;
  currentListingBookId = bookId;
  document.getElementById("bookISBN").value = book.isbn || "";
  document.getElementById("bookTitle").value = book.title || "";
  document.getElementById("bookAuthor").value = book.author || "";
  document.getElementById("bookCondition").value = "";
  document.getElementById("bookPrice").value = "";
  document.getElementById("bookDescription").value = "";
  pendingCover = { isbn: book.isbn || null, url: book.cover_url || null };
  showSellCoverPreview(book.cover_url || null, book.title || "");

  document.getElementById("sellSearchQuery").value = book.title || "";
  document.getElementById("sellSearchStatus").textContent = statusMsg;
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
  setRoute("#/profile/" + encodeURIComponent(userId));
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
      .select("id, books!inner(id, isbn, title, author, cover_url)")
      .eq("user_id", userId).eq("shelf_type", "have").eq("visibility", "public")
      .order("added_at", { ascending: false }).limit(24),
    supabaseClient
      .from("shelf_entries")
      .select("id, books!inner(id, isbn, title, author, cover_url)")
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

  // Follow + report buttons — only for other users when logged in
  const profileReportBtn = document.getElementById("profileReportBtn");
  if (isLoggedIn && currentUserId && currentUserId !== userId) {
    profileReportBtn.style.display = "inline-flex";
    profileReportBtn.onclick = () =>
      openReportModal("profile", userId, { username: profile?.username || null }, "Report user");
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
  } else {
    profileReportBtn.style.display = "none";
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
  setRoute("#/");
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("homepage").style.display = "block";
  currentProfileUserId = null;
}

// Member directory ("How BookSharez Works" step 5, Explore Profiles). Public
// profiles only (visibility='public', RLS: "Anyone can view profiles" already
// allows this select — no schema change needed) with a username set, so
// blank just-signed-up rows don't clutter the list.
async function showMembers() {
  setRoute("#/members");
  document.getElementById("homepage").style.display = "none";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("membersPage").style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });

  const grid = document.getElementById("membersGrid");
  const status = document.getElementById("membersStatus");
  grid.innerHTML = "";
  status.textContent = "Loading members…";

  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, username, bio")
    .eq("visibility", "public")
    .not("username", "is", null)
    .order("username")
    .limit(48);

  if (error) {
    console.error("Members load failed:", error);
    status.textContent = "Couldn't load members. Please try again.";
    return;
  }
  if (!data || !data.length) {
    status.textContent = "No members to show yet.";
    return;
  }
  status.textContent = "";
  grid.innerHTML = data
    .map(
      (p) => `
    <div class="member-card" data-user-id="${escapeHTML(p.id)}">
      <div class="member-avatar">${escapeHTML(p.username[0].toUpperCase())}</div>
      <div class="member-name">${escapeHTML(p.username)}</div>
      ${p.bio ? `<div class="member-bio">${escapeHTML(p.bio)}</div>` : ""}
    </div>`
    )
    .join("");
  grid.querySelectorAll(".member-card").forEach((card) => {
    card.addEventListener("click", () => viewProfile(card.dataset.userId));
  });
}

function backFromMembers() {
  setRoute("#/");
  document.getElementById("membersPage").style.display = "none";
  document.getElementById("homepage").style.display = "block";
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
// Barcode / cover scanner + loop metrics live in js/scanner.js (plan §5.2).
// ─────────────────────────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// window exports
// ---------------------------------------------------------------------------
// This file is an ES module (module scope, not global scope), but the HTML
// still calls functions by name: inline onclick/onchange/onkeydown attributes
// in index.html, onclick strings in generated markup, and the Playwright
// verify harnesses via page.evaluate. Every such function must be attached to
// window here. When an inline handler is converted to addEventListener,
// delete its line from this block too.
Object.assign(window, {
  // header / nav / auth
  showHomePage, showBuyBooks, showSellModal, showLogin, showSignup,
  goRegisterOrDashboard,
  handleLogout, showDashboard, showDashboardTab, closeModal,
  handleForgotPassword,
  // internal, but invoked by verify-security.js to simulate PASSWORD_RECOVERY
  _openResetPasswordModal,
  // notifications
  toggleNotifications, markAllNotificationsRead,
  // browse / search / detail
  searchBooks, showMoreSearchResults, applyControls, backToBrowse,
  viewListing, browseBookById, browseBook, viewProfile, backFromProfile,
  showMembers, backFromMembers,
  searchByAuthor, searchByGenre, viewExternalBook,
  buyBook, submitDiscussionPost, deleteDiscussionPost, toggleFollow,
  reportDiscussionPost,
  // sell / shelf
  lookupISBN, suggestPrice, showAddToShelfModal, searchShelfBooks,
  searchSellBooks, lookupShelfISBN, editListing, markAsSold, deleteListing,
  removeFromShelf, listShelfItemForSale,
  // scanner (imported from js/scanner.js)
  openBookScanner, openBarcodeScanner, startLiveCamera, scanFromPhoto,
  scanCoverPhoto, retryWithVision, addScannedBook, addScannedBookAndList,
  scannerReset, closeBarcodeScanner, scannerManualLookup,
  // loop metrics (debug: run loopMetricsSummary() in the console)
  loopMetricsSummary,
  // internal, but probed by verify-vision.js
  _compressAndEncode, _callVisionExtract,
});
