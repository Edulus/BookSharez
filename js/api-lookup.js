// ---------------------------------------------------------------------------
// External book-data lookups (extracted from main.js July 4 — plan §5.2)
// ---------------------------------------------------------------------------
// Seller-side ISBN lookup + title/author search against external sources
// (docs/SEARCH_SYSTEMS.md §1 — never used for buyer-side browse, which is
// local-DB only). No DOM access in this module; callers own all UI.
//
// Primary path is the isbn-lookup Edge Function (cache → ISBNdb → Google
// Books, all server-side; keys never reach the browser). Everything else here
// is the keyless/free client-side fallback chain.
//
// Uses the global `supabaseClient` from js/supabase-config.js (classic
// script, loaded before the module graph).

export async function lookupViaEdgeFunction(isbn) {
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
export async function lookupOpenLibrary(isbn) {
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

export async function lookupGoogleBooks(isbn) {
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

// Convert ISBN-10 to ISBN-13 (for results that only carry ISBN-10)
export function isbn10to13Client(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return null;
  const base = "978" + s.slice(0, 9);
  const digits = base.split("").map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  return base + (10 - (sum % 10)) % 10;
}

// Search Google Books; returns up to 12 results with ISBNs.
// requireIsbn=false keeps matches without any ISBN (pre-ISBN era books) —
// used by the scanner's cover path, where "no ISBN" is a normal outcome.
// Throws on quota/network error so the caller can fall back to Open Library.
export async function searchGoogleBooks(query, { requireIsbn = true } = {}) {
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
    if (!info.title || (requireIsbn && !isbn)) return null;
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
export async function searchOpenLibrary(query, { requireIsbn = true } = {}) {
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
    if (!doc.title || (requireIsbn && !isbn)) return null;
    const cover = doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : "";
    return {
      isbn, title: doc.title,
      author: (doc.author_name || []).join(", "),
      year: doc.first_publish_year ? String(doc.first_publish_year) : "",
      cover,
      buyLink: isbn ? `https://openlibrary.org/isbn/${isbn}` : null,
    };
  }).filter(Boolean);
}

// Public entry point used by all three call sites (hero search, shelf modal,
// sell modal). Tries Google Books first; falls back to Open Library on quota
// or any network error so there is always a result.
export async function searchBooksAPI(query, opts = {}) {
  try {
    const results = await searchGoogleBooks(query, opts);
    if (results.length > 0) return results;
    // Google Books returned OK but empty — still try Open Library.
  } catch (e) {
    console.warn("Google Books unavailable, using Open Library:", e.message);
  }
  return searchOpenLibrary(query, opts);
}
