// Supabase Edge Function: vision-extract
//
// Extracts book metadata from a user-uploaded image using Google Gemini vision.
// Three modes:
//   "cover"   — reads title/author/isbn hint from a book cover photo
//   "barcode" — recovers ISBN digits from a photo where the barcode scanner failed
//   "shelf"   — identifies MANY books from one shelf/stack photo, returning an
//               array of {title, author, confidence} hints (see
//               docs/SHELF_PHOTO_CAPTURE.md). Capped server-side to SHELF_MAX_BOOKS.
//
// The function returns a hint only. The client is responsible for routing the
// hint to the existing isbn-lookup / Google Books catalog flow — consistent with
// the "one canonical record per ISBN" rule in docs/BOOKSHAREZ_ARCHITECTURE.md.
//
// Holds GEMINI_API_KEY server-side — the browser never sees it.
//
// Deploy: paste into Supabase Dashboard → Edge Functions → New function
//   Name: vision-extract
// Then add the secret:
//   Dashboard → Edge Functions → Secrets → GEMINI_API_KEY=<your key>
//
// Model: gemini-3.5-flash (GA May 2026, vision-capable). Change GEMINI_MODEL
// below if you need a different version.
//
// See docs/VISION_OCR_FEATURE.md for full spec and error-handling rules.

import { createClient } from "jsr:@supabase/supabase-js@2";

const GEMINI_MODEL = "gemini-3.5-flash";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ALLOWED_MODES = ["cover", "barcode", "shelf"];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20 MB decoded
const SHELF_MAX_BOOKS = 30; // cap the shelf array to bound the client's catalog fan-out

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

const PROMPTS: Record<string, string> = {
  cover:
    'Read this book cover. Return ONLY JSON: {"title":string|null,"author":string|null,"isbn":string|null,"confidence":"high"|"medium"|"low"}. No prose, no markdown.',
  barcode:
    'Read the numeric ISBN/EAN-13 printed under the barcode in this image. Return ONLY JSON: {"isbn":string|null,"confidence":"high"|"medium"|"low"}. Digits only in isbn. No prose, no markdown.',
  shelf:
    'List every distinct book you can identify from its spine or front cover in this image. Return ONLY JSON: {"books":[{"title":string,"author":string|null,"confidence":"high"|"medium"|"low"}]}. Skip any book you cannot read confidently rather than guessing. No prose, no markdown.',
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // JWT check — prevents unauthenticated Gemini quota burn.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) return jsonResponse({ error: "Unauthorized" }, 401);

  let body: { imageBase64?: string; mimeType?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { imageBase64, mimeType, mode } = body;

  if (!mode || !ALLOWED_MODES.includes(mode)) {
    return jsonResponse(
      { error: "mode must be 'cover' or 'barcode'" },
      400
    );
  }
  if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
    return jsonResponse(
      { error: "mimeType must be image/jpeg, image/png, or image/webp" },
      400
    );
  }
  if (!imageBase64 || imageBase64.length === 0) {
    return jsonResponse({ error: "imageBase64 is required" }, 400);
  }

  // base64 is ~4/3 the binary size — multiply by 0.75 to estimate decoded bytes.
  if (imageBase64.length * 0.75 > MAX_IMAGE_BYTES) {
    return jsonResponse({ error: "Image too large (max 20 MB)" }, 400);
  }

  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.error("GEMINI_API_KEY secret not set");
    return jsonResponse(
      { ok: false, error: "Image reading is not available right now. Please enter book details manually." },
      503
    );
  }

  try {
    const geminiRes = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType,
                  data: imageBase64,
                },
              },
              {
                text: PROMPTS[mode],
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text().catch(() => "");
      console.error(`Gemini ${geminiRes.status}:`, errText.slice(0, 300));
      return jsonResponse(
        {
          ok: false,
          error:
            "Couldn't read the image. Try a clearer photo or enter details manually.",
        },
        502
      );
    }

    const geminiJson = await geminiRes.json();
    const rawText: string =
      geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    // Strip markdown fences defensively — belt-and-suspenders against models
    // that ignore responseMimeType and wrap output in ```json anyway.
    const stripped = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "")
      .trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripped || "{}");
    } catch {
      console.error("Unparseable Gemini output:", rawText.slice(0, 200));
      return jsonResponse(
        {
          ok: false,
          error:
            "Couldn't read the image. Try a clearer photo or enter details manually.",
        },
        502
      );
    }

    // Shelf mode returns an array — normalize defensively (models sometimes
    // return a bare array, or omit the wrapper) and cap the fan-out.
    if (mode === "shelf") {
      const rawBooks = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { books?: unknown }).books)
        ? (parsed as { books: unknown[] }).books
        : [];
      const books = rawBooks
        .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
        .map((b) => ({
          title: typeof b.title === "string" ? b.title : null,
          author: typeof b.author === "string" ? b.author : null,
          confidence:
            b.confidence === "high" || b.confidence === "medium" || b.confidence === "low"
              ? b.confidence
              : "low",
        }))
        .filter((b) => b.title) // a book with no readable title is not a hint
        .slice(0, SHELF_MAX_BOOKS);
      return jsonResponse({ ok: true, mode, data: { books } });
    }

    return jsonResponse({ ok: true, mode, data: parsed });
  } catch (err) {
    // AbortError = 10 s timeout; any other network failure lands here too.
    console.error("vision-extract error:", err);
    return jsonResponse(
      {
        ok: false,
        error:
          "Couldn't read the image. Try a clearer photo or enter details manually.",
      },
      502
    );
  }
});
