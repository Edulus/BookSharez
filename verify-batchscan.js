// Playwright verification for batch capture mode (core loop):
// add a book from the scanner → modal STAYS OPEN, flash confirms, session
// counter increments, and the flow is immediately ready for the next book.
// Serve the app dir on port 7654 first (node dev-server.js).
const { chromium } = require("playwright");

const APP = "http://localhost:7654/index.html";

const BOOK_A = { id: "book-A", isbn: "9780111111111", title: "The Way of Zen", author: "Alan Watts", cover_url: null };
const BOOK_B = { id: "book-B", isbn: "9780222222222", title: "Siddhartha", author: "Hermann Hesse", cover_url: null };

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
    if (req.method() === "POST") {
      // upsert from addScannedBook — echo back an id based on payload isbn
      const body = req.postData() || "";
      const b = body.includes(BOOK_B.isbn) ? BOOK_B : BOOK_A;
      return json(route, { id: b.id });
    }
    // _fetchBookByISBN cache lookup by isbn
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
      return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
    }
    if (req.method() === "HEAD") return json(route, [], { "content-range": "0-0/0" });
    return json(route, []);
  });
  await page.route("**/rest/v1/notifications*", (route) => json(route, []));
  await page.route("**/rest/v1/listings*", (route) => json(route, []));
  await page.route("**/rest/v1/profiles*", (route) => (isSingle(route) ? json(route, { id: "test-user-id", username: "me" }) : json(route, [])));
  await page.route("**/rest/v1/discussion_posts*", (route) => json(route, []));
  await page.route("**/rest/v1/listing_photos*", (route) => json(route, []));
  await page.route("**/rest/v1/follows*", (route) => json(route, [], { "content-range": "0-0/0" }));
  await page.route("**/books/v1/volumes*", (route) => json(route, { items: [] }));
  await page.route("**/openlibrary.org/**", (route) => json(route, { docs: [] }));
  await page.route("**/functions/v1/**", (route) => route.fulfill({ status: 404, body: "{}" }));
}

function fakeSession() {
  try { localStorage; } catch { return; }
  localStorage.setItem("sb-kkmxdemnbuyuxnrezxmn-auth-token", JSON.stringify({
    access_token: "fake", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r",
    user: { id: "test-user-id", email: "t@e.com", aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} },
  }));
  // start each run with a clean per-day capture counter
  const key = "bsCaptures:" + new Date().toISOString().slice(0, 10);
  localStorage.removeItem(key);
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
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
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

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failures === 0 ? "\nALL BATCH-CAPTURE CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
})();
