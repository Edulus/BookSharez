// Playwright verification for §6.2 content reporting + §6.5 password reset.
// Mocked Supabase REST/auth; serve the app dir on port 7654 first
// (node dev-server.js). Live RLS is covered separately by verify-rls-live.js.
const { chromium } = require("playwright");

const APP = "http://localhost:7654/index.html";

const booksJoin = { id: "book-A", title: "The Way of Zen", author: "Alan Watts", cover_url: null, isbn: "9780111111111" };
const LISTING_OTHER = { id: "list-1", price: 12.5, condition: "good", created_at: "2026-07-01T00:00:00Z", description: "Clean copy.", book_id: "book-A", user_id: "seller-1", books: booksJoin };
const LISTING_MINE = { id: "list-2", price: 9.0, condition: "fair", created_at: "2026-07-02T00:00:00Z", description: "My copy.", book_id: "book-A", user_id: "test-user-id", books: booksJoin };
const POST = { id: "post-1", user_id: "seller-1", body: "A discussion post worth flagging", created_at: "2026-07-07T00:00:00Z", book_id: "book-A" };

const json = (route, body, headers = {}, status = 200) =>
  route.fulfill({ status, contentType: "application/json", headers: { "access-control-expose-headers": "content-range", ...headers }, body: JSON.stringify(body) });
const isSingle = (route) => (route.request().headers()["accept"] || "").includes("vnd.pgrst.object");

const reportPosts = []; // captured POST bodies to /rest/v1/reports
const recoverPosts = []; // captured POST bodies to /auth/v1/recover
const userPuts = []; // captured PUT bodies to /auth/v1/user
let reportDuplicateMode = false;

async function installRoutes(page) {
  await page.route("**/auth/v1/**", (route) => {
    const req = route.request();
    const url = req.url();
    const user = { id: "test-user-id", email: "t@e.com", aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} };
    if (url.includes("/auth/v1/recover")) { recoverPosts.push(req.postData() || ""); return json(route, {}); }
    if (url.includes("/auth/v1/user") && req.method() === "PUT") { userPuts.push(req.postData() || ""); return json(route, user); }
    if (url.includes("/auth/v1/user")) return json(route, user);
    if (url.includes("/auth/v1/token")) return json(route, { access_token: "fake", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user });
    return route.continue();
  });
  await page.route("**/rest/v1/reports*", (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      if (reportDuplicateMode)
        return json(route, { code: "23505", message: "duplicate key value", details: "", hint: "" }, {}, 409);
      reportPosts.push(req.postData() || "");
      return json(route, { id: "report-" + reportPosts.length }, {}, 201);
    }
    return json(route, []);
  });
  await page.route("**/rest/v1/listings*", (route) => {
    const url = route.request().url();
    if (isSingle(route) && url.includes("id=eq.list-2")) return json(route, LISTING_MINE);
    if (isSingle(route)) return json(route, LISTING_OTHER);
    return json(route, [LISTING_OTHER]);
  });
  await page.route("**/rest/v1/books*", (route) => json(route, isSingle(route) ? booksJoin : [booksJoin]));
  await page.route("**/rest/v1/discussion_posts*", (route) => json(route, [POST]));
  await page.route("**/rest/v1/profiles*", (route) =>
    isSingle(route) ? json(route, { id: "seller-1", username: "zenfan", bio: "" }) : json(route, [{ id: "seller-1", username: "zenfan" }]));
  await page.route("**/rest/v1/shelf_entries*", (route) => {
    if (route.request().method() === "HEAD") return json(route, [], { "content-range": "0-0/0" });
    return json(route, []);
  });
  await page.route("**/rest/v1/follows*", (route) => {
    if (route.request().method() === "HEAD") return json(route, [], { "content-range": "0-0/0" });
    return json(route, isSingle(route) ? null : []);
  });
  await page.route("**/rest/v1/notifications*", (route) => json(route, []));
  await page.route("**/rest/v1/listing_photos*", (route) => json(route, []));
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
const modalVis = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && getComputedStyle(el).display !== "none"; }, id);
const txt = (page, id) => page.evaluate((i) => (document.getElementById(i) || {}).textContent || "", id);

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  const dialogs = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  await installRoutes(page);
  await page.addInitScript(fakeSession);
  await page.goto(APP, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // ── §6.2 report a listing ──
  await page.evaluate(() => window.viewListing("list-1"));
  await page.waitForTimeout(600);
  check("listing: report button visible on someone else's listing", await vis(page, "detailReportBtn"));

  await page.click("#detailReportBtn");
  await page.waitForTimeout(200);
  check("report modal opens", await modalVis(page, "reportModal"));

  // submit without a reason → blocked (native `required` validation stops the
  // submit event; the JS "Pick a reason first" guard is the backstop)
  await page.click('#reportForm button[type="submit"]');
  await page.waitForTimeout(200);
  check("no reason → blocked, no POST", reportPosts.length === 0 && (await modalVis(page, "reportModal")));

  await page.selectOption("#reportReason", "spam");
  await page.fill("#reportDetails", "This looks like a scam");
  await page.click('#reportForm button[type="submit"]');
  await page.waitForTimeout(400);
  check("report POST sent with full context", reportPosts.length === 1 &&
    reportPosts[0].includes('"reporter_id":"test-user-id"') &&
    reportPosts[0].includes('"subject_type":"listing"') &&
    reportPosts[0].includes('"subject_id":"list-1"') &&
    reportPosts[0].includes('"reason":"spam"') &&
    reportPosts[0].includes("Way of Zen") &&
    reportPosts[0].includes('"owner_id":"seller-1"'),
    reportPosts[0]);
  check("thanks alert + modal closed", dialogs.some((d) => d.includes("moderator")) && !(await modalVis(page, "reportModal")));

  // duplicate report → honest message, modal stays open
  reportDuplicateMode = true;
  await page.click("#detailReportBtn");
  await page.selectOption("#reportReason", "spam");
  await page.click('#reportForm button[type="submit"]');
  await page.waitForTimeout(400);
  check("duplicate report → 'already reported' message", (await txt(page, "reportStatus")).includes("already reported"));
  reportDuplicateMode = false;
  await page.evaluate(() => window.closeModal("reportModal"));

  // own listing → no report button
  await page.evaluate(() => window.viewListing("list-2"));
  await page.waitForTimeout(600);
  check("own listing: report button hidden", !(await vis(page, "detailReportBtn")));

  // ── §6.2 report a discussion post ──
  await page.evaluate(() => window.viewListing("list-1"));
  await page.waitForTimeout(600);
  const hasPostReport = await page.evaluate(() => !!document.querySelector(".discussion-post .discussion-report"));
  check("discussion post shows a report link (other's post)", hasPostReport);
  await page.click(".discussion-post .discussion-report");
  await page.waitForTimeout(200);
  await page.selectOption("#reportReason", "harassment");
  await page.click('#reportForm button[type="submit"]');
  await page.waitForTimeout(400);
  check("post report carries excerpt + author", reportPosts.length === 2 &&
    reportPosts[1].includes('"subject_type":"discussion_post"') &&
    reportPosts[1].includes('"subject_id":"post-1"') &&
    reportPosts[1].includes("worth flagging") &&
    reportPosts[1].includes('"owner_id":"seller-1"'),
    reportPosts[1]);

  // ── §6.2 report a profile ──
  await page.evaluate(() => window.viewProfile("seller-1"));
  await page.waitForTimeout(600);
  check("profile: report button visible", await vis(page, "profileReportBtn"));
  await page.click("#profileReportBtn");
  await page.waitForTimeout(200);
  await page.selectOption("#reportReason", "other");
  await page.click('#reportForm button[type="submit"]');
  await page.waitForTimeout(400);
  check("profile report POST", reportPosts.length === 3 &&
    reportPosts[2].includes('"subject_type":"profile"') &&
    reportPosts[2].includes('"subject_id":"seller-1"') &&
    reportPosts[2].includes('"username":"zenfan"'),
    reportPosts[2]);

  // ── §6.5 password reset: request ──
  await page.evaluate(() => { window.showBuyBooks(); window.showLogin(); });
  await page.waitForTimeout(200);
  await page.fill("#email", "");
  await page.evaluate(() => window.handleForgotPassword());
  await page.waitForTimeout(300);
  check("forgot password: empty email → prompt, no request", recoverPosts.length === 0 && (await txt(page, "loginMessage")).includes("Enter your email"));

  await page.fill("#email", "reader@example.com");
  await page.evaluate(() => window.handleForgotPassword());
  await page.waitForTimeout(400);
  check("forgot password: recover request sent", recoverPosts.length === 1 && recoverPosts[0].includes("reader@example.com"), recoverPosts[0]);
  check("forgot password: neutral confirmation shown", (await txt(page, "loginMessage")).includes("reset link is on its way"));

  // ── §6.5 password reset: completion (simulates the PASSWORD_RECOVERY event) ──
  await page.evaluate(() => window._openResetPasswordModal());
  await page.waitForTimeout(200);
  check("reset modal opens", await modalVis(page, "resetPasswordModal"));

  await page.fill("#newPassword", "newpass123");
  await page.fill("#newPasswordConfirm", "different123");
  await page.click('#resetPasswordForm button[type="submit"]');
  await page.waitForTimeout(300);
  check("mismatched passwords blocked, no update", userPuts.length === 0 && (await txt(page, "resetPasswordMessage")).includes("do not match"));

  await page.fill("#newPasswordConfirm", "newpass123");
  await page.click('#resetPasswordForm button[type="submit"]');
  await page.waitForTimeout(400);
  check("new password submitted via auth updateUser", userPuts.length === 1 && userPuts[0].includes("newpass123"));
  check("reset modal closed + confirmation", !(await modalVis(page, "resetPasswordModal")) && dialogs.some((d) => d.includes("Password updated")));

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failures === 0 ? "\nALL SECURITY CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
})();
