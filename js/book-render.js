// ─── Book object contract §6A (extracted from main.js July 4 — plan §5.2) ──
// One normalizer, one renderer. See docs/BOOKSHAREZ_ARCHITECTURE.md §6A.
// Never hand-build a `.book-card` or duplicate book markup elsewhere — add a
// data point by extending the Book/BookContext shape and these renderers.
//
// This module owns rendering only; it has no page-navigation logic of its
// own. Click handlers need to call back into main.js (view a listing, browse
// a book, search by author, buy), so main.js registers those via
// initBookRender(actions) once at startup — this keeps the dependency
// one-directional (book-render.js never imports main.js) instead of circular.

import { escapeHTML } from "./dom-utils.js";

// A generic book glyph, not a photo of any real book — the previous fallback
// (an Unsplash lifestyle photo that happened to depict a specific real book,
// "milk and honey") misread as "this is the cover" for unrelated listings.
// Inline SVG: no network dependency, scales via the img tag like any cover.
// The sole shared constant (§6A) — main.js/scanner.js import this rather
// than keeping their own differently-cropped copies of the old photo URL.
export const FALLBACK_COVER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 400">' +
    '<rect width="300" height="400" fill="#f0f0f0"/>' +
    '<rect x="90" y="110" width="120" height="180" rx="6" fill="#dcdcdc"/>' +
    '<rect x="90" y="110" width="18" height="180" rx="6" fill="#c8c8c8"/>' +
    '<line x1="130" y1="150" x2="190" y2="150" stroke="#b7b7b7" stroke-width="6" stroke-linecap="round"/>' +
    '<line x1="130" y1="175" x2="190" y2="175" stroke="#b7b7b7" stroke-width="6" stroke-linecap="round"/>' +
    '<line x1="130" y1="200" x2="190" y2="200" stroke="#b7b7b7" stroke-width="6" stroke-linecap="round"/>' +
  "</svg>"
)}`;

let _actions = {
  viewListing: () => {},
  browseBookById: () => {},
  viewExternalBook: () => {},
  searchByAuthor: () => {},
  buyBook: () => {},
  openCoverLightbox: () => {},
};

export function initBookRender(actions) {
  _actions = { ..._actions, ...actions };
}

export function formatCondition(condition) {
  const conditions = {
    like_new: "Like New",
    very_good: "Very Good",
    good: "Good",
    fair: "Fair",
    poor: "Poor",
  };
  return conditions[condition] || condition;
}

// Accepts a listings row (with books join), a plain books row, or an external
// API result and returns the canonical Book shape.
export function normalizeBook(raw) {
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
export function renderBook(book, context, density) {
  if (density === "thumb") return _renderThumb(book, context);
  if (density === "full")  { _renderFull(book, context); return null; }
  return _renderTile(book, context);
}

function _renderTile(book, context) {
  _ensureBookCardStyles();
  const card = document.createElement("div");
  card.className = "book-card";

  if (context.myListingId) {
    card.onclick = () => _actions.viewListing(context.myListingId);
  } else if (book.bookId) {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => _actions.browseBookById(book.bookId, book.title));
  } else {
    card.style.cursor = "pointer";
    card.addEventListener("click", () => _actions.viewExternalBook(book));
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
        loading="lazy" onerror="this.src='${FALLBACK_COVER}'">
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
    if (span) span.addEventListener("click", (e) => { e.stopPropagation(); _actions.searchByAuthor(book.author); });
  }
  if (context.myListingId && context.price != null) {
    const btn = card.querySelector("[data-action='buy']");
    if (btn) btn.addEventListener("click", (e) => {
      e.stopPropagation();
      _actions.buyBook(context.myListingId, context.price, book.title);
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
  img.loading = "lazy";
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
    item.addEventListener("click", () => _actions.browseBookById(book.bookId, book.title));
  }
  return item;
}

function _renderFull(book, context) {
  const cover = document.getElementById("detailCover");
  cover.src = book.coverUrl || FALLBACK_COVER;
  cover.onerror = () => { cover.src = FALLBACK_COVER; };
  cover.classList.toggle("cover-zoomable", Boolean(book.coverUrl));
  cover.tabIndex = book.coverUrl ? 0 : -1;
  cover.setAttribute("role", book.coverUrl ? "button" : "img");
  cover.setAttribute("aria-label", book.coverUrl ? `Enlarge cover for ${book.title || "this book"}` : "Book cover unavailable");
  cover.title = book.coverUrl ? "Click to enlarge cover" : "";
  cover.onclick = book.coverUrl ? () => _actions.openCoverLightbox(book.coverUrl, book.title) : null;
  cover.onkeydown = book.coverUrl ? (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      _actions.openCoverLightbox(book.coverUrl, book.title);
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
    span.addEventListener("click", () => _actions.searchByAuthor(book.author));
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
  buyBtn.onclick = () => _actions.buyBook(context.myListingId, context.price, book.title);

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
