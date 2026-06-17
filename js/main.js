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
  loadFeaturedBooks();
  setupEventListeners();
  initAuth();
});

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

let displayedListings = []; // normalized cards currently shown in the grid
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

// Map a Supabase {listing + books} row to the shape createBookCard expects.
function normalizeListing(row) {
  const book = row.books || {};
  return {
    type: "local",
    id: row.id,
    title: book.title,
    author: book.author,
    price: row.price,
    condition: row.condition,
    image: book.cover_url,
    isbn: book.isbn,
  };
}

function showGridMessage(message) {
  document.getElementById("booksGrid").innerHTML =
    '<p style="text-align:center;grid-column:1/-1;color:#666;">' +
    escapeHTML(message) +
    "</p>";
}

function renderListings(rows) {
  const booksGrid = document.getElementById("booksGrid");
  displayedListings = (rows || []).map(normalizeListing);
  if (displayedListings.length === 0) {
    showGridMessage("No books found.");
    return;
  }
  booksGrid.innerHTML = "";
  displayedListings.forEach((book) =>
    booksGrid.appendChild(createBookCard(book))
  );
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
    loadFeaturedBooks();
  }
}

// Load active listings into the homepage grid.
async function loadFeaturedBooks() {
  const sectionTitle = document.getElementById("featuredTitle");
  if (sectionTitle) sectionTitle.textContent = "Featured Books";
  const sub = document.querySelector(".search-subtitle");
  if (sub) sub.remove();
  showGridMessage("Loading books…");
  setViewMoreBtn(false);

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

// Create book card element
function createBookCard(book) {
  const card = document.createElement("div");
  card.className = "book-card";
  card.onclick = () => viewListing(book.id);
  const priceNum = Number(book.price);
  const priceLabel = Number.isFinite(priceNum) ? `$${priceNum.toFixed(2)}` : "";
  card.innerHTML = `
    <div class="book-image">
      <img src="${escapeHTML(book.image)}" alt="${escapeHTML(
    book.title
  )}" onerror="this.src='https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=300&h=400&fit=crop'">
      <div class="book-condition">${formatCondition(book.condition)}</div>
    </div>
    <div class="book-info">
      <h3 class="book-title">${escapeHTML(book.title)}</h3>
      <p class="book-author">by ${escapeHTML(book.author)}</p>
      <div class="book-footer">
        <span class="book-price">${priceLabel}</span>
        <button class="btn btn-primary btn-small" onclick="event.stopPropagation(); buyBook('${book.id}')">
          <i class="fas fa-cart-plus"></i> Buy Now
        </button>
      </div>
      <p class="book-seller">
        <i class="fas fa-check-circle" style="color:#28a745;"></i>
        Available from a BookSharez seller
      </p>
    </div>
  `;

  // Add CSS for book cards
  if (!document.querySelector("#bookCardStyles")) {
    const style = document.createElement("style");
    style.id = "bookCardStyles";
    style.textContent = `
      .book-card {
        background: white;
        border-radius: 15px;
        overflow: hidden;
        box-shadow: 0 5px 20px rgba(0,0,0,0.1);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        cursor: pointer;
      }
      
      .book-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 10px 30px rgba(0,0,0,0.15);
      }
      
      .book-image {
        position: relative;
        height: 250px;
        overflow: hidden;
      }
      
      .book-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      .book-condition {
        position: absolute;
        top: 10px;
        right: 10px;
        background: rgba(102, 126, 234, 0.9);
        color: white;
        padding: 0.25rem 0.5rem;
        border-radius: 12px;
        font-size: 0.8rem;
        font-weight: 500;
      }
      
      .book-info {
        padding: 1.5rem;
      }
      
      .book-title {
        font-size: 1.2rem;
        margin-bottom: 0.5rem;
        color: #333;
        font-weight: 600;
      }
      
      .book-author {
        color: #666;
        margin-bottom: 1rem;
        font-style: italic;
      }
      
      .book-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.5rem;
      }
      
      .book-price {
        font-size: 1.4rem;
        font-weight: bold;
        color: #667eea;
      }
      
      .btn-small {
        padding: 0.5rem 1rem;
        font-size: 0.9rem;
      }
      
      .book-seller {
        color: #888;
        font-size: 0.9rem;
        margin-top: 0.5rem;
      }
    `;
    document.head.appendChild(style);
  }

  return card;
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
    loadFeaturedBooks();
    return;
  }

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

  // Local results first, normalised.
  const localNormalized = (localData || []).map(normalizeListing);
  displayedListings = localNormalized; // keeps buyBook() working

  // External: only books not already represented by a local listing.
  const localISBNs = new Set(localNormalized.map((r) => r.isbn).filter(Boolean));
  const externalNormalized = apiBooks
    .filter((b) => !localISBNs.has(b.isbn))
    .map((b) => ({
      type: "external",
      id: b.isbn,
      isbn: b.isbn,
      title: b.title,
      author: b.author,
      image: b.cover,
      year: b.year,
      buyLink: b.buyLink,
    }));

  allSearchResults = [...localNormalized, ...externalNormalized];
  searchResultsLoaded = 0;

  // Update the section title with a source breakdown.
  const subtitle = localNormalized.length > 0
    ? `${localNormalized.length} on BookSharez · ${externalNormalized.length} online`
    : externalNormalized.length > 0
      ? `${externalNormalized.length} results online`
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
  page.forEach((result) => {
    grid.appendChild(
      result.type === "local"
        ? createBookCard(result)
        : createExternalBookCard(result)
    );
  });
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

// Card for a book that has no local listing — links out to an external source.
function createExternalBookCard(book) {
  const card = document.createElement("div");
  card.className = "book-card";
  card.style.opacity = "0.85";
  card.innerHTML = `
    <div class="book-image">
      <img src="${escapeHTML(book.image || "")}" alt="${escapeHTML(book.title)}"
        onerror="this.src='https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=300&h=400&fit=crop'">
      <div class="book-condition" style="background:rgba(108,117,125,0.85);">Not listed locally</div>
    </div>
    <div class="book-info">
      <h3 class="book-title">${escapeHTML(book.title)}</h3>
      <p class="book-author">by ${escapeHTML(book.author || "")}${book.year ? " <span style='color:#aaa;font-size:0.85em;'>(" + escapeHTML(book.year) + ")</span>" : ""}</p>
      <div class="book-footer" style="margin-bottom:0.5rem;">
        <span class="book-price" style="font-size:1rem;color:#aaa;">No local seller yet</span>
        ${book.buyLink
          ? `<a href="${escapeHTML(book.buyLink)}" target="_blank" rel="noopener noreferrer"
               class="btn btn-secondary btn-small">
               <i class="fas fa-external-link-alt"></i> Find online
             </a>`
          : ""}
      </div>
      <p class="book-seller" style="color:#bbb;font-size:0.8rem;">
        <i class="fas fa-info-circle"></i> Not yet available on BookSharez
      </p>
    </div>
  `;
  return card;
}

// Show buy books page
function showBuyBooks() {
  document.getElementById("homepage").style.display = "block";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.querySelector(".hero").scrollIntoView({ behavior: "smooth" });
}

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
}

// isbn-lookup Edge Function — primary lookup path. Returns the book if found,
// null if not found, or throws if the function itself is unreachable.
async function lookupViaEdgeFunction(isbn) {
  const { data, error } = await supabaseClient.functions.invoke("isbn-lookup", {
    body: { isbn },
  });
  if (error) throw new Error(`isbn-lookup function error: ${error.message}`);
  if (!data.found) return null;
  const b = data.book;
  return { title: b.title || "", author: b.author || "", cover: b.coverUrl };
}

// Client-side fallback pipeline — used only if the Edge Function is unreachable.
// These are keyless/free sources, so calling them from the browser is fine.
async function lookupOpenLibrary(isbn) {
  const res = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`
  );
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
  const res = await fetch(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&country=US`
  );
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
  if (photos.length < 3 || photos.length > 5) {
    alert("Please add between 3 and 5 photos of your book.");
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
    alert(
      photoWarning
        ? "Book listed, but some photos didn't upload. You can edit the listing later."
        : "Book listed successfully!"
    );
    showBuyBooks(); // back to the homepage...
    loadFeaturedBooks(); // ...where the new listing now appears
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
    .select("id, price, condition, status, description, books!inner(title, author)")
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
      <div class="listing-info">
        <h4>${escapeHTML(book.title)}</h4>
        <p>by ${escapeHTML(book.author)}</p>
        <p>Condition: ${formatCondition(row.condition)}</p>
        <p class="listing-price">${priceLabel}</p>
        <p>Status: ${escapeHTML(row.status)}</p>
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

  // Add CSS for listing cards if not already added
  if (!document.querySelector("#listingCardStyles")) {
    const style = document.createElement("style");
    style.id = "listingCardStyles";
    style.textContent = `
      .listing-card {
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 10px;
        padding: 1.5rem;
        margin-bottom: 1rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      
      .listing-info h4 {
        margin-bottom: 0.5rem;
        color: #333;
      }
      
      .listing-info p {
        margin: 0.25rem 0;
        color: #666;
      }
      
      .listing-price {
        font-weight: bold;
        color: #667eea !important;
        font-size: 1.2rem;
      }
      
      .listing-actions {
        display: flex;
        gap: 0.5rem;
      }
    `;
    document.head.appendChild(style);
  }
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
    @media (max-width: 700px) {
      .detail-layout {
        grid-template-columns: 1fr;
      }
      .detail-cover {
        max-width: 280px;
        margin: 0 auto;
      }
    }
  `;
  document.head.appendChild(style);
}

// Book detail page: fetch the full listing by id and show it as a toggled
// "page" (same display-toggle approach as homepage/dashboard; no routing).
async function viewListing(listingId) {
  ensureDetailStyles();
  const detail = document.getElementById("bookDetail");
  const fallbackCover =
    "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=400&h=600&fit=crop";

  // Show the detail page immediately with a loading state.
  document.getElementById("homepage").style.display = "none";
  document.getElementById("dashboard").style.display = "none";
  detail.style.display = "block";
  window.scrollTo({ top: 0, behavior: "smooth" });

  const { data, error } = await supabaseClient
    .from("listings")
    .select(
      "id, user_id, price, condition, created_at, description, books!inner(title, author, cover_url, isbn)"
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
    document.getElementById("detailBuyBtn").style.display = "none";
    return;
  }

  currentDetailId = data.id;
  const book = data.books || {};
  const priceNum = Number(data.price);

  const cover = document.getElementById("detailCover");
  cover.src = book.cover_url || fallbackCover;
  cover.onerror = () => {
    cover.src = fallbackCover;
  };

  document.getElementById("detailTitle").textContent = book.title || "Untitled";
  document.getElementById("detailAuthor").textContent = book.author
    ? "by " + book.author
    : "";
  document.getElementById("detailIsbn").textContent = book.isbn
    ? "ISBN: " + book.isbn
    : "";
  document.getElementById("detailCondition").textContent = formatCondition(
    data.condition
  );
  document.getElementById("detailPrice").textContent = Number.isFinite(priceNum)
    ? "$" + priceNum.toFixed(2)
    : "";
  document.getElementById("detailDescription").textContent =
    data.description || "No description provided.";
  document.getElementById("detailBuyBtn").style.display = "inline-flex";

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

// Return from the detail page to the browse grid.
function backToBrowse() {
  document.getElementById("bookDetail").style.display = "none";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("homepage").style.display = "block";
  currentDetailId = null;
}

function buyBook(listingId) {
  if (!isLoggedIn) {
    alert("Please login first to buy books");
    showLogin();
    return;
  }

  const book = displayedListings.find((b) => b.id === listingId);
  if (!book) return;

  const priceLabel = `$${Number(book.price).toFixed(2)}`;
  if (confirm(`Are you sure you want to buy "${book.title}" for ${priceLabel}?`)) {
    alert(
      "Purchase successful! You will receive shipping information via email."
    );
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
function browseBook(isbn, title) {
  const term = isbn || title;
  document.getElementById("homepage").style.display = "block";
  document.getElementById("dashboard").style.display = "none";
  document.getElementById("profilePage").style.display = "none";
  document.getElementById("searchInput").value = term;
  searchBooks();
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
    card.innerHTML = `
      <div style="display:flex;gap:1rem;align-items:center;cursor:pointer;"
        onclick="browseBook(${JSON.stringify(escapeHTML(book.isbn))}, ${JSON.stringify(escapeHTML(book.title))})">
        <img src="${escapeHTML(book.cover_url || "")}" alt="${escapeHTML(book.title)}"
          onerror="this.src='https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=60&h=80&fit=crop'"
          style="width:50px;height:70px;object-fit:cover;border-radius:6px;flex-shrink:0;" />
        <div>
          <h4 style="margin:0 0 0.2rem;">${escapeHTML(book.title)}</h4>
          <p style="margin:0;color:#666;font-style:italic;">${escapeHTML(book.author || "")}</p>
          ${isListed ? '<span style="color:#28a745;font-size:0.85rem;"><i class="fas fa-tag"></i> Listed for sale</span>' : ""}
        </div>
      </div>
      <div class="listing-actions">
        ${!isListed
          ? `<button class="btn btn-primary btn-small" onclick="listShelfItemForSale('${entry.id}')">
               <i class="fas fa-tags"></i> List for Sale
             </button>`
          : ""}
        <button class="btn btn-secondary btn-small" onclick="removeFromShelf('${entry.id}','have')">
          <i class="fas fa-times"></i> Remove
        </button>
      </div>
    `;
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
    card.innerHTML = `
      <div style="display:flex;gap:1rem;align-items:center;cursor:pointer;"
        onclick="browseBook(${JSON.stringify(escapeHTML(book.isbn))}, ${JSON.stringify(escapeHTML(book.title))})">
        <img src="${escapeHTML(book.cover_url || "")}" alt="${escapeHTML(book.title)}"
          onerror="this.src='https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=60&h=80&fit=crop'"
          style="width:50px;height:70px;object-fit:cover;border-radius:6px;flex-shrink:0;" />
        <div>
          <h4 style="margin:0 0 0.2rem;">${escapeHTML(book.title)}</h4>
          <p style="margin:0;color:#666;font-style:italic;">${escapeHTML(book.author || "")}</p>
        </div>
      </div>
      <div class="listing-actions">
        <button class="btn btn-secondary btn-small" onclick="removeFromShelf('${entry.id}','want')">
          <i class="fas fa-times"></i> Remove
        </button>
      </div>
    `;
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

  const [profileRes, followerRes, followingRes, haveRes, wantRes] = await Promise.all([
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

  renderProfileShelf("profileShelfHave", haveRes.data || []);
  renderProfileShelf("profileShelfWant", wantRes.data || []);
}

function renderProfileShelf(containerId, entries) {
  const container = document.getElementById(containerId);
  if (!entries.length) {
    container.innerHTML = '<p style="color:#888;">Nothing here yet.</p>';
    return;
  }
  const grid = document.createElement("div");
  grid.style.cssText = "display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1.5rem;";
  entries.forEach((entry) => {
    const book = entry.books || {};
    const item = document.createElement("div");
    item.style.cssText = "text-align:center;width:90px;";
    item.innerHTML = `
      <img src="${escapeHTML(book.cover_url || "")}" alt="${escapeHTML(book.title)}"
        onerror="this.src='https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=90&h=120&fit=crop'"
        style="width:80px;height:110px;object-fit:cover;border-radius:8px;box-shadow:0 3px 8px rgba(0,0,0,0.12);" />
      <p style="font-size:0.75rem;margin:0.4rem 0 0;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:90px;">
        ${escapeHTML(book.title)}
      </p>
    `;
    grid.appendChild(item);
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
