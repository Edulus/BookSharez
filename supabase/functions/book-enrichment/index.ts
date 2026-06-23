// Supabase Edge Function: book-enrichment
//
// Enriches a book with community metadata from the Hardcover GraphQL API
// (description, rating, genres, series, page count, category). Cache-first
// against the books table: if hc_enriched_at is recent we return the cached
// columns with no Hardcover call. Otherwise we look the book up by ISBN-13
// (falling back to a title+author search), normalize, write the enrichment
// columns back to books, and return the payload.
//
// Same security model as isbn-lookup: the Hardcover token stays server-side in
// an Edge Function secret, JWT is validated, and writes use the service-role
// client. If Hardcover is unreachable or has no match we return
// { enriched: false } — the detail page degrades gracefully.
//
// Deploy: paste this file's contents into Supabase Dashboard → Edge Functions
// → New function (name: "book-enrichment"). Then set the secret:
//   HARDCOVER_API_TOKEN=<token from https://hardcover.app/account/api>
// (the function tolerates the value with or without a leading "Bearer ").

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

const HARDCOVER_URL = "https://api.hardcover.app/v1/graphql";
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// book_category_id → human-readable label (see briefing reference table).
const BOOK_CATEGORY: Record<number, string> = {
  1: "Book",
  2: "Novella",
  3: "Short Story",
  4: "Graphic Novel",
  5: "Fan Fiction",
  6: "Research Paper",
  7: "Poetry",
  8: "Collection",
  9: "Web Novel",
  10: "Light Novel",
};

// ── ISBN normalization (ISBN-10 → ISBN-13) ─────────────────────────────────────

function isbn10to13(s: string): string {
  const base = "978" + s.slice(0, 9);
  const digits = base.split("").map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 1 : 3), 0);
  const check = (10 - (sum % 10)) % 10;
  return base + check;
}

function normalizeISBN(raw: string): string | null {
  const cleaned = (raw ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{13}$/.test(cleaned)) return cleaned;
  if (/^\d{9}[\dX]$/.test(cleaned)) return isbn10to13(cleaned);
  return null;
}

// ISBN-13 (978-prefixed only) → ISBN-10. Hardcover stores some editions under
// isbn_10 only, so we try both forms on exact match. 979-prefixed ISBN-13s have
// no ISBN-10 equivalent → return null and we just skip the isbn_10 condition.
function isbn13to10(isbn13: string): string | null {
  if (!/^978\d{10}$/.test(isbn13)) return null;
  const core = isbn13.slice(3, 12); // 9 significant digits
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(core[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? "X" : String(check));
}

// ── Hardcover payload normalization ─────────────────────────────────────────────

interface Enrichment {
  description: string | null;
  rating: number | null;
  ratingCount: number | null;
  usersRead: number | null;
  genres: string[] | null;
  seriesName: string | null;
  seriesPosition: number | null;
  category: string | null;
  slug: string | null;
  pageCount: number | null;
  // Pulled from the cached book entity, used to backfill the catalog row.
  title: string | null;
  author: string | null;
  coverUrl: string | null;
}

// Hardcover's cached_tags is loosely typed across the dataset: sometimes an
// object keyed by category ({ Genre: [...] }), sometimes a flat array of tag
// objects. Each item may be a plain string or { tag, category }. Extract up to
// five Genre names defensively.
function extractGenres(cachedTags: unknown): string[] | null {
  if (!cachedTags) return null;
  const tagName = (t: unknown): string | null => {
    if (typeof t === "string") return t;
    if (t && typeof t === "object" && "tag" in t) {
      const v = (t as { tag: unknown }).tag;
      return typeof v === "string" ? v : null;
    }
    return null;
  };

  let raw: unknown[] = [];
  if (Array.isArray(cachedTags)) {
    raw = (cachedTags as unknown[]).filter((t) => {
      if (t && typeof t === "object" && "category" in t) {
        return (t as { category: unknown }).category === "Genre";
      }
      return true; // untyped array → assume genres
    });
  } else if (typeof cachedTags === "object") {
    const g = (cachedTags as Record<string, unknown>).Genre;
    if (Array.isArray(g)) raw = g;
  }

  const names = raw.map(tagName).filter((n): n is string => !!n);
  return names.length ? Array.from(new Set(names)).slice(0, 5) : null;
}

function extractSeries(
  featured: unknown
): { name: string | null; position: number | null } {
  if (!featured || typeof featured !== "object") {
    return { name: null, position: null };
  }
  const f = featured as Record<string, unknown>;
  const series = (f.series as Record<string, unknown>) || {};
  const name =
    (f.series_name as string) ||
    (series.name as string) ||
    (f.name as string) ||
    null;
  const posRaw = f.position ?? f.featured_position ?? series.position ?? null;
  const position = posRaw != null ? Number(posRaw) || null : null;
  return { name, position };
}

function extractAuthor(cachedContributors: unknown): string | null {
  if (!Array.isArray(cachedContributors)) return null;
  const names = cachedContributors
    .map((c) => {
      if (typeof c === "string") return c;
      if (c && typeof c === "object") {
        const obj = c as Record<string, unknown>;
        const author = obj.author as Record<string, unknown> | undefined;
        return (author?.name as string) || (obj.name as string) || null;
      }
      return null;
    })
    .filter((n): n is string => !!n);
  return names.length ? names.join(", ") : null;
}

function extractCover(cachedImage: unknown): string | null {
  if (!cachedImage) return null;
  if (typeof cachedImage === "string") return cachedImage;
  if (typeof cachedImage === "object" && "url" in cachedImage) {
    const u = (cachedImage as { url: unknown }).url;
    return typeof u === "string" ? u : null;
  }
  return null;
}

// deno-lint-ignore no-explicit-any
function normalizeBook(b: any): Enrichment {
  const series = extractSeries(b.cached_featured_series);
  return {
    description: b.description || null,
    rating: b.rating != null ? Number(b.rating) || null : null,
    ratingCount: b.ratings_count != null ? Number(b.ratings_count) || null : null,
    usersRead:
      b.users_read_count != null ? Number(b.users_read_count) || null : null,
    genres: extractGenres(b.cached_tags),
    seriesName: series.name,
    seriesPosition: series.position,
    category: BOOK_CATEGORY[b.book_category_id] || null,
    slug: b.slug || null,
    pageCount: b.pages != null ? Number(b.pages) || null : null,
    title: b.title || null,
    author: extractAuthor(b.cached_contributors),
    coverUrl: extractCover(b.cached_image),
  };
}

// ── Hardcover GraphQL ───────────────────────────────────────────────────────────

// Shared field set for the cached book entity. Kept to depth ≤ 3 from the query
// root (Hardcover caps query depth at 3) by using the cached_* JSON columns
// instead of traversing contributions/series relations.
const BOOK_FIELDS = `
  id
  title
  slug
  description
  pages
  rating
  ratings_count
  users_count
  users_read_count
  book_category_id
  cached_image
  cached_tags
  cached_contributors
  cached_featured_series
`;

async function hardcoverFetch(
  token: string,
  query: string,
  // deno-lint-ignore no-explicit-any
  variables: Record<string, any>
  // deno-lint-ignore no-explicit-any
): Promise<any | null> {
  const authHeader = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(HARDCOVER_URL, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.error("Hardcover network error:", e);
    return null;
  }
  if (!res.ok) {
    console.error(`Hardcover responded ${res.status}`);
    return null;
  }
  const json = await res.json();
  if (json.errors) {
    console.error("Hardcover GraphQL errors:", JSON.stringify(json.errors));
    return null;
  }
  return json.data ?? null;
}

// deno-lint-ignore no-explicit-any
async function lookupByISBN(
  token: string,
  isbn13: string,
  isbn10: string | null
  // deno-lint-ignore no-explicit-any
): Promise<any | null> {
  // Exact match only — Hardcover disables _like/_ilike/_regex, so there is no
  // fuzzy/prefix ISBN matching. Try both ISBN-13 and (when it exists) ISBN-10,
  // since editions can be stored under either form.
  const where = isbn10
    ? "{ _or: [{ isbn_13: { _eq: $i13 } }, { isbn_10: { _eq: $i10 } }] }"
    : "{ isbn_13: { _eq: $i13 } }";
  const query = `
    query BookByISBN($i13: String!${isbn10 ? ", $i10: String!" : ""}) {
      editions(where: ${where}, limit: 1) {
        book { ${BOOK_FIELDS} }
      }
    }`;
  const variables = isbn10 ? { i13: isbn13, i10: isbn10 } : { i13: isbn13 };
  const data = await hardcoverFetch(token, query, variables);
  return data?.editions?.[0]?.book ?? null;
}

// deno-lint-ignore no-explicit-any
async function lookupByTitle(
  token: string,
  title: string,
  author: string | null
  // deno-lint-ignore no-explicit-any
): Promise<any | null> {
  const q = author ? `${title} ${author}` : title;
  const searchQuery = `
    query BookSearch($q: String!) {
      search(query: $q, query_type: "Book", per_page: 5, page: 1) {
        results
      }
    }`;
  const data = await hardcoverFetch(token, searchQuery, { q });
  const results = data?.search?.results;
  const hits = results?.hits;
  if (!Array.isArray(hits) || hits.length === 0) return null;

  // Pick the most-read match, then re-fetch the full cached fields by id.
  let bestId: number | null = null;
  let bestUsers = -1;
  for (const hit of hits) {
    const doc = hit?.document ?? hit;
    const users = Number(doc?.users_count ?? 0) || 0;
    const id = Number(doc?.id);
    if (id && users > bestUsers) {
      bestUsers = users;
      bestId = id;
    }
  }
  if (!bestId) return null;

  const byIdQuery = `
    query BookById($id: Int!) {
      books(where: { id: { _eq: $id } }, limit: 1) {
        ${BOOK_FIELDS}
      }
    }`;
  const byId = await hardcoverFetch(token, byIdQuery, { id: bestId });
  return byId?.books?.[0] ?? null;
}

// ── Cached payload assembly (shared by cache hit + fresh fetch) ─────────────────

// deno-lint-ignore no-explicit-any
function payloadFromRow(row: any, source: string) {
  return {
    enriched: true,
    source,
    description: row.description ?? null,
    rating: row.hc_rating != null ? Number(row.hc_rating) : null,
    ratingCount: row.hc_rating_count ?? null,
    usersRead: row.hc_users_read ?? null,
    genres: Array.isArray(row.hc_genres) ? row.hc_genres : null,
    seriesName: row.hc_series_name ?? null,
    seriesPosition: row.hc_series_pos != null ? Number(row.hc_series_pos) : null,
    category: row.hc_book_category ?? null,
    slug: row.hc_slug ?? null,
    pageCount: row.page_count ?? null,
    publisher: row.publisher ?? null,
    publishDate: row.publish_date ?? null,
  };
}

// ── Main handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // JWT check — same gate as the other Edge Functions.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return jsonResponse({ error: "Unauthorized" }, 401);

  // title/author are optional — the client passes them so a book that isn't yet
  // a catalog row (browsed straight from external search) can still use the
  // title-search fallback when its ISBN misses on Hardcover.
  let body: { isbn?: string; title?: string; author?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const isbn13 = normalizeISBN(body.isbn ?? "");
  if (!isbn13) return jsonResponse({ enriched: false });
  const isbn10 = isbn13to10(isbn13);

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // 1. Cache check. If we have a recent enrichment, return it without a call.
  const { data: existing } = await serviceClient
    .from("books")
    .select(
      "id, title, author, description, page_count, publisher, publish_date, " +
        "hc_rating, hc_rating_count, hc_users_read, hc_genres, " +
        "hc_series_name, hc_series_pos, hc_slug, hc_book_category, hc_enriched_at"
    )
    .eq("isbn", isbn13)
    .maybeSingle();

  if (existing?.hc_enriched_at) {
    const age = Date.now() - new Date(existing.hc_enriched_at).getTime();
    if (age < CACHE_MAX_AGE_MS) {
      return jsonResponse(payloadFromRow(existing, "cache"));
    }
  }

  // 2. Hardcover lookup: ISBN first, then title+author fallback.
  const token = Deno.env.get("HARDCOVER_API_TOKEN");
  if (!token) {
    console.error("HARDCOVER_API_TOKEN not set");
    return jsonResponse({ enriched: false });
  }

  let raw = await lookupByISBN(token, isbn13, isbn10);
  if (!raw) {
    // ISBN exact-match missed. Fuzzy ISBN matching isn't possible (Hardcover
    // disables _like/_ilike/_regex), so the title search endpoint is the only
    // non-exact path. Prefer the catalog title/author; fall back to whatever the
    // client sent for books not yet in the catalog. Textbooks frequently miss on
    // ISBN but resolve via title search.
    const title = existing?.title ?? body.title ?? null;
    const author = existing?.author ?? body.author ?? null;
    if (title) {
      raw = await lookupByTitle(token, title, author);
    }
  }

  if (!raw) return jsonResponse({ enriched: false });

  const enrichment = normalizeBook(raw);

  // 3. Write enrichment columns back to the catalog row (cache for next time).
  const enrichmentCols = {
    description: enrichment.description,
    hc_rating: enrichment.rating,
    hc_rating_count: enrichment.ratingCount,
    hc_users_read: enrichment.usersRead,
    hc_genres: enrichment.genres,
    hc_series_name: enrichment.seriesName,
    hc_series_pos: enrichment.seriesPosition,
    hc_slug: enrichment.slug,
    hc_book_category: enrichment.category,
    hc_enriched_at: new Date().toISOString(),
  };

  if (existing?.id) {
    // Existing catalog row → update enrichment only; never overwrite the
    // seller-facing title/author/cover. Backfill page_count only when missing.
    const updateCols: Record<string, unknown> = { ...enrichmentCols };
    if (!existing.page_count && enrichment.pageCount) {
      updateCols.page_count = enrichment.pageCount;
    }
    const { error: updErr } = await serviceClient
      .from("books")
      .update(updateCols)
      .eq("id", existing.id);
    if (updErr) console.error("books enrichment update failed:", updErr);
  } else if (enrichment.title) {
    // Book not in the catalog yet (external search result) → insert a minimal
    // row so the enrichment is cached. title is NOT NULL, so guard on it.
    const { error: insErr } = await serviceClient.from("books").insert({
      isbn: isbn13,
      title: enrichment.title,
      author: enrichment.author,
      cover_url: enrichment.coverUrl,
      page_count: enrichment.pageCount,
      ...enrichmentCols,
    });
    if (insErr) console.error("books enrichment insert failed:", insErr);
  }

  // 4. Return the payload (merge fresh Hardcover data with catalog publisher/year).
  return jsonResponse({
    enriched: true,
    source: "hardcover",
    description: enrichment.description,
    rating: enrichment.rating,
    ratingCount: enrichment.ratingCount,
    usersRead: enrichment.usersRead,
    genres: enrichment.genres,
    seriesName: enrichment.seriesName,
    seriesPosition: enrichment.seriesPosition,
    category: enrichment.category,
    slug: enrichment.slug,
    pageCount: enrichment.pageCount ?? existing?.page_count ?? null,
    publisher: existing?.publisher ?? null,
    publishDate: existing?.publish_date ?? null,
  });
});
