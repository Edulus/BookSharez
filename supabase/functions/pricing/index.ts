// Supabase Edge Function: pricing
//
// Suggests a used-book price from book data + condition via DeepSeek,
// falling back to a simple condition-multiplier algorithm on any failure.
// Holds the DEEPSEEK_API_KEY secret server-side — the browser never sees it.
//
// Deploy: paste this file's contents into Supabase Dashboard → Edge Functions
// → New function (name: "pricing"), or `supabase functions deploy pricing` if
// the CLI is available. Then set the secret:
//   supabase secrets set DEEPSEEK_API_KEY=sk-...
// (or Dashboard → Edge Functions → Secrets).
//
// See docs/ERROR_HANDLING_PATTERNS.md "AI Pricing Errors" for the pattern this
// follows, and docs/SECURITY_CHECKLIST.md "Protected Routes" for the JWT check.

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_CONDITIONS = ["like_new", "very_good", "good", "fair", "poor"];

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Real auth check — RLS doesn't apply here since this function doesn't
  // touch the DB, so this is the only gate. See SECURITY_CHECKLIST.md.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { bookData?: Record<string, unknown>; condition?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { bookData, condition } = body;
  if (!bookData || typeof bookData !== "object") {
    return jsonResponse({ error: "bookData is required" }, 400);
  }
  if (!condition || !ALLOWED_CONDITIONS.includes(condition)) {
    return jsonResponse({ error: "Invalid condition" }, 400);
  }

  const title = String(bookData.title || "").slice(0, 300);
  const author = String(bookData.author || "").slice(0, 300);
  const isbn = String(bookData.isbn || "").slice(0, 20);

  try {
    const apiKey = Deno.env.get("DEEPSEEK_API_KEY");
    if (!apiKey) throw new Error("DEEPSEEK_API_KEY not configured");

    const prompt =
      `Suggest a fair USED resale price in USD for this book, given its ` +
      `condition. Respond with ONLY a JSON object, no other text: ` +
      `{"price": <number>, "confidence": "high"|"medium"|"low"}.\n\n` +
      `Title: ${title}\nAuthor: ${author}\nISBN: ${isbn}\n` +
      `Condition: ${condition} (like_new=barely used, poor=heavily worn)`;

    const response = await fetch(
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 60,
        }),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      throw new Error(`DeepSeek API error: ${response.status}`);
    }

    const completion = await response.json();
    const content = completion.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || content);

    const price = Number(parsed.price);
    if (!Number.isFinite(price) || price < 0.5 || price > 1000) {
      throw new Error("Invalid price estimate from AI");
    }
    const confidence = ["high", "medium", "low"].includes(parsed.confidence)
      ? parsed.confidence
      : "medium";

    return jsonResponse({ price, confidence });
  } catch (error) {
    // Never expose internal error details — log server-side, fail generically.
    console.error("Pricing function error:", error);
    return jsonResponse({ error: "AI pricing unavailable" }, 502);
  }
});
