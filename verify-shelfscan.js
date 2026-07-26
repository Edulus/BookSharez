// Playwright verification for multi-book shelf-photo capture
// (docs/SHELF_PHOTO_CAPTURE.md): one shelf photo → many detected books →
// resolved to catalog candidates → a batch REVIEW checklist → bulk add.
// Serve the app dir on port 7654 first (node dev-server.js).
const { chromium } = require("playwright");

const APP = "http://localhost:7654/index.html";

// What the vision-extract "shelf" mode "reads" from the photo. Five detections:
//  - Gatsby (high)    → matches, pre-checked
//  - Moby (medium)    → matches, pre-checked
//  - Old Folio (low)  → matches but NO isbn, starts UNCHECKED (low confidence)
//  - Nonexistent (hi) → no catalog match → unmatched, checkbox disabled
//  - Gatsby again     → resolves to the same book → DEDUPED away
const SHELF_BOOKS = [
  { title: "The Great Gatsby", author: "F. Scott Fitzgerald", confidence: "high" },
  { title: "Moby Dick", author: "Herman Melville", confidence: "medium" },
  { title: "An Old Folio", author: "Anon", confidence: "low" },
  { title: "Nonexistent Zzz", author: "Nobody", confidence: "high" },
  { title: "Great Gatsby", author: "Fitzgerald", confidence: "high" },
];

// Google Books items keyed by a query keyword. Gatsby/Moby carry ISBNs; the Old
// Folio deliberately has none (a pre-ISBN match); Nonexistent returns nothing.
const gbItem = (title, author, isbn) => ({
  volumeInfo: {
    title, authors: [author],
    industryIdentifiers: isbn ? [{ type: "ISBN_13", identifier: isbn }] : [],
    imageLinks: {},
  },
});
function googleBooksFor(url) {
  const q = decodeURIComponent(url);
  if (q.includes("Gatsby")) return { items: [gbItem("The Great Gatsby", "F. Scott Fitzgerald", "9780743273565")] };
  if (q.includes("Moby")) return { items: [gbItem("Moby Dick", "Herman Melville", "9781111111111")] };
  if (q.includes("Folio")) return { items: [gbItem("An Old Folio", "Anon", null)] };
  return { items: [] };
}

// Tiny valid 1×1 JPEG for the shelf input
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=",
  "base64"
);

const json = (route, body, headers = {}, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-expose-headers": "content-range", ...headers },
    body: JSON.stringify(body),
  });
const isSingle = (route) => (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");

// isbn → existing catalog row (so ensureBook resolves without inserting)
const KNOWN = {
  "9780743273565": { id: "book-gatsby", isbn: "9780743273565", title: "The Great Gatsby", author: "F. Scott Fitzgerald", cover_url: null },
  "9781111111111": { id: "book-moby", isbn: "9781111111111", title: "Moby Dick", author: "Herman Melville", cover_url: null },
};

let shelfInsertCount = 0;
const shelfPosts = [];
const booksPosts = [];
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
    if (url.includes("on_conflict") || req.method() === "PATCH" || req.method() === "DELETE") {
      booksWriteViolations.push(req.method() + " " + url);
    }
    if (req.method() === "POST") {
      // Only the no-ISBN Old Folio reaches an insert (ISBN books resolve via select).
      booksPosts.push(req.postData() || "");
      return json(route, { id: "book-folio" }, {}, 201);
    }
    // no-ISBN dedup lookup → no existing match, so it inserts
    if (url.includes("isbn=is.null")) return json(route, []);
    // ensureBook select by isbn → return the known row
    const hit = Object.keys(KNOWN).find((isbn) => url.includes("isbn=eq." + isbn));
    if (hit) return json(route, isSingle(route) ? KNOWN[hit] : [KNOWN[hit]]);
    return json(route, isSingle(route) ? null : []);
  });

  await page.route("**/rest/v1/shelf_entries*", (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      shelfInsertCount++;
      shelfPosts.push(req.postData() || "");
      return json(route, { id: "entry-" + shelfInsertCount }, {}, 201);
    }
    if (req.method() === "HEAD") return json(route, [], { "content-range": "0-0/0" });
    if (isSingle(route)) return json(route, { id: "entry-existing" });
    return json(route, []);
  });

  await page.route("**/rest/v1/notifications*", (route) => json(route, []));
  await page.route("**/rest/v1/profiles*", (route) => (isSingle(route) ? json(route, { id: "test-user-id", username: "me" }) : json(route, [])));
  await page.route("**/rest/v1/listings*", (route) => json(route, []));
  await page.route("**/rest/v1/discussion_posts*", (route) => json(route, []));
  await page.route("**/rest/v1/listing_photos*", (route) => json(route, []));
  await page.route("**/rest/v1/follows*", (route) => json(route, [], { "content-range": "0-0/0" }));

  await page.route("**/books/v1/volumes*", (route) => json(route, googleBooksFor(route.request().url())));
  await page.route("**/openlibrary.org/**", (route) => json(route, { docs: [] }));

  await page.route("**/functions/v1/**", (route) => route.fulfill({ status: 404, body: "{}" }));
  // shelf mode returns an array under data.books (registered after the 404)
  await page.route("**/functions/v1/vision-extract*", (route) =>
    json(route, { ok: true, mode: "shelf", data: { books: SHELF_BOOKS } }));
}

function fakeSession() {
  try { localStorage; } catch { return; }
  localStorage.setItem("sb-kkmxdemnbuyuxnrezxmn-auth-token", JSON.stringify({
    access_token: "fake", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r",
    user: { id: "test-user-id", email: "t@e.com", aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} },
  }));
  localStorage.removeItem("bsCaptures:" + new Date().toISOString().slice(0, 10));
  sessionStorage.removeItem("bsLoopMetrics");
}

let failures = 0;
function check(name, cond, extra = "") {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  [" + extra + "]" : ""));
  if (!cond) failures++;
}
const vis = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && el.style.display !== "none" && el.offsetParent !== null; }, id);
const modalVis = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && getComputedStyle(el).display !== "none"; }, id);
const txt = (page, id) => page.evaluate((i) => (document.getElementById(i) || {}).textContent || "", id);
const rowCount = (page) => page.evaluate(() => document.querySelectorAll("#scannerShelfList .scanner-shelf-row").length);
const checkedCount = (page) => page.evaluate(() => document.querySelectorAll("#scannerShelfList .scanner-shelf-check:checked").length);

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const errors = [];
  const dialogs = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await installRoutes(page);
  await page.addInitScript(fakeSession);
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // Shelf capture button lives in the shared scanning state
  await page.evaluate(() => window.openBookScanner());
  check("scanner modal opens", await modalVis(page, "barcodeScannerModal"));
  check("Scan-a-Shelf button present", await page.evaluate(() => !!document.querySelector('input#scannerShelfInput')));

  // ── one shelf photo → review screen ──
  await page.setInputFiles("#scannerShelfInput", { name: "shelf.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG });
  await page.waitForSelector("#scannerShelfList .scanner-shelf-row", { timeout: 9000 });

  check("review state visible", await vis(page, "scannerStateShelfReview"));
  check("5 detections deduped to 4 rows", (await rowCount(page)) === 4, String(await rowCount(page)));
  check("hint reports 3 of 4 matched", (await txt(page, "scannerShelfHint")).includes("3 of 4"), await txt(page, "scannerShelfHint"));

  // Pre-check policy: high+medium matched rows checked; low + unmatched not.
  check("pre-checked = 2 (high + medium)", (await checkedCount(page)) === 2, String(await checkedCount(page)));
  check("add button reflects count", (await txt(page, "scannerShelfAddBtn")).trim() === "Add 2 to Books I Have", await txt(page, "scannerShelfAddBtn"));

  // Unmatched row's checkbox is disabled (can't be added).
  const unmatchedDisabled = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#scannerShelfList .scanner-shelf-row")];
    const un = rows.find((r) => r.className.includes("unmatched"));
    return !!un && un.querySelector(".scanner-shelf-check").disabled;
  });
  check("unmatched row checkbox disabled", unmatchedDisabled);

  // User promotes the low-confidence match by checking it → 3 selected.
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#scannerShelfList .scanner-shelf-row")];
    // the low-confidence Old Folio: matched (not unmatched) but currently unchecked
    const low = rows.find((r) => !r.className.includes("unmatched") && !r.querySelector(".scanner-shelf-check").checked);
    low.querySelector(".scanner-shelf-check").click();
  });
  check("checking low row → 3 selected", (await checkedCount(page)) === 3, String(await checkedCount(page)));
  check("add button updates to 3", (await txt(page, "scannerShelfAddBtn")).trim() === "Add 3 to Books I Have", await txt(page, "scannerShelfAddBtn"));

  // ── bulk add ──
  await page.click("#scannerShelfAddBtn");
  await page.waitForTimeout(900);

  check("3 shelf inserts hit the API", shelfInsertCount === 3, String(shelfInsertCount));
  check("no-ISBN Old Folio inserted into books (isbn:null)", booksPosts.some((b) => b.includes('"isbn":null')), booksPosts.join(" | "));
  check("shelf entries reference resolved book ids", shelfPosts.some((p) => p.includes("book-gatsby")) && shelfPosts.some((p) => p.includes("book-moby")) && shelfPosts.some((p) => p.includes("book-folio")), shelfPosts.join(" | "));
  check("summary toast reports 3 added", (await txt(page, "scannerAddedMsg")).includes("Added 3 books"), await txt(page, "scannerAddedMsg"));
  check("modal stays open, back on scanning state", await modalVis(page, "barcodeScannerModal") && await vis(page, "scannerStateScanning"));
  check("no blocking dialogs", dialogs.length === 0, dialogs.join(" | "));

  // ── metrics ──
  const m = await page.evaluate(() => window.loopMetricsSummary());
  check("metrics: captures = 3 (per confirmed book)", m.captures === 3, JSON.stringify(m));
  check("metrics: shelfPhotos = 1", m.shelfPhotos === 1, JSON.stringify(m));
  check("metrics: addsHave = 3", m.addsHave === 3, JSON.stringify(m));
  check("metrics: no duplicates, no listings", m.duplicates === 0 && m.listingsCreated === 0, JSON.stringify(m));

  check("session chip counts the 3 books", (await txt(page, "scannerSessionCount")).includes("3 books added today"), await txt(page, "scannerSessionCount"));

  check("§6.1: no catalog upsert/PATCH/DELETE (append-only)", booksWriteViolations.length === 0, booksWriteViolations.join(" | "));
  check("no page errors", errors.length === 0, errors.join(" | "));

  await browser.close();
  console.log(failures === 0 ? "\nALL SHELF-SCAN CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
})();
