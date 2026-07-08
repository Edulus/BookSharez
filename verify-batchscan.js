// Playwright verification for batch capture mode (core loop):
// add a book from the scanner → modal STAYS OPEN, flash confirms, session
// counter increments, and the flow is immediately ready for the next book.
// Serve the app dir on port 7654 first (node dev-server.js).
const { chromium } = require("playwright");

const APP = "http://localhost:7654/index.html";

const BOOK_A = { id: "book-A", isbn: "9780111111111", title: "The Way of Zen", author: "Alan Watts", cover_url: null };
const BOOK_B = { id: "book-B", isbn: "9780222222222", title: "Siddhartha", author: "Hermann Hesse", cover_url: null };
const BOOK_C = { id: "book-C", isbn: "9780333333333", title: "The Compleat Angler", author: "Izaak Walton", cover_url: null };

// Cover-path candidates for the "Compleat Angler" query: a modern edition
// with an ISBN, and a pre-ISBN first edition WITHOUT one — the real parity test.
const GBOOKS_COVER = {
  items: [
    { volumeInfo: { title: "The Compleat Angler", authors: ["Izaak Walton"], publishedDate: "1955", industryIdentifiers: [{ type: "ISBN_13", identifier: "9780333333333" }], imageLinks: {} } },
    { volumeInfo: { title: "The Compleat Angler", authors: ["Izaak Walton"], publishedDate: "1653", industryIdentifiers: [], imageLinks: {} } },
  ],
};

// Tiny valid 1×1 JPEG for the cover input
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
  "base64"
);

// access-control-expose-headers required or the browser hides content-range
const json = (route, body, headers = {}, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-expose-headers": "content-range", ...headers },
    body: JSON.stringify(body),
  });
const isSingle = (route) => (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");

let shelfInsertCount = 0;
let duplicateMode = false; // when true, shelf insert returns 23505
const listingPosts = []; // captured POST bodies to /rest/v1/listings
const shelfPosts = []; // captured POST bodies to /rest/v1/shelf_entries
const booksWriteViolations = []; // §6.1: any upsert/PATCH/DELETE against books

async function installRoutes(page) {
  await page.route("**/auth/v1/**", (route) => {
    const url = route.request().url();
    const user = { id: "test-user-id", email: "t@e.com", aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} };
    if (url.includes("/auth/v1/user")) return json(route, user);
    if (url.includes("/auth/v1/token"))
      return json(route, { access_token: "fake", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user });
    return route.continue();
  });
  await page.route("**/rest/v1/books*", (route) => {
    const req = route.request();
    const url = req.url();
    // §6.1 guard: catalog writes are append-only for clients. An upsert
    // (on_conflict) or PATCH/DELETE from the app is a security regression.
    if (url.includes("on_conflict") || req.method() === "PATCH" || req.method() === "DELETE") {
      booksWriteViolations.push(req.method() + " " + url);
    }
    if (req.method() === "POST") {
      // upsert/insert from _addScannedToShelf — echo back an id from payload
      const body = req.postData() || "";
      if (body.includes('"isbn":null')) return json(route, { id: "book-noisbn" });
      const b = body.includes(BOOK_B.isbn) ? BOOK_B : BOOK_A;
      return json(route, { id: b.id });
    }
    // no-ISBN dedup lookup (isbn=is.null&title=eq...) → no existing match
    if (url.includes("isbn=is.null")) return json(route, []);
    // catalog lookups by isbn
    if (url.includes("isbn=eq." + BOOK_C.isbn)) return json(route, isSingle(route) ? BOOK_C : [BOOK_C]);
    if (url.includes("isbn=eq." + BOOK_B.isbn)) return json(route, isSingle(route) ? BOOK_B : [BOOK_B]);
    if (url.includes("isbn=eq." + BOOK_A.isbn)) return json(route, isSingle(route) ? BOOK_A : [BOOK_A]);
    return json(route, isSingle(route) ? BOOK_A : [BOOK_A]);
  });
  await page.route("**/rest/v1/shelf_entries*", (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      if (duplicateMode)
        return json(route, { code: "23505", message: "duplicate key value violates unique constraint", details: "", hint: "" }, {}, 409);
      shelfInsertCount++;
      shelfPosts.push(req.postData() || "");
      // insert().select("id").single() expects a single object back
      return json(route, { id: "entry-" + shelfInsertCount }, {}, 201);
    }
    if (req.method() === "HEAD") return json(route, [], { "content-range": "0-0/0" });
    if (isSingle(route)) return json(route, { id: "entry-existing" }); // duplicate-path lookup
    return json(route, []);
  });
  await page.route("**/rest/v1/notifications*", (route) => json(route, []));
  await page.route("**/rest/v1/listings*", (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      listingPosts.push(req.postData() || "");
      return json(route, { id: "list-new" }, {}, 201);
    }
    return json(route, []);
  });
  await page.route("**/rest/v1/profiles*", (route) => (isSingle(route) ? json(route, { id: "test-user-id", username: "me" }) : json(route, [])));
  await page.route("**/rest/v1/discussion_posts*", (route) => json(route, []));
  await page.route("**/rest/v1/listing_photos*", (route) => json(route, []));
  await page.route("**/rest/v1/follows*", (route) => json(route, [], { "content-range": "0-0/0" }));
  await page.route("**/books/v1/volumes*", (route) => {
    const q = decodeURIComponent(route.request().url());
    return json(route, q.includes("Compleat") ? GBOOKS_COVER : { items: [] });
  });
  await page.route("**/openlibrary.org/**", (route) => json(route, { docs: [] }));
  await page.route("**/functions/v1/**", (route) => route.fulfill({ status: 404, body: "{}" }));
  // registered after the generic 404 so it takes precedence; the function
  // wraps its payload in an { ok, data } envelope
  await page.route("**/functions/v1/vision-extract*", (route) =>
    json(route, { ok: true, data: { title: "The Compleat Angler", author: "Izaak Walton", isbn: "", confidence: "low" } }));
}

function fakeSession() {
  try { localStorage; } catch { return; }
  localStorage.setItem("sb-kkmxdemnbuyuxnrezxmn-auth-token", JSON.stringify({
    access_token: "fake", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r",
    user: { id: "test-user-id", email: "t@e.com", aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} },
  }));
  // start each run with a clean per-day capture counter + loop metrics
  const key = "bsCaptures:" + new Date().toISOString().slice(0, 10);
  localStorage.removeItem(key);
  sessionStorage.removeItem("bsLoopMetrics");
}

let failures = 0;
function check(name, cond, extra = "") {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  [" + extra + "]" : ""));
  if (!cond) failures++;
}
const vis = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && el.style.display !== "none" && el.offsetParent !== null; }, id);
// The modal container is position:fixed → offsetParent is always null; use computed style.
const modalVis = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && getComputedStyle(el).display !== "none"; }, id);
const txt = (page, id) => page.evaluate((i) => (document.getElementById(i) || {}).textContent || "", id);

// Drive one capture via the manual-ISBN path (works headless, no camera).
async function captureViaManualEntry(page, isbn) {
  await page.evaluate((i) => {
    document.getElementById("scannerManualEntry").style.display = "";
    document.getElementById("scannerManualISBN").value = i;
    return window.scannerManualLookup();
  }, isbn);
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage(); // phone-sized
  const errors = [];
  const dialogs = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await installRoutes(page);
  await page.addInitScript(fakeSession);
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // open the scanner (dashboard target = shelf-building mode)
  await page.evaluate(() => window.openBookScanner());
  check("scanner modal opens", await modalVis(page, "barcodeScannerModal"));
  check("session chip hidden at 0", !(await vis(page, "scannerSessionCount")));

  // ── capture 1 ──
  await captureViaManualEntry(page, "9780111111111");
  check("book A found state", (await txt(page, "scannerBookTitle")).includes("Way of Zen"));
  await page.click('button[onclick="addScannedBook(\'have\')"]');
  await page.waitForTimeout(500);

  check("modal STAYS OPEN after add", await modalVis(page, "barcodeScannerModal"));
  check("back on scanning state (ready for next book)", await vis(page, "scannerStateScanning"));
  check("no blocking dialog appeared", errors.length === 0); // alert() would hang playwright; reaching here at all is the real check
  check("flash confirms the add", (await txt(page, "scannerAddedMsg")).includes("Way of Zen"));
  check("session chip: 1 book", (await txt(page, "scannerSessionCount")).trim() === "1 book added today", await txt(page, "scannerSessionCount"));
  check("shelf insert hit the API", shelfInsertCount === 1, String(shelfInsertCount));

  // ── capture 2 (different book, straight away — the rhythm) ──
  await captureViaManualEntry(page, "9780222222222");
  check("book B found state", (await txt(page, "scannerBookTitle")).includes("Siddhartha"));
  await page.click('button[onclick="addScannedBook(\'want\')"]');
  await page.waitForTimeout(500);
  check("chip counts across shelves: 2 books", (await txt(page, "scannerSessionCount")).trim() === "2 books added today", await txt(page, "scannerSessionCount"));
  check("flash names book B", (await txt(page, "scannerAddedMsg")).includes("Siddhartha"));

  // ── duplicate: same book again → no count bump, honest message ──
  duplicateMode = true;
  await captureViaManualEntry(page, "9780111111111");
  await page.click('button[onclick="addScannedBook(\'have\')"]');
  await page.waitForTimeout(500);
  check("duplicate: chip stays at 2", (await txt(page, "scannerSessionCount")).trim() === "2 books added today", await txt(page, "scannerSessionCount"));
  check("duplicate: message says already on shelf", (await txt(page, "scannerAddedMsg")).includes("already on your shelf"));
  duplicateMode = false;

  // ── counter survives closing and reopening the modal ──
  await page.evaluate(() => window.closeBarcodeScanner());
  await page.waitForTimeout(200);
  check("modal closed on demand", !(await modalVis(page, "barcodeScannerModal")));
  await page.evaluate(() => window.openBookScanner());
  await page.waitForTimeout(200);
  check("chip persists across reopen", (await txt(page, "scannerSessionCount")).trim() === "2 books added today", await txt(page, "scannerSessionCount"));

  // loop metrics survive scanner close/reopen (session-scoped)
  const midMetrics = await page.evaluate(() => window.loopMetricsSummary());
  check("metrics survive close/reopen (captures 3, have 2, want 1, dup 1)",
    midMetrics.captures === 3 && midMetrics.addsHave === 2 && midMetrics.addsWant === 1 &&
    midMetrics.duplicates === 1 && midMetrics.listingsCreated === 0,
    JSON.stringify(midMetrics));

  check("no dialogs during batch adds", dialogs.length === 0, dialogs.join(" | "));

  // ── Add & List: capture → one clean transition → confirm → listing ──
  await captureViaManualEntry(page, "9780111111111");
  await page.click(".scanner-add-list-btn");
  await page.waitForTimeout(500);

  check("Add&List: scanner closed", !(await modalVis(page, "barcodeScannerModal")));
  check("Add&List: sell modal open", await modalVis(page, "sellModal"));
  check("Add&List: ISBN prefilled", (await page.evaluate(() => document.getElementById("bookISBN").value)) === "9780111111111");
  check("Add&List: title prefilled", (await page.evaluate(() => document.getElementById("bookTitle").value)).includes("Way of Zen"));
  check("Add&List: status explains next step", (await txt(page, "sellSearchStatus")).includes("confirm condition and price"), await txt(page, "sellSearchStatus"));
  check("Add&List: counted as a capture (chip 3)", (await txt(page, "scannerSessionCount")).trim() === "3 books added today", await txt(page, "scannerSessionCount"));
  check("Add&List: condition + price start EMPTY (no silent listing)",
    await page.evaluate(() => document.getElementById("bookCondition").value === "" && document.getElementById("bookPrice").value === ""));
  check("Add&List: no listing POST before user confirms", listingPosts.length === 0);
  check("metrics: Add&List tap = intent only, not a created listing",
    await page.evaluate(() => {
      const m = window.loopMetricsSummary();
      return m.addAndList === 1 && m.listingsCreated === 0;
    }));

  // picking a condition auto-suggests a price (pricing fn mocked away → local fallback)
  await page.selectOption("#bookCondition", "good");
  await page.waitForTimeout(700);
  const suggested = await page.evaluate(() => document.getElementById("bookPrice").value);
  check("condition pick auto-suggests a price", parseFloat(suggested) > 0, suggested);

  // the user stays in control: adjust the price, then confirm
  await page.fill("#bookPrice", "12.50");
  await page.click('#sellForm button[type="submit"]');
  await page.waitForTimeout(900);

  check("confirm creates exactly one listing", listingPosts.length === 1, String(listingPosts.length));
  const posted = listingPosts[0] || "";
  check("listing linked to the new shelf entry", posted.includes('"shelf_entry_id":"entry-3"'), posted);
  check("listing carries confirmed condition", posted.includes('"condition":"good"'), posted);
  check("listing carries adjusted price", posted.includes('"price":12.5'), posted);
  check("success alert after listing", dialogs.some((d) => d.includes("listed successfully")), dialogs.join(" | "));
  check("sell modal closed after confirm", !(await modalVis(page, "sellModal")));

  // ── Cover-path parity (§3.0): cover photo → candidates → SAME found screen ──
  // The no-ISBN candidate is the real test: pre-ISBN books must be first-class.
  await page.evaluate(() => window.openBookScanner());
  await page.waitForTimeout(200);
  await page.setInputFiles("#scannerCoverInput", { name: "cover.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG });
  await page.waitForSelector("#scannerCoverResults > div", { timeout: 8000 });

  const candidateCount = await page.evaluate(() => document.querySelectorAll("#scannerCoverResults > div").length);
  check("cover: candidates rendered (incl. no-ISBN edition)", candidateCount === 2, String(candidateCount));

  // confirm the NO-ISBN candidate (second in the mock: the 1653 edition)
  await page.click("#scannerCoverResults > div:nth-child(2)");
  await page.waitForTimeout(500);

  check("cover no-ISBN: lands on the SAME found screen", await vis(page, "scannerStateFound"));
  check("cover no-ISBN: scanner modal still open (no reopen)", await modalVis(page, "barcodeScannerModal"));
  check("cover no-ISBN: no dead-end manual form", !(await vis(page, "scannerManualEntry")));
  check("cover no-ISBN: title shown", (await txt(page, "scannerBookTitle")).includes("Compleat Angler"));
  check("cover no-ISBN: all three choices exposed", await page.evaluate(() => {
    const v = (sel) => { const el = document.querySelector(sel); return !!el && el.offsetParent !== null; };
    return v('button[onclick="addScannedBook(\'have\')"]') && v('button[onclick="addScannedBook(\'want\')"]') && v(".scanner-add-list-btn");
  }));

  // Add & List from the no-ISBN candidate
  const shelfPostsBefore = shelfPosts.length;
  await page.click(".scanner-add-list-btn");
  await page.waitForTimeout(600);

  check("cover no-ISBN: canonical book row created (isbn:null insert)", shelfPosts.length === shelfPostsBefore + 1 && shelfPosts[shelfPosts.length - 1].includes('"book_id":"book-noisbn"'), shelfPosts[shelfPosts.length - 1]);
  check("cover no-ISBN: sell modal opens pre-filled", await modalVis(page, "sellModal"));
  check("cover no-ISBN: title pre-filled, ISBN field EMPTY", await page.evaluate(() =>
    document.getElementById("bookTitle").value.includes("Compleat Angler") && document.getElementById("bookISBN").value === ""));
  check("cover no-ISBN: condition + price start empty", await page.evaluate(() =>
    document.getElementById("bookCondition").value === "" && document.getElementById("bookPrice").value === ""));
  check("cover no-ISBN: no listing before confirmation", listingPosts.length === 1);

  await page.selectOption("#bookCondition", "very_good");
  await page.waitForTimeout(700);
  await page.fill("#bookPrice", "15.00");
  await page.click('#sellForm button[type="submit"]');
  await page.waitForTimeout(900);

  check("cover no-ISBN: listing created on confirm", listingPosts.length === 2, String(listingPosts.length));
  const noIsbnListing = listingPosts[1] || "";
  check("cover no-ISBN: listing uses canonical book id (no ISBN dependency)", noIsbnListing.includes('"book_id":"book-noisbn"'), noIsbnListing);
  check("cover no-ISBN: shelf_entry_id preserved", noIsbnListing.includes('"shelf_entry_id":"entry-4"'), noIsbnListing);
  check("cover no-ISBN: confirmed condition + price", noIsbnListing.includes('"condition":"very_good"') && noIsbnListing.includes('"price":15'), noIsbnListing);

  // ── Cover-path parity: the WITH-ISBN candidate also lands on found ──
  await page.evaluate(() => window.openBookScanner());
  await page.waitForTimeout(200);
  await page.setInputFiles("#scannerCoverInput", { name: "cover2.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG });
  await page.waitForSelector("#scannerCoverResults > div", { timeout: 8000 });
  await page.click("#scannerCoverResults > div:nth-child(1)"); // the 1955 edition (ISBN)
  await page.waitForTimeout(500);
  check("cover with-ISBN: lands on found screen (not re-routed away)", await vis(page, "scannerStateFound"));
  check("cover with-ISBN: candidate metadata kept", (await txt(page, "scannerBookTitle")).includes("Compleat Angler"));
  check("cover with-ISBN: Add & List available", await page.evaluate(() => {
    const el = document.querySelector(".scanner-add-list-btn");
    return !!el && el.offsetParent !== null;
  }));
  await page.evaluate(() => window.closeBarcodeScanner());

  // ── Loop metrics after the whole mixed session ──
  // 6 captures (3 manual + 1 manual re-scan + 2 cover incl. no-ISBN),
  // intents: have 2 / want 1 / add&list 2, 1 duplicate outcome, 2 listings.
  const m = await page.evaluate(() => window.loopMetricsSummary());
  check("metrics: captures = 6 (re-scans and no-ISBN cover count)", m.captures === 6, JSON.stringify(m));
  check("metrics: intent split kept (have 2 / want 1 / addAndList 2)",
    m.addsHave === 2 && m.addsWant === 1 && m.addAndList === 2, JSON.stringify(m));
  check("metrics: exactly one duplicate outcome", m.duplicates === 1, String(m.duplicates));
  check("metrics: listings created = 2 (only after seller submits)", m.listingsCreated === 2, String(m.listingsCreated));
  check("metrics: listing rate = 2/6", Math.abs(m.listingRate - 0.333) < 0.005, String(m.listingRate));
  check("metrics: captures/minute computed from open time", m.capturesPerMinute > 0 && m.activeMs > 0,
    `rate=${m.capturesPerMinute} activeMs=${m.activeMs}`);

  check("§6.1: no catalog upsert/PATCH/DELETE from the client (append-only)",
    booksWriteViolations.length === 0, booksWriteViolations.join(" | "));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failures === 0 ? "\nALL BATCH-CAPTURE CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
})();
