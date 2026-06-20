# Vision OCR Feature — Cover & Barcode Image Reading

**Version:** 1.0
**Date:** June 19, 2026
**Status:** Planning — implementation by Claude Code
**Purpose:** Extract book metadata from user-uploaded images using a vision LLM, as a fallback when barcode scanning is unavailable or fails.

---

## 1. Goal

Let a user list a book from a **photo** instead of a working barcode scan. Two entry points:

- **A. Cover photo** — user takes/uploads a picture of the front cover. Vision model reads visible text (title, author). Result feeds the existing ISBNdb → Google Books lookup to fetch canonical metadata.
- **B. Barcode recovery** — user attempts a barcode scan; if the scan fails (`html5-qrcode` live camera or Quagga2 file path both return no result), the uploaded barcode image is sent to the vision model to recover the ISBN digits, which then routes to the existing ISBN lookup.

This is a **fallback path**, not a replacement for the working barcode scanner. The scanner remains the primary, fastest route.

---

## 2. Why this architecture

- **Vision LLM, not a separate OCR vendor.** A multimodal model returns structured JSON in one call. No Google Cloud Vision / Tesseract / separate OCR service to add and maintain.
- **Never trust the raw read.** The model's output is treated as a *search hint*, not final metadata. Final book data always comes from the canonical catalog (ISBNdb primary, Google Books fallback) — consistent with the existing `isbn-lookup` flow and the architecture doc's "one canonical record per ISBN" rule.
- **Same Edge Function pattern.** Mirrors the deployed `pricing` and `isbn-lookup` functions: Deno runtime, key read via `Deno.env.get()`, deployed via Supabase Dashboard editor (no CLI). No new infrastructure.

---

## 3. Model & provider decisions (settled)

| Decision | Choice |
|----------|--------|
| Provider | Google Gemini API (Generative Language API) |
| Model | `gemini-3.5-flash` |
| Tier | Paid (billing enabled) — avoids Google training on user uploads |
| API key source | Generative Language API enabled on existing `booksharez` GCP project |
| Key storage | Supabase secret `GEMINI_API_KEY` (never client-side, never committed) |
| Image transport | Inline base64 (`inlineData`), request < 20MB |
| Accepted formats | JPEG, PNG, WEBP |

**Cost reference:** ~$0.0023 per cover read (≈¼ cent). At 1,000 reads/month ≈ $2.30; 10,000/month ≈ $23. As a fallback path, real volume is a fraction of total listings — expect a few dollars/month.

**Endpoint:**
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=GEMINI_API_KEY
```

---

## 4. Request shape

`contents` array with an `inlineData` part (image) + a `text` part (prompt). Force JSON output. The two jobs use **different prompts** and **different downstream routing**.

### Job A — Cover read
Prompt asks for title + author (+ ISBN only if visible). Output:
```json
{ "title": "string|null", "author": "string|null", "isbn": "string|null", "confidence": "high|medium|low" }
```
Downstream: build ISBNdb/Google Books query from title + author → return ranked candidates → user confirms before auto-fill.

### Job B — Barcode recovery
Prompt asks ONLY for the numeric ISBN/EAN-13 under the barcode. Output:
```json
{ "isbn": "string|null", "confidence": "high|medium|low" }
```
Downstream: if `isbn` is a valid 13- or 10-digit ISBN → route straight to existing `isbn-lookup` Edge Function.

---

## 5. New Edge Function

**Name:** `vision-extract`
**Path:** `supabase/functions/vision-extract/index.ts`
**Runtime:** Deno
**Secret:** `GEMINI_API_KEY`

**Input (from client):**
```json
{ "imageBase64": "string", "mimeType": "image/jpeg|image/png|image/webp", "mode": "cover|barcode" }
```

**Behavior:**
1. Validate input (mode present, mimeType allowed, base64 non-empty, decoded size < 20MB).
2. Select prompt based on `mode`.
3. Call Gemini `generateContent` with image + prompt, requesting JSON.
4. Parse and validate the JSON (strip any markdown fences defensively).
5. Return normalized result to client. Do NOT perform the catalog lookup inside this function — return the extracted hint; the client (or the existing lookup flow) handles ISBNdb/Google Books.

**Output:**
```json
{ "ok": true, "mode": "cover", "data": { ...job-specific fields... } }
```
On failure: `{ "ok": false, "error": "user-safe message" }` (never leak the API key or raw provider errors — follow ERROR_HANDLING_PATTERNS.md).

---

## 6. Client flow (sell form)

```
User chooses listing method:
  ├── Scan barcode (PRIMARY)
  │     ├── live camera (html5-qrcode) → success → isbn-lookup
  │     ├── photo upload (Quagga2)     → success → isbn-lookup
  │     └── scan FAILS → offer "Read barcode from photo"
  │           → vision-extract (mode: barcode)
  │              ├── valid ISBN → isbn-lookup → auto-fill
  │              └── no ISBN    → prompt cover photo or manual entry
  └── Photo of cover (FALLBACK)
        → vision-extract (mode: cover)
           → title/author hint → ISBNdb/Google Books search
              ├── strong match  → show candidate(s) → user confirms → auto-fill
              └── weak/no match → manual entry
```

**Key UX rule:** the vision read is never silently trusted. Cover reads always show the user the candidate match(es) for confirmation before populating the form, because cover OCR is noisier than a barcode.

---

## 7. Error handling (per ERROR_HANDLING_PATTERNS.md)

- Timeout on Gemini call (10s) → fall back to manual entry with a friendly message.
- Invalid/empty model output → "Couldn't read the image. Try a clearer photo or enter details manually."
- Oversized image → reject client-side before upload (reuse existing 5MB photo cap; resize/compress if needed).
- Provider 4xx/5xx → generic user message, log details server-side only.
- Never expose `GEMINI_API_KEY` or raw provider responses to the client.

---

## 8. Security (per SECURITY_CHECKLIST.md)

- `GEMINI_API_KEY` stored as Supabase secret, read via `Deno.env.get()`. Never in client JS, never committed.
- All Gemini calls originate server-side (Edge Function), never from the browser.
- Validate and size-limit image input before forwarding to the provider.
- Restrict the GCP key to the Generative Language API and (if supported) referrer/IP restrictions.

---

## 9. Out of scope

- Replacing the working barcode scanner.
- Spine reading, multi-book shelf photos, handwritten notes.
- Performing the catalog lookup inside `vision-extract` (kept in the existing lookup flow).
- Storing uploaded vision images (transient; not persisted).

---

## 10. Acceptance criteria

- [ ] `vision-extract` deployed via Supabase Dashboard, `GEMINI_API_KEY` set.
- [ ] Cover mode returns valid JSON hint from a real cover photo.
- [ ] Barcode mode recovers a correct ISBN from a photo where Quagga2/html5-qrcode failed.
- [ ] Cover reads route through ISBNdb/Google Books and show candidates for confirmation.
- [ ] Barcode recovery routes a valid ISBN straight to `isbn-lookup`.
- [ ] No API key exposed client-side; errors are user-safe.
- [ ] Manual entry remains available at every dead end.
