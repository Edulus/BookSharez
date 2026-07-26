// Barcode / cover scanner + core-loop instrumentation (extracted from
// main.js July 8, plan §5.2). Owns the scanner modal (#barcodeScannerModal):
// live camera + photo barcode scanning, vision OCR (cover capture), manual
// ISBN fallback, the batch-capture session chip, and the loop metrics.
// Everything that crosses the module boundary (catalog ensureBook, shelf
// loaders, sell-modal pre-fill, search-result picker) is injected by main.js
// via initScanner(deps) — never imported back (same pattern as book-render).
import { searchBooksAPI } from "./api-lookup.js";
import { escapeHTML } from "./dom-utils.js";
import { FALLBACK_COVER } from "./book-render.js";

// Callbacks into main.js, injected once at startup.
let deps = {};

export function initScanner(d) {
  deps = d;
}

let _scanStream = null;      // MediaStream from getUserMedia
let _scanAnimFrame = null;   // requestAnimationFrame id
let _scannerFallback = null; // html5-qrcode instance (fallback only)
// ── Loop metrics (improvement plan §3.0 — the core loop's two health numbers) ──
// Session-scoped instrumentation, deliberately light: sessionStorage + a
// console.debug line per event. No database, no user-facing dashboard yet.
// Definitions:
//   captures        — a book reached the found screen (barcode, manual ISBN,
//                     or cover-confirmed candidate — no-ISBN included)
//   addsHave/Want/
//   addAndList      — which of the three intents the user tapped (and it
//                     succeeded). Kept separate: they mean different things.
//   duplicates      — shelf adds that resolved to an already-existing entry
//                     (marked as an outcome; the intent counter still counts)
//   listingsCreated — an Add & List flow's listing POST actually succeeded
//                     (intent ≠ creation; the seller must submit the form)
//   activeMs        — accumulated time with the scanner open (rate basis)
// Headline numbers: capturesPerMinute and listingRate (= listingsCreated/captures).

const _LOOP_METRICS_KEY = "bsLoopMetrics";
let _scannerOpenedAt = null; // in-progress open-time slice
let _pendingLoopListing = false; // Add & List tapped; awaiting the seller's submit

function _loopMetricsRaw() {
  try { return JSON.parse(sessionStorage.getItem(_LOOP_METRICS_KEY)) || {}; }
  catch (e) { return {}; }
}

function _bumpLoopMetric(field, n = 1) {
  try {
    const m = _loopMetricsRaw();
    m[field] = (m[field] || 0) + n;
    sessionStorage.setItem(_LOOP_METRICS_KEY, JSON.stringify(m));
    console.debug("[loop]", JSON.stringify(loopMetricsSummary()));
  } catch (e) { /* metrics must never break the loop */ }
}

function _loopTimerStart() {
  if (_scannerOpenedAt === null) _scannerOpenedAt = Date.now();
}

function _loopTimerStop() {
  if (_scannerOpenedAt !== null) {
    _bumpLoopMetric("activeMs", Date.now() - _scannerOpenedAt);
    _scannerOpenedAt = null;
  }
}

// Debug/harness view — window.loopMetricsSummary() in the console.
function loopMetricsSummary() {
  const m = _loopMetricsRaw();
  const captures = m.captures || 0;
  const listingsCreated = m.listingsCreated || 0;
  const activeMs = (m.activeMs || 0) + (_scannerOpenedAt !== null ? Date.now() - _scannerOpenedAt : 0);
  const minutes = activeMs / 60000;
  const shelfPhotos = m.shelfPhotos || 0;
  return {
    captures,
    addsHave: m.addsHave || 0,
    addsWant: m.addsWant || 0,
    addAndList: m.addAndList || 0,
    duplicates: m.duplicates || 0,
    listingsCreated,
    shelfPhotos,
    activeMs,
    capturesPerMinute: minutes > 0 ? Number((captures / minutes).toFixed(2)) : 0,
    listingRate: captures > 0 ? Number((listingsCreated / captures).toFixed(3)) : 0,
    booksPerShelfPhoto: shelfPhotos > 0 ? Number((captures / shelfPhotos).toFixed(1)) : 0,
  };
}

let _scannerTarget = null;   // 'shelf' | 'sell' | 'dashboard'
let _scannedBookData = null;
let _shelfRows = [];         // multi-book shelf-photo review rows (batch capture)
let _lastScanFile = null;    // File kept for AI barcode retry after Quagga/BarcodeDetector fails
let _lastCaptureLive = false; // true when the current capture came from live camera (batch mode restarts it)
let _addedMsgTimer = null;

// ── Batch capture (core loop) ────────────────────────────────────────────────
// The session counter persists per calendar day in localStorage so closing the
// modal (or an accidental refresh) doesn't zero the "added tonight" feeling.

function _captureCountKey() {
  return "bsCaptures:" + new Date().toISOString().slice(0, 10);
}

function _getCaptureCount() {
  try { return Number(localStorage.getItem(_captureCountKey())) || 0; }
  catch (e) { return 0; }
}

function _updateSessionChip() {
  const chip = document.getElementById("scannerSessionCount");
  if (!chip) return;
  const n = _getCaptureCount();
  chip.textContent = n + (n === 1 ? " book added today" : " books added today");
  chip.style.display = n > 0 ? "" : "none";
}

function _bumpCaptureCount() {
  try { localStorage.setItem(_captureCountKey(), String(_getCaptureCount() + 1)); }
  catch (e) { /* storage unavailable — chip just won't persist */ }
  _updateSessionChip();
}

// Green confirmation inside the scanning state; auto-hides so the viewfinder
// stays clean while the user lines up the next book.
function _flashAddedMessage(html) {
  const el = document.getElementById("scannerAddedMsg");
  if (!el) return;
  el.innerHTML = html;
  el.style.display = "";
  clearTimeout(_addedMsgTimer);
  _addedMsgTimer = setTimeout(() => { el.style.display = "none"; }, 3500);
}

function openBookScanner() {
  _scannerTarget = "dashboard";
  _openScannerModal();
}

function openBarcodeScanner(target) {
  _scannerTarget = target;
  _openScannerModal();
}

function _openScannerModal() {
  _loopTimerStart();
  _scannedBookData = null;
  _showScannerState("scanning");
  _resetCameraView();
  _updateSessionChip();
  document.getElementById("scannerPhotoInput").value = "";
  document.getElementById("scannerGalleryInput").value = "";
  document.getElementById("barcodeScannerModal").style.display = "block";
}

function _resetCameraView() {
  const view = document.getElementById("barcodeScannerView");
  const statusEl = document.getElementById("scannerStatus");
  const btn = document.getElementById("btnLiveCamera");
  view.style.display = "none";
  view.innerHTML = "";
  statusEl.style.display = "none";
  statusEl.textContent = "";
  if (btn) btn.style.display = "";
}

function startLiveCamera() {
  _lastCaptureLive = true;
  const view = document.getElementById("barcodeScannerView");
  const statusEl = document.getElementById("scannerStatus");
  const btn = document.getElementById("btnLiveCamera");
  view.style.display = "";
  statusEl.style.display = "";
  statusEl.textContent = "Starting camera…";
  if (btn) btn.style.display = "none";
  _startLiveScanner();
}

function _showScannerState(state) {
  document.getElementById("scannerStateScanning").style.display = state === "scanning" ? "" : "none";
  document.getElementById("scannerStateFound").style.display   = state === "found"    ? "block" : "none";
  document.getElementById("scannerStateShelfReview").style.display = state === "shelfReview" ? "block" : "none";
}

async function _startLiveScanner() {
  const view = document.getElementById("barcodeScannerView");
  const statusEl = document.getElementById("scannerStatus");
  view.innerHTML = "";

  try {
    _scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    });

    const video = document.createElement("video");
    video.srcObject = _scanStream;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.style.cssText = "width:100%;border-radius:8px;display:block;";
    view.appendChild(video);
    await video.play();

    if ("BarcodeDetector" in window) {
      // Native BarcodeDetector — hardware-accelerated, works great on Android Chrome
      const detector = new BarcodeDetector({
        formats: ["ean_13", "ean_8", "code_128", "upc_a", "upc_e"],
      });
      statusEl.textContent = "Point the barcode at the camera";
      let detected = false;
      const scan = async () => {
        if (detected) return;
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            detected = true;
            await _onBarcodeDetected(barcodes[0].rawValue);
            return;
          }
        } catch (e) { /* per-frame errors are normal */ }
        _scanAnimFrame = requestAnimationFrame(scan);
      };
      _scanAnimFrame = requestAnimationFrame(scan);
    } else {
      // BarcodeDetector not available — use html5-qrcode over the stream
      statusEl.textContent = "Point the barcode at the camera";
      _scannerFallback = new Html5Qrcode("barcodeScannerView");
      // html5-qrcode will create its own video; remove ours first
      view.innerHTML = "";
      _scanStream.getTracks().forEach(t => t.stop());
      _scanStream = null;
      await _scannerFallback.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 100 } },
        (isbn) => _onBarcodeDetected(isbn),
        () => {}
      );
    }
  } catch (err) {
    statusEl.textContent = "Camera access denied — please allow camera access, then reopen.";
    console.warn("Camera error:", err);
  }
}

async function _stopLiveScanner() {
  if (_scanAnimFrame) { cancelAnimationFrame(_scanAnimFrame); _scanAnimFrame = null; }
  if (_scanStream) { _scanStream.getTracks().forEach(t => t.stop()); _scanStream = null; }
  if (_scannerFallback) {
    try {
      if (_scannerFallback.isScanning) await _scannerFallback.stop();
      _scannerFallback.clear();
    } catch (e) { /* ignore */ }
    _scannerFallback = null;
  }
}

// Land a capture on the "book found" screen — the single destination for
// every successful capture path (barcode, cover candidate, manual ISBN), so
// all of them expose the same three choices: Have / Want / Add & List.
function _showBookFound(book) {
  _bumpLoopMetric("captures"); // metric: any capture path reaching this screen
  _scannedBookData = book;
  document.getElementById("scannerBookCover").src = book.cover_url || FALLBACK_COVER;
  document.getElementById("scannerBookTitle").textContent = book.title || "Unknown Title";
  document.getElementById("scannerBookAuthor").textContent = book.author ? "by " + book.author : "";
  _showScannerState("found");
}

// A cover candidate the user just confirmed already carries verified
// metadata; the catalog lookup only adds the canonical id (dedup) when an
// ISBN exists. Never re-derive via the barcode pipeline — a failed re-lookup
// would lose data we already have (§3.0 cover-path parity).
async function _confirmCoverCandidate(book) {
  let data = {
    isbn: book.isbn || null,
    title: book.title,
    author: book.author || "",
    cover_url: book.cover || "",
  };
  if (book.isbn) {
    try {
      const { data: row } = await supabaseClient
        .from("books")
        .select("id, isbn, title, author, cover_url")
        .eq("isbn", book.isbn)
        .maybeSingle();
      if (row) data = row;
    } catch (e) { /* catalog unavailable — the candidate data is enough */ }
  }
  _showBookFound(data);
}

async function _onBarcodeDetected(isbn) {
  // Reject non-ISBN barcodes (UPC-A, store price codes, etc.)
  const isIsbn13 = /^97[89]\d{10}$/.test(isbn);
  const isIsbn10 = /^\d{9}[\dXx]$/.test(isbn);
  if (!isIsbn13 && !isIsbn10) {
    const statusEl = document.getElementById("scannerStatus");
    statusEl.style.display = "";
    statusEl.textContent = "That’s a price barcode, not an ISBN — enter the ISBN below:";
    document.getElementById("scannerManualEntry").style.display = "";
    document.getElementById("scannerManualISBN").focus();
    document.getElementById("scannerPhotoInput").value = "";
    document.getElementById("scannerGalleryInput").value = "";
    return;
  }

  await _stopLiveScanner();
  document.getElementById("barcodeScannerView").innerHTML = "";

  if (_scannerTarget !== "dashboard") {
    await closeBarcodeScanner();
    if (_scannerTarget === "shelf") {
      document.getElementById("shelfISBN").value = isbn;
      await deps.lookupShelfISBN();
    } else {
      document.getElementById("bookISBN").value = isbn;
      await deps.lookupISBN();
    }
    return;
  }

  const statusEl = document.getElementById("scannerStatus");
  statusEl.textContent = "ISBN " + isbn + " — looking up…";

  const book = await _fetchBookByISBN(isbn);

  if (!book) {
    // Lookup failed — let the user add it manually with the ISBN pre-filled
    statusEl.textContent = "Couldn't load book info. You can still add it manually.";
    _showBookFound({ isbn, title: "ISBN: " + isbn, author: "", cover_url: "" });
    document.getElementById("scannerBookAuthor").textContent =
      "Title unknown — tap below to add anyway";
    return;
  }

  _showBookFound(book);
}

// Manual ISBN entry inside the scanner modal (the fallback shown when a scan
// fails). Routes through the same path as a successful barcode scan.
// Was referenced by index.html but never defined until July 4 — the "Look up"
// button threw a ReferenceError.
async function scannerManualLookup() {
  _lastCaptureLive = false;
  const input = document.getElementById("scannerManualISBN");
  const isbn = (input.value || "").replace(/[\s-]/g, "");
  if (!/^(\d{13}|\d{9}[\dXx])$/.test(isbn)) {
    const statusEl = document.getElementById("scannerStatus");
    statusEl.style.display = "";
    statusEl.textContent = "Enter a valid ISBN (10 or 13 digits).";
    input.focus();
    return;
  }
  document.getElementById("scannerManualEntry").style.display = "none";
  await _onBarcodeDetected(isbn);
}

async function _fetchBookByISBN(isbn) {
  const timeout = (ms) => new Promise((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), ms));

  try {
    const { data } = await Promise.race([
      supabaseClient.from("books").select("id, isbn, title, author, cover_url")
        .eq("isbn", isbn).maybeSingle(),
      timeout(2000),
    ]);
    if (data) return data;
  } catch (e) { /* timeout or error — fall through */ }

  try {
    const results = await Promise.race([searchBooksAPI(isbn), timeout(5000)]);
    if (results && results.length > 0) {
      const b = results[0];
      return { isbn, title: b.title, author: b.author, cover_url: b.cover };
    }
  } catch (e) { /* ignore */ }

  return null;
}

// Shared core: put a *specific* book on a shelf. Returns
// { book, bookId, entryId, isDuplicate } on success (duplicates count as
// success and resolve to the *existing* entry id, so Add & List can link the
// listing to it), or null on failure (after alerting). Both single-capture
// (via _addScannedToShelf) and batch shelf-photo capture route through here,
// so the append-only books invariant and the no-ISBN insert path live in one
// place. `book` shape: { id?, isbn?, title, author, cover_url }.
async function _addBookToShelf(book, shelfType, opts = {}) {
  if (!book) return null;
  // Batch shelf capture passes { silent:true } so one bad row doesn't fire a
  // dialog per book; it aggregates failures into a single summary toast. The
  // single-capture path passes nothing → alerts exactly as before.
  const alertErr = (m) => { if (!opts.silent) alert(m); };
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) { alertErr("Please log in first."); return null; }

  let bookId = book.id;

  if (!bookId && book.isbn) {
    // Reuse the shared select→insert helper. NEVER upsert here: catalog rows
    // are append-only for clients (§6.1) — an upsert's ON CONFLICT DO UPDATE
    // would let any user overwrite the canonical title/author/cover for a
    // shared ISBN (and is denied by RLS anyway, since books has no client
    // UPDATE policy).
    try {
      bookId = await deps.ensureBook({
        isbn: book.isbn,
        title: book.title,
        author: book.author,
        coverUrl: book.cover_url,
      });
    } catch (e) {
      console.error("Couldn't ensure catalog book:", e);
      alertErr("Couldn't save book. Please try again.");
      return null;
    }
  } else if (!bookId) {
    // No ISBN (pre-ISBN era books from the cover path). There is no key to
    // upsert on — never upsert with isbn:"" (all such books would collapse
    // into one row). Best-effort dedup by exact title+author, else insert.
    // Requires db/books_isbn_nullable.sql (ToDo 14); until applied the insert
    // fails and the user sees the retry alert.
    let query = supabaseClient
      .from("books").select("id").is("isbn", null).eq("title", book.title);
    query = book.author ? query.eq("author", book.author) : query.is("author", null);
    const { data: matches } = await query.limit(1);
    if (matches && matches.length) {
      bookId = matches[0].id;
    } else {
      const { data: inserted, error } = await supabaseClient
        .from("books")
        .insert({ isbn: null, title: book.title, author: book.author || null, cover_url: book.cover_url || null })
        .select("id").single();
      if (error || !inserted) { alert("Couldn't save book. Please try again."); return null; }
      bookId = inserted.id;
    }
  }

  const { data: entry, error: shelfError } = await supabaseClient
    .from("shelf_entries")
    .insert({ user_id: user.id, book_id: bookId, shelf_type: shelfType })
    .select("id")
    .single();

  const isDuplicate = !!(shelfError && shelfError.code === "23505");
  if (shelfError && !isDuplicate) {
    alertErr("Couldn't add to shelf. Please try again.");
    return null;
  }

  let entryId = entry ? entry.id : null;
  if (isDuplicate) {
    const { data: existing } = await supabaseClient
      .from("shelf_entries")
      .select("id")
      .eq("user_id", user.id)
      .eq("book_id", bookId)
      .eq("shelf_type", shelfType)
      .maybeSingle();
    entryId = existing ? existing.id : null;
  }

  return { book, bookId, entryId, isDuplicate };
}

// Thin wrapper for the single-capture paths: operates on the currently
// scanned book. Batch shelf capture calls _addBookToShelf directly per row.
async function _addScannedToShelf(shelfType) {
  return _addBookToShelf(_scannedBookData, shelfType);
}

async function addScannedBook(shelfType) {
  const result = await _addScannedToShelf(shelfType);
  if (!result) return;
  const { book, isDuplicate } = result;

  _bumpLoopMetric(shelfType === "have" ? "addsHave" : "addsWant"); // metric: intent
  if (isDuplicate) _bumpLoopMetric("duplicates"); // metric: outcome overlay

  // Batch capture (core loop): stay in the scanner and go straight back to
  // capture — the next book must cost zero extra taps. The shelf refreshes in
  // the background; the modal closes only when the user decides they're done.
  if (!isDuplicate) _bumpCaptureCount();
  if (shelfType === "have") deps.loadShelfHave(); else deps.loadShelfWant();

  const shelfLabel = shelfType === "have" ? "Books I Have" : "Books I Want";
  await scannerReset();
  _flashAddedMessage(
    isDuplicate
      ? `<i class="fas fa-info-circle"></i> “${escapeHTML(book.title)}” is already on your shelf.`
      : `<i class="fas fa-check-circle"></i> “${escapeHTML(book.title)}” added to ${shelfLabel}.`
  );
  // If the capture came from live camera, put the viewfinder straight back up.
  // Photo/manual paths return to the capture-choice screen (a file picker
  // can't be reopened programmatically).
  if (_lastCaptureLive) startLiveCamera();
}

// "Add & List" (plan §3.0): one clean transition from a fresh capture into a
// pre-filled sell form. The book lands on Books I Have, the scanner closes,
// and the sell modal opens with the details filled in. The listing is created
// only when the user confirms condition/price and submits — never silently.
async function addScannedBookAndList() {
  const result = await _addScannedToShelf("have");
  if (!result) return;

  _bumpLoopMetric("addAndList"); // metric: listing INTENT (creation counts on submit)
  if (result.isDuplicate) _bumpLoopMetric("duplicates");
  _pendingLoopListing = true; // consumed by handleSellBook on successful insert

  if (!result.isDuplicate) _bumpCaptureCount();
  deps.loadShelfHave(); // background refresh

  await closeBarcodeScanner();
  deps.openSellModalPrefilled(
    result.book,
    result.entryId,
    "Added to your shelf ✓ — confirm condition and price below",
    result.bookId
  );
}

async function scannerReset() {
  await _stopLiveScanner();
  _scannedBookData = null;
  _lastScanFile = null;
  _shelfRows = [];
  _showScannerState("scanning");
  _resetCameraView();
  document.getElementById("scannerAddedMsg").style.display = "none";
  document.getElementById("scannerPhotoInput").value = "";
  document.getElementById("scannerGalleryInput").value = "";
  document.getElementById("scannerCoverInput").value = "";
  document.getElementById("scannerShelfInput").value = "";
  document.getElementById("scannerVisionFallback").style.display = "none";
  document.getElementById("scannerCoverResults").style.display = "none";
}

async function closeBarcodeScanner() {
  _loopTimerStop();
  await _stopLiveScanner();
  _lastCaptureLive = false;
  clearTimeout(_addedMsgTimer);
  document.getElementById("barcodeScannerModal").style.display = "none";
  document.getElementById("scannerAddedMsg").style.display = "none";
  document.getElementById("barcodeScannerView").innerHTML = "";
  document.getElementById("scannerPhotoInput").value = "";
  document.getElementById("scannerGalleryInput").value = "";
  document.getElementById("scannerCoverInput").value = "";
  document.getElementById("scannerShelfInput").value = "";
  document.getElementById("scannerVisionFallback").style.display = "none";
  document.getElementById("scannerCoverResults").style.display = "none";
  _scannedBookData = null;
  _lastScanFile = null;
  _shelfRows = [];
}

async function scanFromPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  _lastCaptureLive = false;
  _lastScanFile = file; // saved for AI barcode retry
  const statusEl = document.getElementById("scannerStatus");
  statusEl.style.display = "";
  statusEl.textContent = "Scanning photo…";
  await _stopLiveScanner();

  // Native BarcodeDetector handles full-res photos perfectly
  if ("BarcodeDetector" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      const detector = new BarcodeDetector({
        formats: ["ean_13", "ean_8", "code_128", "upc_a", "upc_e"],
      });
      const barcodes = await detector.detect(bitmap);
      if (barcodes.length > 0) {
        await _onBarcodeDetected(barcodes[0].rawValue);
        return;
      }
    } catch (e) { console.warn("BarcodeDetector photo scan failed:", e); }
  }

  // Quagga2 fallback — purpose-built for 1D barcodes from static images.
  // html5-qrcode's bundled ZXing-js is kept only for the live camera path.
  const objUrl = URL.createObjectURL(file);
  try {
    const isbn = await new Promise((resolve) => {
      Quagga.decodeSingle({
        src: objUrl,
        numOfWorkers: 0,
        decoder: { readers: ["ean_reader", "ean_8_reader", "code_128_reader", "upc_reader"] },
        locate: true,
      }, (result) => {
        resolve(result && result.codeResult ? result.codeResult.code : null);
      });
    });
    if (isbn) {
      await _onBarcodeDetected(isbn);
    } else {
      statusEl.textContent = "Couldn't read barcode — try AI reader, scan the cover, or enter manually.";
      document.getElementById("scannerVisionFallback").style.display = "";
      input.value = "";
      document.getElementById("scannerPhotoInput").value = "";
      document.getElementById("scannerGalleryInput").value = "";
    }
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Vision OCR helpers (vision-extract Edge Function)
// ─────────────────────────────────────────────────────────────────────────────

// Compress a File to under 4.5 MB and return { base64, mimeType }.
// Uses canvas resize when the file is oversized; reads directly otherwise.
async function _compressAndEncode(file) {
  const MAX_BYTES = 4.5 * 1024 * 1024;

  if (file.size <= MAX_BYTES) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const [header, base64] = dataUrl.split(",");
        const mimeType = header.match(/:(.*?);/)?.[1] || "image/jpeg";
        const allowed = ["image/jpeg", "image/png", "image/webp"];
        resolve({ base64, mimeType: allowed.includes(mimeType) ? mimeType : "image/jpeg" });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // Oversized — scale down via canvas (preserves aspect ratio).
  const bitmap = await createImageBitmap(file);
  const scale = Math.sqrt(MAX_BYTES / file.size);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("Canvas compression failed")); return; }
      const reader = new FileReader();
      reader.onload = () => {
        resolve({ base64: reader.result.split(",")[1], mimeType: "image/jpeg" });
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }, "image/jpeg", 0.85);
  });
}

// Call the vision-extract Edge Function. Returns the parsed `data` object,
// or throws with a user-safe message on failure.
async function _callVisionExtract(base64, mimeType, mode) {
  const { data, error } = await supabaseClient.functions.invoke("vision-extract", {
    body: { imageBase64: base64, mimeType, mode },
  });
  if (error) throw new Error(error.message || "Vision read failed");
  if (!data.ok) throw new Error(data.error || "Couldn't read the image.");
  return data.data;
}

// Called by the "Try AI barcode reader" button — retries the last failed
// scan photo through the vision-extract Edge Function (barcode mode).
async function retryWithVision() {
  if (!_lastScanFile) return;
  _lastCaptureLive = false;
  const statusEl = document.getElementById("scannerStatus");
  document.getElementById("scannerVisionFallback").style.display = "none";
  statusEl.style.display = "";
  statusEl.textContent = "Reading barcode with AI…";

  try {
    const { base64, mimeType } = await _compressAndEncode(_lastScanFile);
    const result = await _callVisionExtract(base64, mimeType, "barcode");
    const isbn = (result.isbn || "").replace(/[\s-]/g, "");

    if (/^(\d{13}|\d{9}[\dXx])$/.test(isbn)) {
      statusEl.textContent = "Barcode read: " + isbn + " — looking up…";
      await _onBarcodeDetected(isbn);
    } else {
      statusEl.textContent = "Couldn't read the ISBN. Try scanning the cover or enter manually.";
      document.getElementById("scannerManualEntry").style.display = "";
    }
  } catch (e) {
    console.error("Vision barcode retry failed:", e);
    statusEl.textContent = e.message || "Couldn't read the image. Enter details manually.";
    document.getElementById("scannerManualEntry").style.display = "";
  }
}

// Called by the "Read Book Cover" file input. Sends the cover photo to
// vision-extract (cover mode), searches by the returned title/author,
// and shows candidates for the user to confirm — never silently auto-fills.
async function scanCoverPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  _lastCaptureLive = false;

  const statusEl = document.getElementById("scannerStatus");
  const coverResultsDiv = document.getElementById("scannerCoverResults");
  statusEl.style.display = "";
  statusEl.textContent = "Reading cover…";
  coverResultsDiv.style.display = "none";
  document.getElementById("scannerVisionFallback").style.display = "none";

  try {
    const { base64, mimeType } = await _compressAndEncode(file);
    const result = await _callVisionExtract(base64, mimeType, "cover");

    const title = (result.title || "").trim();
    const author = (result.author || "").trim();
    const isbnRaw = (result.isbn || "").replace(/[\s-]/g, "");

    // High-confidence ISBN on the cover — route straight to barcode flow.
    if (isbnRaw && /^(\d{13}|\d{9}[\dXx])$/.test(isbnRaw) && result.confidence === "high") {
      statusEl.textContent = "ISBN found on cover: " + isbnRaw + " — looking up…";
      await _onBarcodeDetected(isbnRaw);
      return;
    }

    if (!title) {
      statusEl.textContent = "Couldn't read the cover. Try a clearer photo or enter details manually.";
      document.getElementById("scannerManualEntry").style.display = "";
      return;
    }

    const query = [title, author].filter(Boolean).join(" ");
    statusEl.textContent = "Searching: " + [title, author].filter(Boolean).join(" · ") + "…";

    // requireIsbn:false — pre-ISBN books are a normal cover-path outcome and
    // must be selectable candidates, not silently dropped.
    const results = await searchBooksAPI(query, { requireIsbn: false });
    if (!results.length) {
      statusEl.textContent = "No matches found. Try entering the ISBN or title manually.";
      document.getElementById("scannerManualEntry").style.display = "";
      return;
    }

    statusEl.textContent = "Select the correct book:";
    coverResultsDiv.style.display = "";
    deps.renderBookSearchResults(results.slice(0, 5), coverResultsDiv, async (book) => {
      coverResultsDiv.style.display = "none";
      statusEl.textContent = "";
      if (_scannerTarget === "sell") {
        await closeBarcodeScanner();
        deps.selectSellBook(book.isbn || "", book.title, book.author, book.cover);
      } else if (_scannerTarget === "shelf") {
        await closeBarcodeScanner();
        deps.selectShelfBook(book.isbn || "", book.title, book.author, book.cover);
      } else {
        // Dashboard capture: land on the same found screen as a barcode scan
        // (Have / Want / Add & List) — with or without an ISBN.
        await _confirmCoverCandidate(book);
      }
    });
  } catch (e) {
    console.error("Cover scan failed:", e);
    statusEl.textContent = e.message || "Couldn't read the cover. Enter details manually.";
    document.getElementById("scannerManualEntry").style.display = "";
  } finally {
    input.value = "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-book shelf-photo capture (docs/SHELF_PHOTO_CAPTURE.md)
// One photo → many book hints (vision-extract "shelf" mode) → resolve each to a
// catalog candidate → a single batch REVIEW screen (deselect, don't confirm
// each) → bulk add to a shelf. The batch-level confirm keeps the cover-path
// invariant: nothing is added the user didn't leave checked.
// ─────────────────────────────────────────────────────────────────────────────

// Called by the "Scan a Shelf" file input. Reads many books from one photo and
// hands off to the review screen. Never silently adds anything.
async function scanShelfPhoto(input) {
  const file = input.files[0];
  if (!file) return;
  _lastCaptureLive = false;

  const statusEl = document.getElementById("scannerStatus");
  statusEl.style.display = "";
  statusEl.textContent = "Reading shelf…";
  document.getElementById("scannerVisionFallback").style.display = "none";
  document.getElementById("scannerCoverResults").style.display = "none";
  await _stopLiveScanner();

  try {
    const { base64, mimeType } = await _compressAndEncode(file);
    const result = await _callVisionExtract(base64, mimeType, "shelf");
    const books = (result && Array.isArray(result.books)) ? result.books : [];

    if (!books.length) {
      statusEl.textContent =
        "Couldn't identify books in this photo — try better lighting or fewer books per shot, or scan them individually.";
      return;
    }

    statusEl.textContent = "Matching " + books.length + " book" + (books.length === 1 ? "" : "s") + "…";
    const rows = await _resolveShelfCandidates(books);
    _bumpLoopMetric("shelfPhotos"); // metric: one shelf shot (books count on add)
    statusEl.style.display = "none";
    statusEl.textContent = "";
    _renderShelfReview(rows);
  } catch (e) {
    console.error("Shelf scan failed:", e);
    statusEl.textContent = e.message || "Couldn't read the shelf. Try again or scan books individually.";
  } finally {
    input.value = "";
  }
}

// Resolve each detected {title, author, confidence} to a catalog candidate via
// searchBooksAPI, with bounded concurrency so a 30-book shelf doesn't fan out
// into 30 simultaneous requests. Dedupes rows that resolve to the same book.
async function _resolveShelfCandidates(books) {
  const CONCURRENCY = 4;
  const rows = new Array(books.length);
  let next = 0;

  async function worker() {
    while (next < books.length) {
      const i = next++;
      const b = books[i];
      const query = [b.title, b.author].filter(Boolean).join(" ");
      let match = null;
      try {
        // requireIsbn:false — pre-ISBN / old editions are normal shelf finds.
        const results = await searchBooksAPI(query, { requireIsbn: false });
        if (results && results.length) match = results[0];
      } catch (e) { /* no match — the row stays unmatched */ }
      const highOrMed = b.confidence === "high" || b.confidence === "medium";
      rows[i] = {
        detected: b,
        match,
        status: match ? "matched" : "unmatched",
        // Pre-check policy (§8): a catalog match AND high/medium confidence.
        checked: !!match && highOrMed,
      };
    }
  }

  const n = Math.min(CONCURRENCY, books.length);
  await Promise.all(Array.from({ length: n }, worker));

  // Dedup: two spines can read to the same book (or the same title twice).
  const seen = new Set();
  const deduped = [];
  for (const r of rows) {
    const m = r.match;
    const key = m
      ? (m.isbn ? "i:" + m.isbn
         : "t:" + (m.title || "").toLowerCase() + "|" + (m.author || "").toLowerCase())
      : "d:" + (r.detected.title || "").toLowerCase() + "|" + (r.detected.author || "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  return deduped;
}

// Build the review checklist. DOM-constructed (not innerHTML) so titles with
// quotes/brackets can't break markup — same rule as the shelf/profile cards.
function _renderShelfReview(rows) {
  _shelfRows = rows;
  const list = document.getElementById("scannerShelfList");
  const matched = rows.filter(r => r.status === "matched").length;
  document.getElementById("scannerShelfHint").textContent =
    "Found " + matched + " of " + rows.length + " — uncheck any that are wrong, then add:";
  list.innerHTML = "";

  rows.forEach((r, i) => {
    const m = r.match || {};
    const title = (r.match ? (m.title || r.detected.title) : r.detected.title) || "Unknown title";
    const author = r.match ? (m.author || "") : (r.detected.author || "");
    const cover = (r.match && m.cover) || FALLBACK_COVER;

    const rowEl = document.createElement("label");
    rowEl.className = "scanner-shelf-row" + (r.status === "unmatched" ? " scanner-shelf-row-unmatched" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "scanner-shelf-check";
    cb.checked = r.checked;
    cb.disabled = r.status === "unmatched";
    cb.addEventListener("change", () => { _shelfRows[i].checked = cb.checked; _updateShelfAddBtn(); });

    const img = document.createElement("img");
    img.className = "scanner-shelf-cover";
    img.src = cover;
    img.alt = "";

    const info = document.createElement("div");
    info.className = "scanner-shelf-info";
    const t = document.createElement("div");
    t.className = "scanner-shelf-title";
    t.textContent = title;
    const a = document.createElement("div");
    a.className = "scanner-shelf-author";
    a.textContent = r.status === "unmatched"
      ? "No catalog match — scan this one individually"
      : (author ? "by " + author : "");
    info.appendChild(t);
    info.appendChild(a);

    rowEl.appendChild(cb);
    rowEl.appendChild(img);
    rowEl.appendChild(info);
    list.appendChild(rowEl);
  });

  _updateShelfAddBtn();
  _showScannerState("shelfReview");
}

function _updateShelfAddBtn() {
  const n = _shelfRows.filter(r => r.checked).length;
  const btn = document.getElementById("scannerShelfAddBtn");
  if (!btn) return;
  btn.textContent = n > 0 ? "Add " + n + " to Books I Have" : "Select books to add";
  btn.disabled = n === 0;
}

// Bulk-add the checked rows in one pass. Aggregates duplicates and failures
// into a single summary toast (no per-row dialogs — _addBookToShelf runs silent
// here). Each newly-added book counts as one capture.
async function addSelectedShelfBooks(shelfType = "have") {
  const selected = _shelfRows.filter(r => r.checked && r.match);
  if (!selected.length) return;

  const btn = document.getElementById("scannerShelfAddBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }

  let added = 0, dupes = 0, failed = 0;
  for (const r of selected) {
    const m = r.match;
    const book = {
      isbn: m.isbn || null,
      title: m.title || r.detected.title,
      author: m.author || r.detected.author || "",
      cover_url: m.cover || "",
    };
    const res = await _addBookToShelf(book, shelfType, { silent: true });
    if (!res) { failed++; continue; }
    _bumpLoopMetric(shelfType === "have" ? "addsHave" : "addsWant"); // metric: intent
    if (res.isDuplicate) {
      dupes++;
      _bumpLoopMetric("duplicates");
    } else {
      added++;
      _bumpLoopMetric("captures"); // metric: a book reached a confirmed, added state
      _bumpCaptureCount();
    }
  }

  if (shelfType === "have") deps.loadShelfHave(); else deps.loadShelfWant();

  const shelfLabel = shelfType === "have" ? "Books I Have" : "Books I Want";
  let msg = `<i class="fas fa-check-circle"></i> Added ${added} book${added === 1 ? "" : "s"} to ${shelfLabel}.`;
  if (dupes) msg += ` ${dupes} already on your shelf.`;
  if (failed) msg += ` ${failed} couldn’t be saved.`;

  await scannerReset();
  _flashAddedMessage(msg);
}

// ── Add & List completion (crosses the module boundary) ─────────────────────
// _pendingLoopListing is set when Add & List is tapped; the sell flow in
// main.js reports how it ended. Submitted successfully → count the listing;
// cancelled/abandoned or the form's book changed → not a created listing.
export function loopListingCreated() {
  if (_pendingLoopListing) {
    _pendingLoopListing = false;
    _bumpLoopMetric("listingsCreated");
  }
}

export function loopListingCancelled() {
  _pendingLoopListing = false;
}

export {
  openBookScanner, openBarcodeScanner, startLiveCamera, scanFromPhoto,
  scanCoverPhoto, retryWithVision, addScannedBook, addScannedBookAndList,
  scanShelfPhoto, addSelectedShelfBooks,
  scannerReset, closeBarcodeScanner, scannerManualLookup, loopMetricsSummary,
  // internal, but probed by verify-vision.js (through main.js's window block)
  _compressAndEncode, _callVisionExtract,
};
