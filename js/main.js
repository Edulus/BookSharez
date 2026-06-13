// Sample book data
const sampleBooks = [
  {
    id: 1,
    title: "The Great Gatsby",
    author: "F. Scott Fitzgerald",
    price: 12.99,
    condition: "very-good",
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
    condition: "like-new",
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
    condition: "fair",
    image:
      "https://images.unsplash.com/photo-1543002588-bfa74002ed7e?w=300&h=400&fit=crop",
    seller: "VintageBooks",
  },
  {
    id: 6,
    title: "Harry Potter and the Sorcerer's Stone",
    author: "J.K. Rowling",
    price: 18.0,
    condition: "very-good",
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
});

// Setup event listeners
function setupEventListeners() {
  // Login form
  document.getElementById("loginForm").addEventListener("submit", handleLogin);

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
function loadFeaturedBooks() {
  const booksGrid = document.getElementById("booksGrid");
  booksGrid.innerHTML = "";

  sampleBooks.forEach((book) => {
    const bookCard = createBookCard(book);
    booksGrid.appendChild(bookCard);
  });
}

// Create book card element
function createBookCard(book) {
  const card = document.createElement("div");
  card.className = "book-card";
  card.innerHTML = `
    <div class="book-image">
      <img src="${book.image}" alt="${
    book.title
  }" onerror="this.src='https://images.unsplash.com/photo-1544947950-fa07a98d237f?w=300&h=400&fit=crop'">
      <div class="book-condition">${formatCondition(book.condition)}</div>
    </div>
    <div class="book-info">
      <h3 class="book-title">${book.title}</h3>
      <p class="book-author">by ${book.author}</p>
      <div class="book-footer">
        <span class="book-price">$${book.price}</span>
        <button class="btn btn-primary btn-small" onclick="buyBook(${book.id})">
          <i class="fas fa-cart-plus"></i> Buy Now
        </button>
      </div>
      <p class="book-seller">Sold by: ${book.seller}</p>
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
    "like-new": "Like New",
    "very-good": "Very Good",
    good: "Good",
    fair: "Fair",
    poor: "Poor",
  };
  return conditions[condition] || condition;
}

// Search functionality
function searchBooks() {
  const searchTerm = document.getElementById("searchInput").value.toLowerCase();
  const booksGrid = document.getElementById("booksGrid");

  if (!searchTerm.trim()) {
    loadFeaturedBooks();
    return;
  }

  const filteredBooks = sampleBooks.filter(
    (book) =>
      book.title.toLowerCase().includes(searchTerm) ||
      book.author.toLowerCase().includes(searchTerm)
  );

  booksGrid.innerHTML = "";

  if (filteredBooks.length === 0) {
    booksGrid.innerHTML =
      '<p style="text-align: center; grid-column: 1/-1; color: #666;">No books found matching your search.</p>';
  } else {
    filteredBooks.forEach((book) => {
      const bookCard = createBookCard(book);
      booksGrid.appendChild(bookCard);
    });
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
  document.getElementById("loginModal").style.display = "block";
}

// Show signup (placeholder)
function showSignup() {
  alert("Signup functionality would be implemented here");
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

// Handle login
function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  // Simple demo login (in real app, this would be server-side)
  if (email && password) {
    isLoggedIn = true;
    currentUser = email;
    closeModal("loginModal");
    updateUIForLoggedInUser();
    alert("Login successful!");
  }
}

// Update UI for logged in user
function updateUIForLoggedInUser() {
  const loginBtn = document.querySelector(".btn-login");
  loginBtn.innerHTML = '<i class="fas fa-user-circle"></i> Dashboard';
  loginBtn.onclick = showDashboard;
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

// Buy book functionality
function buyBook(bookId) {
  if (!isLoggedIn) {
    alert("Please login first to buy books");
    showLogin();
    return;
  }

  const book = sampleBooks.find((b) => b.id === bookId);
  if (book) {
    if (
      confirm(`Are you sure you want to buy "${book.title}" for ${book.price}?`)
    ) {
      alert(
        "Purchase successful! You will receive shipping information via email."
      );
      // In a real app, this would integrate with payment processing
    }
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
