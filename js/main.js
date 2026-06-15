// Sample book data
const sampleBooks = [
  {
    id: 1,
    title: "The Great Gatsby",
    author: "F. Scott Fitzgerald",
    price: 12.99,
    condition: "very_good",
    image:
      "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=300&h=400&fit=crop",
    seller: "BookLover123",
  },
  {
    id: 2,
    title: "To Kill a Mockingbird",
    author: "Harper Lee",
    price: 15.5,
    condition: "good",
    image:
      "https://images.unsplash.com/photo-1481627834876-b7833e8f5570?w=300&h=400&fit=crop",
    seller: "ReadingFan",
  },
  {
    id: 3,
    title: "1984",
    author: "George Orwell",
    price: 10.75,
    condition: "like_new",
    image:
      "https://images.unsplash.com/photo-1512820790803-83ca734da794?w=300&h=400&fit=crop",
    seller: "BookCollector",
  },
  {
    id: 4,
    title: "Pride and Prejudice",
    author: "Jane Austen",
    price: 14.25,
    condition: "good",
    image:
      "https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=300&h=400&fit=crop",
    seller: "ClassicReader",
  },
  {
    id: 5,
    title: "The Catcher in the Rye",
    author: "J.D. Salinger",
    price: 11.99,
    condition: "acceptable",
    image:
      "https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=300&h=400&fit=crop",
    seller: "VintageBooks",
  },
  {
    id: 6,
    title: "Harry Potter and the Sorcerer's Stone",
    author: "J.K. Rowling",
    price: 18.0,
    condition: "very_good",
    image:
      "https://images.unsplash.com/photo-1621351183012-e2f9972dd9bf?w=300&h=400&fit=crop",
    seller: "MagicReader",
  },
];

// User's books (for demonstration)
let userBooks = [];
let isLoggedIn = false;
let currentUser = null;

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
}

// Load featured books
// --- Buyer-side browse/search (Supabase-backed, Phase 1) --------------------
// Reads ACTIVE listings joined to their book from Supabase (local DB only,
// never external sources) — see docs/SEARCH_SYSTEMS.md §2. Replaces the old
// in-memory sampleBooks filter. (sampleBooks remains only for the not-yet-
// persisted in-memory sell flow, which is replaced in Step 2.)

let displayedListings = []; // normalized cards currently shown in the grid

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
    id: row.id, // listing UUID
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

// Shared query: active listings, newest first, joined to their book.
function activeListingsQuery() {
  return supabaseClient
    .from("listings")
    .select(
      "id, price, condition, created_at, books!inner(title, author, cover_url, isbn)"
    )
    .eq("status", "active")
    .order("created_at", { ascending: false });
}

// Load active listings into the homepage grid.
async function loadFeaturedBooks() {
  const sectionTitle = document.getElementById("featuredTitle");
  if (sectionTitle) sectionTitle.textContent = "Featured Books";
  showGridMessage("Loading books…");

  const { data, error } = await activeListingsQuery().limit(24);
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
        <button class="btn btn-primary btn-small" onclick="buyBook('${book.id}')">
          <i class="fas fa-cart-plus"></i> Buy Now
        </button>
      </div>
      <p class="book-seller">Sold by a BookSharez seller</p>
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
    acceptable: "Acceptable",
  };
  return conditions[condition] || condition;
}

// Search functionality
// Buyer search: title/author match against ACTIVE listings (local DB only,
// never external sources). See docs/SEARCH_SYSTEMS.md §2.
async function searchBooks() {
  const searchTerm = document.getElementById("searchInput").value.trim();
  const sectionTitle = document.getElementById("featuredTitle");

  if (!searchTerm) {
    loadFeaturedBooks();
    return;
  }

  if (sectionTitle) sectionTitle.textContent = "Search Results";
  showGridMessage("Searching…");

  // Strip characters that would break the PostgREST or() filter syntax.
  const safe = searchTerm.replace(/[,()%*]/g, " ").trim();
  const pattern = `%${safe}%`;

  const { data, error } = await activeListingsQuery()
    .or(`title.ilike.${pattern},author.ilike.${pattern}`, {
      referencedTable: "books",
    })
    .limit(48);

  if (error) {
    console.error("Search failed:", error);
    showGridMessage("Search failed. Please try again.");
  } else {
    renderListings(data);
  }

  // The search bar lives in the hero; results render in the Featured section
  // below the fold — scroll there so the search feels responsive.
  const resultsSection = document.querySelector(".featured");
  if (resultsSection) {
    resultsSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

// Show buy books page
function showBuyBooks() {
  document.getElementById("homepage").style.display = "block";
  document.getElementById("dashboard").style.display = "none";
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

// Show sell modal
function showSellModal() {
  if (!isLoggedIn) {
    alert("Please login first to sell books");
    showLogin();
    return;
  }
  document.getElementById("sellModal").style.display = "block";
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
    loginBtn.innerHTML = '<i class="fas fa-user-circle"></i> Dashboard';
    loginBtn.onclick = showDashboard;
    logoutBtn.style.display = "inline-flex";
  } else {
    isLoggedIn = false;
    currentUser = null;
    loginBtn.innerHTML = '<i class="fas fa-user"></i> Login';
    loginBtn.onclick = showLogin;
    logoutBtn.style.display = "none";
    // If the user was viewing the dashboard, send them back to the homepage.
    document.getElementById("homepage").style.display = "block";
    document.getElementById("dashboard").style.display = "none";
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

// Show dashboard
function showDashboard() {
  if (!isLoggedIn) {
    showLogin();
    return;
  }

  document.getElementById("homepage").style.display = "none";
  document.getElementById("dashboard").style.display = "block";
  loadUserListings();
}

// Show dashboard tab
function showDashboardTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('[id$="-tab"]').forEach((tab) => {
    tab.style.display = "none";
  });

  // Remove active class from all buttons
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  // Show selected tab
  document.getElementById(tabName + "-tab").style.display = "block";

  // Add active class to clicked button
  event.target.classList.add("active");
}

// Handle sell book form
function handleSellBook(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  const bookData = {
    id: Date.now(), // Simple ID generation
    title: formData.get("bookTitle"),
    author: formData.get("bookAuthor"),
    isbn: formData.get("bookISBN"),
    condition: formData.get("bookCondition"),
    price: parseFloat(formData.get("bookPrice")),
    description: formData.get("bookDescription"),
    seller: currentUser,
    image:
      "https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=300&h=400&fit=crop", // Default image
  };

  // Add to user's books
  userBooks.push(bookData);

  // Add to sample books for display
  sampleBooks.unshift(bookData);

  // Close modal and refresh displays
  closeModal("sellModal");
  loadFeaturedBooks();
  loadUserListings();

  // Reset form
  e.target.reset();

  alert("Book listed successfully!");
}

// Load user listings
function loadUserListings() {
  const userListingsDiv = document.getElementById("userListings");

  if (userBooks.length === 0) {
    userListingsDiv.innerHTML =
      '<p>You haven\'t listed any books yet. <a href="#" onclick="showSellModal()">List your first book!</a></p>';
    return;
  }

  userListingsDiv.innerHTML = "";
  userBooks.forEach((book) => {
    const listingCard = document.createElement("div");
    listingCard.className = "listing-card";
    listingCard.innerHTML = `
      <div class="listing-info">
        <h4>${book.title}</h4>
        <p>by ${book.author}</p>
        <p>Condition: ${formatCondition(book.condition)}</p>
        <p class="listing-price">${book.price}</p>
      </div>
      <div class="listing-actions">
        <button class="btn btn-secondary btn-small" onclick="editListing(${
          book.id
        })">
          <i class="fas fa-edit"></i> Edit
        </button>
        <button class="btn btn-primary btn-small" onclick="deleteListing(${
          book.id
        })">
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

// Edit listing (placeholder)
function editListing(bookId) {
  alert("Edit functionality would be implemented here");
}

// Delete listing
function deleteListing(bookId) {
  if (confirm("Are you sure you want to delete this listing?")) {
    // Remove from user books
    userBooks = userBooks.filter((book) => book.id !== bookId);

    // Remove from sample books
    const sampleIndex = sampleBooks.findIndex((book) => book.id === bookId);
    if (sampleIndex > -1) {
      sampleBooks.splice(sampleIndex, 1);
    }

    // Refresh displays
    loadUserListings();
    loadFeaturedBooks();

    alert("Listing deleted successfully!");
  }
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
