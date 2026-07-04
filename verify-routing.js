// Routing verification: hash routes, back/forward, deep links, refresh.
// Mocks Supabase REST (same canned data pattern as verify-bookflow.js).
const path = require("path");
const { chromium } = require("playwright");

const APP = "http://localhost:7654/index.html";

const booksJoin = { id: "book-A", title: "The Way of Zen", author: "Alan Watts", cover_url: null, isbn: "9780111111111" };
const BOOK_A = { id: "book-A", isbn: "9780111111111", title: "The Way of Zen", author: "Alan Watts", cover_url: null };
const LISTING_1 = { id: "list-1", price: 12.5, condition: "good", created_at: "2026-06-20T00:00:00Z", description: "Clean used copy.", book_id: "book-A", user_id: "seller-1", books: booksJoin };

const json = (route, body, headers = {}) =>
  route.fulfill({ status: 200, contentType: "application/json", headers, body: JSON.stringify(body) });
const isSingle = (route) => (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");

async function installRoutes(page) {
  await page.route("**/auth/v1/**", (route) => {
    if (route.request().url().includes("/auth/v1/user"))
      return json(route, { id: "test-user-id", email: "t@e.com", aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} });
    if (route.request().url().includes("/auth/v1/token"))
      return json(route, { access_token: "fake", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user: { id: "test-user-id", email: "t@e.com", aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} } });
    return route.continue();
  });
  await page.route("**/rest/v1/listings*", (route) => {
    if (isSingle(route)) return json(route, LISTING_1);
    return json(route, [LISTING_1]);
  });
  await page.route("**/rest/v1/books*", (route) => (isSingle(route) ? json(route, BOOK_A) : json(route, [BOOK_A])));
  await page.route("**/rest/v1/shelf_entries*", (route) => {
    if (route.request().method() === "HEAD") return json(route, [], { "content-range": "0-0/1" });
    return json(route, []);
  });
  await page.route("**/rest/v1/discussion_posts*", (route) => json(route, []));
  const PROFILE = { id: "seller-1", username: "zenfan", bio: "zen" };
  await page.route("**/rest/v1/profiles*", (route) => (isSingle(route) ? json(route, PROFILE) : json(route, [PROFILE])));
  await page.route("**/rest/v1/listing_photos*", (route) => json(route, []));
  await page.route("**/rest/v1/follows*", (route) => {
    if (route.request().method() === "HEAD") return json(route, [], { "content-range": "0-0/0" });
    return json(route, []);
  });
  await page.route("**/books/v1/volumes*", (route) => json(route, { items: [] }));
  await page.route("**/openlibrary.org/**", (route) => json(route, { docs: [] }));
  await page.route("**/functions/v1/**", (route) => route.fulfill({ status: 404, body: "{}" }));
}

function fakeSession() {
  try { localStorage; } catch { return; } // about:blank has no storage access
  localStorage.setItem("sb-kkmxdemnbuyuxnrezxmn-auth-token", JSON.stringify({
    access_token: "fake", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r",
    user: { id: "test-user-id", email: "t@e.com", aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} },
  }));
}

let failures = 0;
function check(name, cond, extra = "") {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  [" + extra + "]" : ""));
  if (!cond) failures++;
}

const vis = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && el.style.display !== "none" && el.offsetParent !== null; }, id);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await installRoutes(page);
  await page.addInitScript(fakeSession);

  // 1. Plain load → homepage, no hash weirdness
  await page.goto(APP, { waitUntil: "networkidle" });
  check("plain load shows homepage", await vis(page, "homepage"));

  // 2. Click a community-shelf/book tile → book page + #/book/ hash
  await page.evaluate(() => browseBookById("book-A", "The Way of Zen"));
  await page.waitForTimeout(400);
  check("book page visible after browseBookById", await vis(page, "bookDetail"));
  check("hash is #/book/book-A", (await page.evaluate(() => location.hash)) === "#/book/book-A");

  // 3. Navigate to a listing → #/listing/
  await page.evaluate(() => viewListing("list-1"));
  await page.waitForTimeout(400);
  check("hash is #/listing/list-1", (await page.evaluate(() => location.hash)) === "#/listing/list-1");

  // 4. Back button → returns to book page (hash + view)
  await page.goBack();
  await page.waitForTimeout(400);
  check("back → hash #/book/book-A", (await page.evaluate(() => location.hash)) === "#/book/book-A");
  check("back → book page visible", await vis(page, "bookDetail"));
  const title = await page.evaluate(() => document.getElementById("detailTitle").textContent);
  check("back re-rendered book page", title.includes("Way of Zen"), title);

  // 5. Back again → homepage
  await page.goBack();
  await page.waitForTimeout(400);
  check("back x2 → homepage visible", await vis(page, "homepage"));

  // 6. Forward → book page again
  await page.goForward();
  await page.waitForTimeout(400);
  check("forward → book page again", await vis(page, "bookDetail"));

  // 7. Deep link: fresh load with #/listing/list-1 (blank first so it's a
  // real page load, not a same-document hash navigation)
  await page.goto("about:blank");
  await page.goto(APP + "#/listing/list-1", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  check("deep link #/listing → detail visible", await vis(page, "bookDetail"));
  const price = await page.evaluate(() => document.getElementById("detailPrice").textContent);
  check("deep link loaded listing data", price.includes("12.50"), price);

  // 8. Refresh stays on the page
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  check("refresh stays on listing page", await vis(page, "bookDetail"));

  // 9. Deep link to profile
  await page.goto(APP + "#/profile/seller-1", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  check("deep link #/profile → profile visible", await vis(page, "profilePage"));
  const name = await page.evaluate(() => document.getElementById("profileDisplayName").textContent);
  check("profile data loaded", name === "zenfan", name);

  // 10. Dashboard with restored session: deep link + tab hash behavior
  await page.goto(APP + "#/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("deep link #/dashboard → dashboard visible (logged in)", await vis(page, "dashboard"));
  const dashHash = await page.evaluate(() => location.hash);
  check("bare #/dashboard normalized to default tab", dashHash === "#/dashboard/shelf-have", dashHash);
  // switch tab → hash replaced, not pushed
  await page.evaluate(() => showDashboardTab("shelf-want"));
  await page.waitForTimeout(300);
  check("tab switch updates hash", (await page.evaluate(() => location.hash)) === "#/dashboard/shelf-want");
  await page.goBack();
  await page.waitForTimeout(400);
  // Previous history entry is the profile page from step 9; the point is that
  // ONE back leaves the dashboard entirely instead of replaying tab switches.
  const afterBackHash = await page.evaluate(() => location.hash);
  check("back from dashboard leaves dashboard (tabs replaced, not pushed)",
    !(await vis(page, "dashboard")) && !afterBackHash.startsWith("#/dashboard"),
    "hash now: " + afterBackHash);

  // 11. Unknown route → homepage fallback
  await page.goto(APP + "#/garbage/xyz", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  check("unknown route falls back to homepage", await vis(page, "homepage"));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failures === 0 ? "\nALL ROUTING CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
})();
