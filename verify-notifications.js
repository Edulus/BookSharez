// Playwright verification for the notifications rail (bell + want-match).
// Mocks Supabase REST; serve the app dir on port 7654 first, e.g.:
//   npx serve -l 7654  (or any static server)
const { chromium } = require("playwright");

const APP = "http://localhost:7654/index.html";

const NOTIF_UNREAD = {
  id: "notif-1",
  type: "want_match",
  subject_type: "listing",
  subject_id: "list-1",
  payload: { book_id: "book-A", title: "The Way of Zen", author: "Alan Watts", price: 12.5, seller_username: "zenfan" },
  read_at: null,
  created_at: new Date(Date.now() - 3600e3).toISOString(),
};
const NOTIF_READ = {
  id: "notif-2",
  type: "want_match",
  subject_type: "listing",
  subject_id: "list-2",
  payload: { book_id: "book-B", title: "Siddhartha", author: "Hermann Hesse", price: 6, seller_username: null },
  read_at: new Date(Date.now() - 86400e3).toISOString(),
  created_at: new Date(Date.now() - 90000e3).toISOString(),
};
const booksJoin = { id: "book-A", title: "The Way of Zen", author: "Alan Watts", cover_url: null, isbn: "9780111111111" };
const LISTING_1 = { id: "list-1", price: 12.5, condition: "good", created_at: "2026-06-20T00:00:00Z", description: "Clean used copy.", book_id: "book-A", user_id: "seller-1", books: booksJoin };

// access-control-expose-headers is required or the browser hides content-range
// from cross-origin fetch — supabase-js would then report count: null.
const json = (route, body, headers = {}) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-expose-headers": "content-range", ...headers },
    body: JSON.stringify(body),
  });
const isSingle = (route) => (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");

const patches = []; // captured PATCH requests to /notifications

async function installRoutes(page) {
  await page.route("**/auth/v1/**", (route) => {
    if (route.request().url().includes("/auth/v1/user"))
      return json(route, { id: "test-user-id", email: "t@e.com", aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} });
    if (route.request().url().includes("/auth/v1/token"))
      return json(route, { access_token: "fake", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user: { id: "test-user-id", email: "t@e.com", aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} } });
    return route.continue();
  });
  await page.route("**/rest/v1/notifications*", (route) => {
    const req = route.request();
    if (req.method() === "PATCH") {
      patches.push(req.url());
      return json(route, []);
    }
    if (req.method() === "HEAD") return json(route, [], { "content-range": "0-0/1" }); // 1 unread
    return json(route, [NOTIF_UNREAD, NOTIF_READ]);
  });
  await page.route("**/rest/v1/listings*", (route) => (isSingle(route) ? json(route, LISTING_1) : json(route, [LISTING_1])));
  await page.route("**/rest/v1/books*", (route) => (isSingle(route) ? json(route, booksJoin) : json(route, [booksJoin])));
  await page.route("**/rest/v1/shelf_entries*", (route) => {
    if (route.request().method() === "HEAD") return json(route, [], { "content-range": "0-0/0" });
    return json(route, []);
  });
  await page.route("**/rest/v1/discussion_posts*", (route) => json(route, []));
  await page.route("**/rest/v1/profiles*", (route) => (isSingle(route) ? json(route, { id: "seller-1", username: "zenfan" }) : json(route, [])));
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
}

let failures = 0;
function check(name, cond, extra = "") {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  [" + extra + "]" : ""));
  if (!cond) failures++;
}
const vis = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && el.style.display !== "none" && el.offsetParent !== null; }, id);

(async () => {
  const browser = await chromium.launch();

  // ── Logged OUT: bell hidden ──
  {
    const page = await (await browser.newContext()).newPage();
    await installRoutes(page);
    await page.goto(APP, { waitUntil: "networkidle" });
    check("bell hidden when logged out", !(await vis(page, "notifBell")));
    await page.close();
  }

  // ── Logged IN: badge, panel, click-through, mark-all ──
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await installRoutes(page);
  await page.addInitScript(fakeSession);
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  check("bell visible when logged in", await vis(page, "notifBell"));
  check("badge shows unread count 1", (await page.evaluate(() => document.getElementById("notifBadge").textContent)) === "1");

  await page.click("#notifBell");
  await page.waitForTimeout(400);
  check("panel opens", await vis(page, "notifPanel"));
  const items = await page.evaluate(() => document.querySelectorAll("#notifList .notif-item").length);
  check("panel lists 2 notifications", items === 2, String(items));
  const unread = await page.evaluate(() => document.querySelectorAll("#notifList .notif-unread").length);
  check("1 item styled unread", unread === 1, String(unread));
  const text = await page.evaluate(() => document.querySelector("#notifList .notif-item p").textContent);
  check("want-match text renders title/price/seller", /Way of Zen.*\$12\.50.*zenfan/.test(text), text);

  // click the unread item → routes to listing, marks read
  await page.click("#notifList .notif-item");
  await page.waitForTimeout(600);
  check("click routes to listing page", (await page.evaluate(() => location.hash)) === "#/listing/list-1");
  check("detail page visible", await vis(page, "bookDetail"));
  check("panel closed after click", !(await vis(page, "notifPanel")));
  check("mark-read PATCH sent", patches.some((u) => u.includes("id=eq.notif-1")), patches.join(" | "));

  // outside-click close
  await page.click("#notifBell");
  await page.waitForTimeout(300);
  await page.click("h1, .hero, body", { position: { x: 10, y: 300 } });
  await page.waitForTimeout(300);
  check("panel closes on outside click", !(await vis(page, "notifPanel")));

  // mark all read
  await page.click("#notifBell");
  await page.waitForTimeout(300);
  const before = patches.length;
  await page.click(".notif-mark-all");
  await page.waitForTimeout(400);
  check("mark-all-read PATCH sent", patches.length > before && patches.some((u) => u.includes("read_at=is.null")), patches.slice(before).join(" | "));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failures === 0 ? "\nALL NOTIFICATION CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
})();
