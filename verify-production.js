// Production smoke harness (§8) — drives the REAL deployed site (no mocks,
// real Supabase). Logged-out-safe checks only; the logged-in checklist
// (add to shelf, Add & List, report submit) is manual — see FOR_YOU_TO_DO.md.
//   node verify-production.js [url]     (default: the GitHub Pages URL)
const { chromium } = require("playwright");

const URL_ = process.argv[2] || "https://edulus.github.io/BookSharez/";

let failures = 0;
function check(name, cond, extra = "") {
  console.log((cond ? "PASS" : "FAIL") + "  " + name + (extra ? "  [" + extra + "]" : ""));
  if (!cond) failures++;
}
const modalVis = (page, id) => page.evaluate((i) => { const el = document.getElementById(i); return !!el && getComputedStyle(el).display !== "none"; }, id);

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
  page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 120)));

  console.log("Target:", URL_);
  await page.goto(URL_, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1500);

  // 1. homepage + deployed version
  check("homepage loads with correct title", (await page.title()) === "BookSharez - Used Books Marketplace", await page.title());
  check("og:url points at production", await page.evaluate(() =>
    (document.querySelector('meta[property="og:url"]') || {}).content === "https://edulus.github.io/BookSharez/"));

  // 2. all CDN/script dependencies actually loaded in production
  const deps = await page.evaluate(() => ({
    supabase: typeof window.supabase !== "undefined",
    supabaseClient: typeof window.supabaseClient !== "undefined" || typeof supabaseClient !== "undefined",
    quagga: typeof window.Quagga !== "undefined",
    html5qrcode: typeof window.Html5Qrcode !== "undefined",
    modules: typeof window.searchBooks === "function" && typeof window.openBookScanner === "function",
  }));
  check("supabase-js CDN loaded", deps.supabase);
  check("supabase client initialised", deps.supabaseClient);
  check("barcode libs loaded (Quagga + Html5Qrcode)", deps.quagga && deps.html5qrcode, JSON.stringify(deps));
  check("ES module graph loaded (window exports present)", deps.modules);

  // 3. real data from Supabase (browse grid painted something)
  const gridState = await page.evaluate(() => {
    const g = document.getElementById("booksGrid");
    return { children: g ? g.children.length : -1, text: g ? g.textContent.slice(0, 60) : "" };
  });
  check("browse grid rendered (live Supabase data or message)", gridState.children > 0, JSON.stringify(gridState));

  // 4. auth surfaces reachable
  await page.evaluate(() => window.showLogin());
  await page.waitForTimeout(200);
  check("login modal opens", await modalVis(page, "loginModal"));
  check("forgot-password link present", await page.evaluate(() =>
    !!document.querySelector('#loginModal a[onclick*="handleForgotPassword"]')));
  await page.evaluate(() => window.showSignup());
  await page.waitForTimeout(200);
  check("signup modal opens", await modalVis(page, "signupModal"));
  await page.evaluate(() => window.closeModal("signupModal"));
  check("reset-password modal exists in DOM", await page.evaluate(() => !!document.getElementById("resetPasswordModal")));
  check("report modal exists in DOM", await page.evaluate(() => !!document.getElementById("reportModal")));

  // 5. scanner modal opens with all capture options
  await page.evaluate(() => window.openBookScanner());
  await page.waitForTimeout(300);
  check("scanner modal opens", await modalVis(page, "barcodeScannerModal"));
  check("all capture paths present (photo/live/cover/manual)", await page.evaluate(() =>
    !!document.getElementById("scannerPhotoInput") &&
    !!document.getElementById("btnLiveCamera") &&
    !!document.getElementById("scannerCoverInput") &&
    !!document.getElementById("scannerManualISBN")));
  await page.evaluate(() => window.closeBarcodeScanner());

  // 6. auth gate: logged-out dashboard deep link lands on login, not a crash
  await page.goto(URL_ + "#/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  check("logged-out #/dashboard deep link → login modal", await modalVis(page, "loginModal"));

  // 7. clean console
  const realErrors = consoleErrors.filter((e) => !/favicon/i.test(e));
  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  check("no console errors on load", realErrors.length === 0, realErrors.join(" | "));

  await browser.close();
  console.log(failures === 0 ? "\nALL PRODUCTION SMOKE CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures ? 1 : 0);
})();
