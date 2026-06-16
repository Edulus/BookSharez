// Supabase Edge Function: isbn-lookup
//
// Cache-first ISBN lookup: checks the books catalog first (instant, no quota),
// then ISBNdb (primary paid source, key stays server-side), then Google Books
// (free fallback). Normalizes + upserts the result into books so every future
// lookup of the same ISBN is a cache hit.
//
// Deploy: paste this file's contents into Supabase Dashboard → Edge Functions
// → New function (name: "isbn-lookup"), or `supabase functions deploy isbn-lookup`.
// Then set secrets (Dashboard → Edge Functions → Secrets):
//   ISBNDB_API_KEY=<your key>           ← required for ISBNdb; skipped if absent
//   GOOGLE_BOOKS_API_KEY=<your key>     ← optional; keyless quota is low
//
// See docs/ISBN_LOOKUP_DESIGN.md for architecture, caching strategy, and the
// rate-limiting approach (option B: in-memory gate) used here.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ── ISBN normalization ────────────────────────────────────────────────────────

function isbn10CheckDigit(s: string): string {
  // s = first 9 digits; returns the 10th check char (digit or 'X')
  const sum = s.split("").reduce((acc, d, i) => acc + Number(d) * (10 - i), 0);
  const rem = (11 - (sum % 11)) % 11;
  return rem === 10 ? "X" : String(rem);
}

function isbn10to13(s: string): string {
  const base = "978" + s.slice(0, 9);
  const digits = base.split("").map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

interface NormalizedISBN {
  isbn13: string;
  isbn10: string | null;
}

function normalizeISBN(raw: string): NormalizedISBN | null {
  const cleaned = raw.replace(/[\s-]/g, "").toUpperCase();

  if (/^\d{13}$/.test(cleaned)) {
    return { isbn13: cleaned, isbn10: null };
  }

  if (/^\d{9}[\dX]$/.test(cleaned)) {
    // Validate ISBN-10 check digit
    const expected = isbn10CheckDigit(cleaned.slice(0, 9));
    if (cleaned[9] !== expected) return null;
    return { isbn13: isbn10to13(cleaned), isbn10: cleaned };
  }

  return null;
}

// ── Date parsing ──────────────────────────────────────────────────────────────

function parseDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}$/.test(raw)) return `${raw}-01`;
  if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
  return null;
}

// ── In-memory rate gate for ISBNdb (option B — see ISBN_LOOKUP_DESIGN.md §4) ─
// Not globally correct across instances, but the 429→Google Books fallback is
// the real safety net. A DB-backed gate (option C) can be added if needed.

let lastIsbndbCallMs = 0;
const ISBNDB_INTERVAL_MS = 1100;

async function rateGateISBNdb(): Promise<void> {
  const wait = ISBNDB_INTERVAL_MS - (Date.now() - lastIsbndbCallMs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastIsbndbCallMs = Date.now();
}

// ── External lookups ──────────────────────────────────────────────────────────

interface BookFields {
  title: string | null;
  author: string | null;
  publisher: string | null;
  publish_date: string | null;
  cover_url: string | null;
  page_count: number | null;
  language: string | null;
}

async function lookupISBNdb(
  isbn13: string
): Promise<{ data: BookFields | null; shouldFallback: boolean }> {
  const apiKey = Deno.env.get("ISBNDB_API_KEY");
  if (!apiKey) return { data: null, shouldFallback: true }; // key not set → skip

  await rateGateISBNdb();

  let res: Response;
  try {
    res = await fetch(`https://api2.isbndb.com/book/${isbn13}`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error("ISBNdb network error:", e);
    return { data: null, shouldFallback: true };
  }

  if (res.status === 404) return { data: null, shouldFallback: true }; // not in ISBNdb
  if (!res.ok) {
    console.error(`ISBNdb responded ${res.status}`);
    return { data: null, shouldFallback: true }; // 429, 5xx, etc.
  }

  const json = await res.json();
  const b = json?.book;
  if (!b?.title) return { data: null, shouldFallback: true };

  return {
    data: {
      title: b.title_long || b.title || null,
      author: Array.isArray(b.authors)
        ? b.authors.join(", ")
        : b.authors || null,
      publisher: b.publisher || null,
      publish_date: parseDate(b.date_published),
      cover_url: b.image || null,
      page_count: b.pages ? Number(b.pages) || null : null,
      language: b.language || null,
    },
    shouldFallback: false,
  };
}

async function lookupGoogleBooks(isbn13: string): Promise<BookFields | null> {
  const apiKey = Deno.env.get("GOOGLE_BOOKS_API_KEY");
  const url = apiKey
    ? `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}&key=${apiKey}`
    : `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}&country=US`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (e) {
    console.error("Google Books network error:", e);
    return null;
  }

  if (!res.ok) return null; // 429 or server error
  const json = await res.json();
  const info = json?.items?.[0]?.volumeInfo;
  if (!info?.title) return null;

  const rawCover =
    info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || null;

  return {
    title: info.title || null,
    author: Array.isArray(info.authors) ? info.authors.join(", ") : null,
    publisher: info.publisher || null,
    publish_date: parseDate(info.publishedDate),
    cover_url: rawCover ? rawCover.replace(/^http:/, "https:") : null,
    page_count: info.pageCount ? Number(info.pageCount) || null : null,
    language: info.language || null,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // JWT check — stops anonymous users burning ISBNdb quota.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return jsonResponse({ error: "Unauthorized" }, 401);

  let body: { isbn?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const normalized = normalizeISBN(body.isbn ?? "");
  if (!normalized) {
    return jsonResponse({ error: "Invalid ISBN" }, 400);
  }
  const { isbn13, isbn10 } = normalized;

  // Service-role client for upserts — bypasses RLS, the only writer to books.
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // 1. Cache check (books table = the cache).
  const { data: cached } = await serviceClient
    .from("books")
    .select("isbn, isbn10, title, author, publisher, publish_date, cover_url, page_count, language")
    .eq("isbn", isbn13)
    .maybeSingle();

  if (cached?.title) {
    return jsonResponse({
      found: true,
      source: "cache",
      book: {
        isbn: cached.isbn,
        isbn10: cached.isbn10,
        title: cached.title,
        author: cached.author,
        publisher: cached.publisher,
        publishDate: cached.publish_date,
        coverUrl: cached.cover_url,
        pageCount: cached.page_count,
        language: cached.language,
      },
    });
  }

  // 2. ISBNdb, with fallback to Google Books on any failure.
  let fields: BookFields | null = null;
  let source = "isbndb";

  const isbndbResult = await lookupISBNdb(isbn13);
  if (isbndbResult.data) {
    fields = isbndbResult.data;
  } else {
    source = "google_books";
    fields = await lookupGoogleBooks(isbn13);
  }

  if (!fields?.title) {
    return jsonResponse({ found: false });
  }

  // 3. Upsert into books so the next lookup is a cache hit.
  const upsertRow = {
    isbn: isbn13,
    isbn10: isbn10 ?? null,
    title: fields.title,
    author: fields.author,
    publisher: fields.publisher,
    publish_date: fields.publish_date,
    cover_url: fields.cover_url,
    page_count: fields.page_count,
    language: fields.language ?? "en",
  };

  const { error: upsertErr } = await serviceClient
    .from("books")
    .upsert(upsertRow, { onConflict: "isbn" });
  if (upsertErr) {
    // Non-fatal: we still return the data even if the cache write failed.
    console.error("books upsert failed:", upsertErr);
  }

  return jsonResponse({
    found: true,
    source,
    book: {
      isbn: isbn13,
      isbn10: isbn10 ?? null,
      title: fields.title,
      author: fields.author,
      publisher: fields.publisher,
      publishDate: fields.publish_date,
      coverUrl: fields.cover_url,
      pageCount: fields.page_count,
      language: fields.language,
    },
  });
});
