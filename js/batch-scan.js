// Batch scanner enhancement for the dashboard scanner.
//
// Loaded after js/main.js by js/supabase-config.js. It deliberately wraps the
// existing scanner functions instead of rewriting the large prototype file.
// Core behavior: after adding a scanned book from the dashboard scanner, keep the
// modal open, show a non-blocking success flash, update a per-day session counter,
// refresh the shelf in the background, and return to the next capture state.

(function () {
  "use strict";

  const STORAGE_PREFIX = "booksharez.batchscan.added.";
  const TOAST_MS = 3500;
  const RESTART_DELAY_MS = 450;
  let lastCaptureWasLive = false;
  let adding = false;
  let toastTimer = null;

  function todayKey() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${STORAGE_PREFIX}${yyyy}-${mm}-${dd}`;
  }

  function getTodayCount() {
    return Number.parseInt(localStorage.getItem(todayKey()) || "0", 10) || 0;
  }

  function setTodayCount(count) {
    localStorage.setItem(todayKey(), String(Math.max(0, count)));
    renderCounterChip();
  }

  function incrementTodayCount() {
    setTodayCount(getTodayCount() + 1);
  }

  function shelfLabel(shelfType) {
    return shelfType === "have" ? "Books I Have" : "Books I Want";
  }

  function ensureCounterChip() {
    const header = document.querySelector("#barcodeScannerModal .modal-header");
    const title = document.getElementById("scannerModalTitle");
    if (!header || !title) return null;

    let chip = document.getElementById("scannerSessionCounter");
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "scannerSessionCounter";
      chip.className = "scanner-session-counter";
      header.insertBefore(chip, title.nextSibling);
    }
    return chip;
  }

  function renderCounterChip() {
    const chip = ensureCounterChip();
    if (!chip) return;
    const count = getTodayCount();
    chip.textContent = `${count} ${count === 1 ? "book" : "books"} added today`;
  }

  function ensureToast() {
    const content = document.querySelector("#barcodeScannerModal .scanner-modal-content");
    if (!content) return null;
    let toast = document.getElementById("scannerBatchToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "scannerBatchToast";
      toast.className = "scanner-batch-toast";
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      content.appendChild(toast);
    }
    return toast;
  }

  function showScannerToast(message, tone) {
    const toast = ensureToast();
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.className = `scanner-batch-toast ${tone || "success"} visible`;
    toast.textContent = message;
    toastTimer = setTimeout(() => {
      toast.classList.remove("visible");
    }, TOAST_MS);
  }

  function setActionButtonsDisabled(disabled) {
    document
      .querySelectorAll("#scannerStateFound .scanner-actions button")
      .forEach((btn) => { btn.disabled = disabled; });
  }

  function resetScannerInputs() {
    [
      "scannerPhotoInput",
      "scannerGalleryInput",
      "scannerCoverInput",
      "scannerManualISBN",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });

    ["scannerVisionFallback", "scannerCoverResults", "scannerManualEntry"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = "none";
        if (id === "scannerCoverResults") el.innerHTML = "";
      }
    });
  }

  async function returnToCaptureState() {
    const shouldRestartLive = lastCaptureWasLive;
    _scannedBookData = null;
    _lastScanFile = null;
    _showScannerState("scanning");
    _resetCameraView();
    resetScannerInputs();

    if (!shouldRestartLive) {
      lastCaptureWasLive = false;
      return;
    }

    window.setTimeout(() => {
      if (document.getElementById("barcodeScannerModal")?.style.display !== "block") return;
      lastCaptureWasLive = true;
      window.startLiveCamera();
    }, RESTART_DELAY_MS);
  }

  function refreshShelfInBackground(shelfType) {
    try {
      if (shelfType === "have" && typeof loadShelfHave === "function") loadShelfHave();
      if (shelfType === "want" && typeof loadShelfWant === "function") loadShelfWant();
    } catch (err) {
      console.warn("Shelf refresh after batch scan failed:", err);
    }
  }

  async function ensureScannedBookId(book) {
    if (book.id) return book.id;

    const { data: upserted, error } = await supabaseClient
      .from("books")
      .upsert(
        {
          isbn: book.isbn,
          title: book.title,
          author: book.author,
          cover_url: book.cover_url,
        },
        { onConflict: "isbn" }
      )
      .select("id")
      .single();

    if (error || !upserted) throw error || new Error("Book upsert returned no row");
    return upserted.id;
  }

  function isDuplicateShelfError(error) {
    return Boolean(
      error &&
      (error.code === "23505" || /duplicate|unique/i.test(error.message || ""))
    );
  }

  async function addScannedBookBatch(shelfType) {
    if (adding || !_scannedBookData) return;
    adding = true;
    setActionButtonsDisabled(true);

    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) {
        showScannerToast("Please log in first.", "error");
        return;
      }

      const book = _scannedBookData;
      const bookId = await ensureScannedBookId(book);
      const { error: shelfError } = await supabaseClient
        .from("shelf_entries")
        .insert({ user_id: user.id, book_id: bookId, shelf_type: shelfType });

      if (shelfError && !isDuplicateShelfError(shelfError)) throw shelfError;

      if (isDuplicateShelfError(shelfError)) {
        showScannerToast(`Already on ${shelfLabel(shelfType)} — not counted.`, "notice");
      } else {
        incrementTodayCount();
        showScannerToast(`“${book.title || "Book"}” added to ${shelfLabel(shelfType)}.`, "success");
      }

      refreshShelfInBackground(shelfType);
      await returnToCaptureState();
    } catch (err) {
      console.error("Batch scanner add failed:", err);
      showScannerToast("Couldn't add this book. Please try again.", "error");
    } finally {
      adding = false;
      setActionButtonsDisabled(false);
    }
  }

  function installFunctionWrappers() {
    const originalOpenBookScanner = window.openBookScanner;
    if (typeof originalOpenBookScanner === "function") {
      window.openBookScanner = function () {
        lastCaptureWasLive = false;
        const result = originalOpenBookScanner.apply(this, arguments);
        renderCounterChip();
        return result;
      };
    }

    const originalOpenBarcodeScanner = window.openBarcodeScanner;
    if (typeof originalOpenBarcodeScanner === "function") {
      window.openBarcodeScanner = function () {
        lastCaptureWasLive = false;
        const result = originalOpenBarcodeScanner.apply(this, arguments);
        renderCounterChip();
        return result;
      };
    }

    const originalStartLiveCamera = window.startLiveCamera;
    if (typeof originalStartLiveCamera === "function") {
      window.startLiveCamera = function () {
        lastCaptureWasLive = true;
        return originalStartLiveCamera.apply(this, arguments);
      };
    }

    const originalScanFromPhoto = window.scanFromPhoto;
    if (typeof originalScanFromPhoto === "function") {
      window.scanFromPhoto = function () {
        lastCaptureWasLive = false;
        return originalScanFromPhoto.apply(this, arguments);
      };
    }

    const originalScanCoverPhoto = window.scanCoverPhoto;
    if (typeof originalScanCoverPhoto === "function") {
      window.scanCoverPhoto = function () {
        lastCaptureWasLive = false;
        return originalScanCoverPhoto.apply(this, arguments);
      };
    }

    const originalRetryWithVision = window.retryWithVision;
    if (typeof originalRetryWithVision === "function") {
      window.retryWithVision = function () {
        lastCaptureWasLive = false;
        return originalRetryWithVision.apply(this, arguments);
      };
    }

    const originalCloseBarcodeScanner = window.closeBarcodeScanner;
    if (typeof originalCloseBarcodeScanner === "function") {
      window.closeBarcodeScanner = async function () {
        lastCaptureWasLive = false;
        clearTimeout(toastTimer);
        document.getElementById("scannerBatchToast")?.classList.remove("visible");
        return originalCloseBarcodeScanner.apply(this, arguments);
      };
    }

    window.addScannedBook = addScannedBookBatch;

    // The scanner modal already calls this from the manual ISBN input, but main.js
    // did not define it. Keep it here because manual ISBN entry is part of the
    // dashboard batch-capture loop.
    window.scannerManualLookup = async function () {
      lastCaptureWasLive = false;
      const input = document.getElementById("scannerManualISBN");
      const statusEl = document.getElementById("scannerStatus");
      const isbn = (input?.value || "").replace(/[\s-]/g, "");
      if (!/^(\d{13}|\d{9}[\dXx])$/.test(isbn)) {
        if (statusEl) {
          statusEl.style.display = "";
          statusEl.textContent = "Enter a valid ISBN — 10 or 13 digits.";
        }
        input?.focus();
        return;
      }
      if (statusEl) {
        statusEl.style.display = "";
        statusEl.textContent = "ISBN " + isbn + " — looking up…";
      }
      await _onBarcodeDetected(isbn);
    };
  }

  function injectStyles() {
    if (document.getElementById("batchScanStyles")) return;
    const style = document.createElement("style");
    style.id = "batchScanStyles";
    style.textContent = `
      .scanner-session-counter {
        margin-left: auto;
        margin-right: 0.75rem;
        padding: 0.3rem 0.7rem;
        border-radius: 999px;
        background: #eef8f0;
        color: #20713a;
        border: 1px solid #bfe6ca;
        font-size: 0.82rem;
        font-weight: 700;
        white-space: nowrap;
      }

      .scanner-batch-toast {
        position: absolute;
        left: 1rem;
        right: 1rem;
        bottom: 1rem;
        z-index: 3;
        opacity: 0;
        transform: translateY(8px);
        pointer-events: none;
        padding: 0.85rem 1rem;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        text-align: center;
        font-weight: 700;
        transition: opacity 0.18s ease, transform 0.18s ease;
      }

      .scanner-batch-toast.visible {
        opacity: 1;
        transform: translateY(0);
      }

      .scanner-batch-toast.success {
        background: #e6f7ee;
        color: #176b38;
        border: 1px solid #a9dfbf;
      }

      .scanner-batch-toast.notice {
        background: #fff8df;
        color: #8a6400;
        border: 1px solid #edd37a;
      }

      .scanner-batch-toast.error {
        background: #fde8e8;
        color: #a1261f;
        border: 1px solid #f1b4b4;
      }

      #scannerStateFound .scanner-actions button:disabled {
        opacity: 0.65;
        cursor: wait;
      }

      @media (max-width: 414px) {
        .container { padding: 0 12px; }
        .dashboard { padding: 1rem 0; }
        .section-title { font-size: 1.85rem; margin-bottom: 1.25rem; }
        .dashboard-content { padding: 1rem; border-radius: 12px; }
        .dashboard-tabs { overflow-x: auto; flex-wrap: nowrap; gap: 0.35rem; padding-bottom: 0.25rem; }
        .tab-btn { flex: 0 0 auto; padding: 0.75rem 0.85rem; font-size: 0.88rem; }
        .dashboard-nav { display: block; margin-bottom: 1rem; }
        .dashboard-nav > .btn { width: 100%; justify-content: center; margin: 0.75rem 0 0 !important; }
        .btn-scan-prominent { min-height: 54px; font-size: 1rem; }

        .modal-content,
        .scanner-modal-content {
          width: calc(100vw - 14px);
          margin: 7px auto;
          max-width: none;
          border-radius: 14px;
        }
        .modal-header {
          padding: 0.9rem 1rem;
          gap: 0.5rem;
        }
        .modal-header h3 { font-size: 1.08rem; line-height: 1.25; }
        .close {
          min-width: 44px;
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin: -0.5rem -0.5rem -0.5rem 0;
        }
        .modal-body {
          padding: 1rem;
          max-height: calc(100vh - 82px);
        }
        .scanner-session-counter {
          order: 2;
          width: 100%;
          margin: 0;
          text-align: center;
          font-size: 0.78rem;
        }
        .scanner-hint { font-size: 0.9rem; margin-bottom: 0.75rem; }
        .scanner-photo-options { display: grid; gap: 0.7rem; }
        .scanner-photo-label,
        .btn-live-camera,
        .scanner-actions .btn,
        .scanner-rescan-btn,
        .scanner-manual-input .btn {
          min-height: 50px;
          justify-content: center;
        }
        #barcodeScannerView { min-height: min(56vh, 360px); }
        #barcodeScannerView video { max-height: 56vh; object-fit: cover; }
        .scanner-book-card {
          align-items: flex-start;
          padding: 0.75rem;
        }
        .scanner-book-cover {
          width: 82px;
          height: 112px;
        }
        .scanner-book-info h3 { font-size: 1rem; }
        .scanner-book-info p { font-size: 0.9rem; }
        .scanner-manual-input { flex-direction: column; }
        .scanner-manual-input input,
        .form-group input,
        .form-group select,
        .form-group textarea {
          font-size: 16px;
        }
        .shelf-grid { justify-content: center; gap: 0.8rem; }
        .shelf-card { width: 148px; padding: 0.8rem; }
        .shelf-cover-wrap,
        .shelf-cover { width: 100px; height: 136px; }
      }
    `;
    document.head.appendChild(style);
  }

  function initBatchScannerEnhancement() {
    injectStyles();
    renderCounterChip();
    installFunctionWrappers();
    window.__bookSharezBatchScan = {
      getTodayCount,
      setTodayCount,
      resetTodayCount: () => setTodayCount(0),
      renderCounterChip,
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initBatchScannerEnhancement, { once: true });
  } else {
    initBatchScannerEnhancement();
  }
})();
