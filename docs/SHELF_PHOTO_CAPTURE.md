# Multi-Book Shelf-Photo Capture — Scope

**Version:** 0.1 (scope / not yet implemented)
**Date:** July 25, 2026
**Status:** Scoping — extends the scanner (`js/scanner.js`) and `vision-extract`
**Purpose:** Identify **many** books from a single photo of a shelf (spines) or a
stack/fan of covers, then add them to "Books I Have" in one reviewed batch.

Builds directly on [VISION_OCR_FEATURE.md](VISION_OCR_FEATURE.md) (single-cover
vision read) and the batch-capture core loop. This is the "multi-book shelf
photo" item that VISION_OCR_FEATURE.md §9 explicitly deferred.

---

## 1. Goal & why

The core loop today is one book per capture (barcode, cover, or manual). A heavy
bookshelf is 100+ books — one-at-a-time is the ceiling on how fast a new user can
mirror their physical shelf. **One photo → 10–20 books identified → one reviewed
batch add** amortizes the slowest part of the loop (aiming and confirming per
book) across many books at once.

It is a **complement**, not a replacement: single-book capture stays the precise,
high-confidence path (barcode especially). Shelf capture trades per-book accuracy
for throughput, and pays for that trade with a mandatory batch review step.

---

## 2. Where it fits (architecture)

A **third capture path** inside the existing scanner modal
(`#barcodeScannerModal`), alongside barcode scan and single-cover read. It reuses,
not duplicates:

| Reused piece | Role here |
|---|---|
| `vision-extract` Edge Function | New `"shelf"` mode returns an **array** of book hints |
| `_compressAndEncode` / `_callVisionExtract` | Same image encode + function call |
| `searchBooksAPI(q, {requireIsbn:false})` | Resolve each detected title→author to a catalog candidate |
| `renderBookSearchResults`-style rows | Basis for the review checklist rows |
| `ensureBook` + no-ISBN insert path | Per-book catalog write (append-only invariant preserved) |
| Loop metrics (`bsLoopMetrics`) | Per-confirmed-book capture accounting |

**No new table, no new Edge Function, no new secret.** Same `GEMINI_API_KEY`.

---

## 3. The central UX problem, and the design that answers it

The cover-path invariant is *"never silently trust the vision read — show the
candidate and let the user confirm."* With N books that rule **cannot** become N
serial confirmations (that's slower than single capture and kills the loop). It
also cannot become "auto-add all N" (title→catalog resolution is ambiguous;
silent bulk-add would pollute shelves).

**Answer: one batch review screen that confirms at the batch level.**

```
Take shelf photo
  → vision-extract (mode: shelf) → [ {title,author,confidence}, ... ]
  → client resolves each to a catalog match (parallel, bounded concurrency)
  → REVIEW SCREEN: a checklist, one row per detected book
       ├─ thumbnail + resolved title/author, pre-checked when confident
       ├─ low-confidence / ambiguous rows flagged, still selectable
       └─ no-match rows unchecked, with a "search manually" affordance
  → user unchecks wrong ones / swaps a match  (one pass, not N dialogs)
  → "Add N books to Books I Have"
  → bulk shelf add → toast "Added N books" → metrics bump per confirmed book
```

Nothing is added that the user didn't see and approve — the invariant holds, just
amortized. Speed comes from *review-and-deselect* replacing *confirm-each*.

---

## 4. Edge Function changes (`vision-extract/index.ts`)

Minimal, additive:

- Add `"shelf"` to `ALLOWED_MODES`.
- New prompt (returns an array; instructs the model to **skip** anything it can't
  read confidently rather than guess):
  ```
  List every distinct book you can identify from its spine or front cover in
  this image. Return ONLY JSON: {"books":[{"title":string,"author":string|null,
  "confidence":"high"|"medium"|"low"}]}. Skip any book you cannot read
  confidently. No prose, no markdown.
  ```
- Server-side **cap** the array (e.g. `.slice(0, 30)`) before returning, to bound
  the response and the downstream catalog-search fan-out.
- Everything else unchanged: JWT gate, mime/size validation, `responseMimeType:
  application/json`, markdown-fence stripping, user-safe errors.
- Return shape: `{ ok:true, mode:"shelf", data:{ books:[...] } }`.

**Cost:** one Gemini call yields many books, so cost-per-book is *lower* than
single-cover reads. Response is bigger but well within limits at a 30-book cap.

---

## 5. Client changes (`js/scanner.js`)

New scanner state + functions (new code sits beside the existing paths; the
barcode/cover/found paths are untouched):

- **New state** `shelfReview` — extend `_showScannerState` from two states
  (`scanning`/`found`) to three, so the review list is its own screen and the
  batch-capture rhythm is unaffected.
- `scanShelfPhoto(input)` — `_compressAndEncode` → `_callVisionExtract(…, "shelf")`
  → `_resolveShelfCandidates` → `_renderShelfReview`.
- `_resolveShelfCandidates(books)` — parallel `searchBooksAPI(q, {requireIsbn:
  false})` per detected book with **bounded concurrency** (≈4 in flight) and a
  per-item timeout; dedupe detections that resolve to the same book id; return
  rows `{ detected, match, alternatives, status: matched|ambiguous|unmatched }`.
- `_renderShelfReview(rows)` — the checklist UI: checkbox + thumbnail + title/
  author per row, pre-check policy per §8, swap-match and manual-search
  affordances, an "Add N" action.
- `addSelectedShelfBooks(shelfType='have')` — iterate checked rows through the
  shared shelf-add core, aggregate results, **one** toast, **one** background
  shelf refresh, metrics per confirmed book, partial-failure reporting.

**Refactor (do carefully):** today `_addScannedToShelf` reads module-global
`_scannedBookData`. Extract a `_addBookToShelf(book, shelfType)` core that takes
an explicit book; single-capture (`addScannedBook`, `addScannedBookAndList`) then
calls it with `_scannedBookData`, and the batch path calls it per row. Behavior of
the single path must stay byte-identical — **`verify-batchscan.js` must still pass
unchanged.**

---

## 6. HTML / CSS

- `index.html`: a "Scan a Shelf (many books)" button in the scanner's capture-
  choice area + a hidden `#scannerShelfInput` file input (`accept="image/*"
  capture="environment"`), and a `#scannerShelfReview` container for the checklist.
  Every new handler (`scanShelfPhoto`, `addSelectedShelfBooks`, any row actions)
  **must** be added to the `Object.assign(window, {…})` block in `main.js` — module
  scope means a missing entry is a silent dead button.
- `js/main.js`: export the new functions to `window`; add them to the module's
  export list. No new `initScanner` deps required — `ensureBook`,
  `renderBookSearchResults`, and the shelf loaders are already injected.
- `css/style.css`: review-list styles (rows, checkbox target ≥44px, flagged-row
  accent). Mobile bottom-sheet rules already apply to the modal; the review list
  needs its own scroll container so a 20-row list scrolls inside the sheet.

---

## 7. Loop metrics

- Each **confirmed** book (a checked row that successfully adds) bumps `captures`
  — consistent with "a book reached a confirmed, added state." The photo itself is
  not a capture.
- Add `shelfPhotos` (count of shelf shots) so `booksPerShelfPhoto` becomes a
  derivable health number for this path.
- Duplicates (within the batch or against the existing shelf) bump `duplicates`
  as today; they don't bump `captures`.
- `addAndList` / `listingsCreated` are **untouched** — shelf capture never lists
  (see §9).

---

## 8. Decisions (locked July 25, 2026)

1. **Scope of "shelf" mode** — **one mode covering both spines and a stack/fan of
   covers**; the prompt handles either and Gemini decides. No separate modes.
2. **Pre-check policy** — **high + medium confidence rows start checked**; low-
   confidence and no-match rows start unchecked.
3. **Cap per photo** — **30 books**, enforced server-side in `vision-extract`.
4. **Entry point** — **a distinct, prominent "Scan a Shelf" button**, separate
   from "Read Book Cover" (many-vs-one is a different mental model).

---

## 9. Explicit non-goals (keep it scoped)

- **No per-book price/condition in the batch.** Shelf capture is shelf-only;
  "Add & List" stays a single-book action. Listing 15 books = 15 condition/price
  decisions — outside the shelf-add rhythm.
- No image annotation / tap-a-spine-on-the-photo selection — the review list is
  text+thumbnail rows, not bounding boxes.
- No per-spine crop or re-photograph.
- No live-video continuous shelf detection — one still photo per shot.
- No completeness guarantee — the prompt skips unreadable books; misses fall back
  to single capture.

---

## 10. Failure modes

| Situation | Behavior |
|---|---|
| Vision returns 0 books | "Couldn't identify books — try better lighting or fewer books per shot, or scan individually." |
| Title has no catalog match | Row flagged `unmatched`, unchecked, with manual-search affordance |
| Same book detected twice | Deduped by resolved book id before render |
| N over the cap | Capped + "showing first 30" notice |
| Some adds fail on submit | "Added 12 of 14 — 2 couldn't be saved" |
| `GEMINI_API_KEY` unset | Same graceful message as the cover path; single capture still works |

---

## 11. Dependencies

- **Hard:** `db/books_isbn_nullable.sql` applied (ToDo 14). Shelf spines frequently
  resolve to old / no-ISBN editions; without the migration those rows fail to
  save, gutting the feature. Same dependency as the single-cover path.
- `GEMINI_API_KEY` set (already required by the cover path).

---

## 12. Verification

- New `verify-shelfscan.js` (batchscan-style, 390×844): stub the `vision-extract`
  shelf response and `searchBooksAPI`; drive shelf button → review screen renders
  N rows → uncheck one → add → asserts correct count added, modal stays coherent,
  metrics (`captures`, `shelfPhotos`) move correctly, no blocking dialogs.
- Re-run `verify-batchscan.js` (single path must be unchanged),
  `verify-vision.js`, `verify-mobile.js`.

---

## 13. Rough effort

| Piece | Size |
|---|---|
| Edge Function (`shelf` mode + prompt + cap) | small — ~½ session |
| Client (review screen, bounded concurrency, `_addBookToShelf` refactor) | medium — the bulk, ~1–2 sessions |
| HTML/CSS + window wiring | small |
| `verify-shelfscan.js` + docs + mobile pass | ~½ session |

Sequence: Edge Function first (independently testable), then the shared shelf-add
refactor (kept green against verify-batchscan), then the review screen, then the
harness.

---

## 14. Acceptance criteria (for the eventual build)

- [ ] `vision-extract` `shelf` mode returns a bounded JSON array from a real shelf photo.
- [ ] Review screen shows one row per detected book with a resolved catalog match.
- [ ] Pre-check policy (§8.2) applied; user can uncheck, swap match, or manually search a row.
- [ ] "Add N" performs a single reviewed batch add to Books I Have; one toast; partial failures reported honestly.
- [ ] No book is added that the user didn't leave checked (batch-level confirm invariant).
- [ ] `books` stays append-only (per-book `ensureBook` / no-ISBN insert; no upsert).
- [ ] Metrics: `captures` bumps per confirmed book; `shelfPhotos` bumps per shot.
- [ ] Single-book capture behavior unchanged (`verify-batchscan.js` green).
- [ ] `verify-shelfscan.js` passes; mobile layout holds at 360/390/414px.
