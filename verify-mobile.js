// Playwright verification of core-loop mobile ergonomics (plan §3.0 / July 7
// audit). Guards against three regressions at phone widths:
//   1. layout-viewport expansion (any element forcing >device-width makes
//      mobile Chrome render the whole site zoomed out),
//   2. sub-44px tap targets in the loop screens,
//   3. primary actions not visible without scrolling (bottom-sheet + sticky
//      submit must keep them in thumb reach).
// Serve the app dir on port 7654 first (node dev-server.js).
const { chromium } = require("playwright");

const APP = "http://localhost:7654/index.html";

const json = (route, body, headers = {}) =>
  route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-expose-headers": "content-range", ...headers }, body: JSON.stringify(body) });

async function installRoutes(page) {
  await page.route("**/auth/v1/**", (route) => {
    const user = { id: "test-user-id", email: "t@e.com", aud: "authenticated", role: "authenticated", created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} };
    if (route.request().url().includes("/auth/v1/user")) return json(route, user);
    if (route.request().url().includes("/auth/v1/token")) return json(route, { access_token: "fake", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "r", user });
    return route.continue();
  });
  await page.route("**/rest/v1/**", (route) => {
    if (route.request().method() === "HEAD") return json(route, [], { "content-range": "0-0/0" });
    return json(route, []);
  });
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

// Runs inside the page: ergonomics measurements for one open modal.
function measure(modalId) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const modal = document.getElementById(modalId);
  const out = { smallTapTargets: [], tinyInputs: [], primaryHidden: [] };
  modal.querySelectorAll("button, .scanner-photo-label, .btn-live-camera, .btn").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const label = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
    if (r.height < 44) out.smallTapTargets.push(label + "=" + Math.round(r.height) + "px");
    if (el.matches(".btn-primary, .scanner-photo-primary, [type=submit]") && (r.bottom > vh || r.top < 0))
      out.primaryHidden.push(label);
  });
  modal.querySelectorAll("input, select, textarea").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    if (parseFloat(getComputedStyle(el).fontSize) < 16) out.tinyInputs.push(el.id || el.type);
  });
  return out;
}

let failures = 0;
function check(name, cond, extra = "") {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  [" + extra + "]" : ""));
  if (!cond) failures++;
}

(async () => {
  const browser = await chromium.launch();
  for (const vp of [{ w: 360, h: 640 }, { w: 390, h: 844 }, { w: 414, h: 896 }]) {
    const page = await (await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await installRoutes(page);
    await page.addInitScript(fakeSession);
    await page.goto(APP, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);

    const tag = `${vp.w}x${vp.h}`;

    // 1. THE regression guard: logged-in layout viewport === device width.
    const iw = await page.evaluate(() => window.innerWidth);
    check(`${tag} layout viewport is device width (no zoom-out)`, Math.abs(iw - vp.w) <= 1, "innerWidth=" + iw);

    // 2–4. the three loop screens
    const screens = [
      ["scanner", "barcodeScannerModal", () => window.openBookScanner()],
      ["add-to-shelf", "addToShelfModal", () => window.showAddToShelfModal("have")],
      ["sell", "sellModal", () => { document.getElementById("sellModal").style.display = "block"; }],
    ];
    for (const [name, id, open] of screens) {
      await page.evaluate(open);
      await page.waitForTimeout(250);
      const m = await page.evaluate(measure, id);
      check(`${tag} ${name}: no tap targets under 44px`, m.smallTapTargets.length === 0, m.smallTapTargets.join(", "));
      check(`${tag} ${name}: no inputs under 16px font (iOS zoom)`, m.tinyInputs.length === 0, m.tinyInputs.join(", "));
      check(`${tag} ${name}: primary action in thumb reach`, m.primaryHidden.length === 0, m.primaryHidden.join(", "));
      await page.evaluate((i) => { document.getElementById(i).style.display = "none"; }, id);
    }

    check(`${tag} no page errors`, errors.length === 0, errors.join(" | "));
    await page.close();
  }
  await browser.close();
  console.log(failures === 0 ? "\nALL MOBILE ERGONOMICS CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
})();
