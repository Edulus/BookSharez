// Playwright verification for this session's book-flow changes.
// Mocks Supabase REST + Google Books so we can drive the real UI.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = 'http://localhost:7654/index.html';
const DIR = path.join(__dirname, 'verify-bookflow-screenshots');
const ss = (n) => path.join(DIR, n + '.png');

// ── Canned data ────────────────────────────────────────────────────────────
const BOOK_A = { id: 'book-A', isbn: '9780111111111', title: 'The Way of Zen', author: 'Alan Watts', cover_url: null };
const booksJoin = { id: 'book-A', title: 'The Way of Zen', author: 'Alan Watts', cover_url: null, isbn: '9780111111111' };
const LISTING_1 = { id: 'list-1', price: 12.5, condition: 'good', created_at: '2026-06-20T00:00:00Z', description: 'Clean used copy.', book_id: 'book-A', user_id: 'seller-1', books: booksJoin };
const LISTING_2 = { id: 'list-2', price: 9.99, condition: 'fair', created_at: '2026-06-19T00:00:00Z', description: 'Reading copy.', book_id: 'book-A', user_id: 'seller-2', books: booksJoin };

const GBOOKS = { items: [
  { volumeInfo: { title: 'The Way of Zen', authors: ['Alan Watts'], publishedDate: '1957', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780111111111' }], imageLinks: {} } },
  { volumeInfo: { title: 'The Wisdom of Insecurity', authors: ['Alan Watts'], publishedDate: '1951', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780222222222' }], imageLinks: {} } },
  { volumeInfo: { title: 'Become What You Are', authors: ['Alan Watts'], publishedDate: '1995', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780333333333' }], imageLinks: {} } },
] };

function isSingle(route) { return (route.request().headers()['accept'] || '').includes('vnd.pgrst.object'); }
const json = (route, body, headers = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });

const shelfPosts = []; // captured POST bodies to /rest/v1/shelf_entries (one-tap Want/Have, §3.3)

async function installRoutes(page) {
  await page.route('**/auth/v1/**', (route) => {
    if (route.request().url().includes('/auth/v1/user')) {
      return json(route, { id: 'test-user-id', email: 'test@example.com', aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} });
    }
    return route.continue();
  });
  await page.route('**/rest/v1/listings*', (route) => {
    const url = route.request().url();
    if (isSingle(route) && /id=eq\.list-1/.test(url)) return json(route, LISTING_1);
    if (isSingle(route) && /id=eq\.list-2/.test(url)) return json(route, LISTING_2);
    return json(route, [LISTING_1, LISTING_2]);
  });
  await page.route('**/rest/v1/books*', (route) => {
    if (isSingle(route)) return json(route, BOOK_A);
    return json(route, [BOOK_A]);
  });
  await page.route('**/rest/v1/shelf_entries*', (route) => {
    const req = route.request();
    if (req.method() === 'POST') { // one-tap Want/Have upsert (§3.3)
      const body = JSON.parse(req.postData() || '{}');
      shelfPosts.push({ body, prefer: req.headers()['prefer'] || '' });
      return json(route, Array.isArray(body) ? body : [body]);
    }
    if (req.method() === 'HEAD') return json(route, [], { 'content-range': '0-2/3' }); // want-count = 3
    if (/user_id=eq\./.test(req.url())) return json(route, []); // my-shelf / ownership pre-check: owns nothing
    return json(route, [{ book_id: 'book-A', books: { id: 'book-A', title: 'The Way of Zen', author: 'Alan Watts', cover_url: null } }]);
  });
  await page.route('**/rest/v1/discussion_posts*', (route) => json(route, []));
  await page.route('**/rest/v1/notifications*', (route) => json(route, [])); // bell badge query (July 4)
  await page.route('**/rest/v1/profiles*', (route) => isSingle(route) ? json(route, { id: 'seller-1', username: 'zenfan' }) : json(route, []));
  await page.route('**/rest/v1/listing_photos*', (route) => json(route, []));
  await page.route('**/books/v1/volumes*', (route) => json(route, GBOOKS));
  await page.route('**/openlibrary.org/**', (route) => json(route, { docs: [] }));
}

function fakeSession() {
  localStorage.setItem('sb-kkmxdemnbuyuxnrezxmn-auth-token', JSON.stringify({
    access_token: 'fake', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
    user: { id: 'test-user-id', email: 'test@example.com', aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} },
  }));
}

async function run() {
  fs.mkdirSync(DIR, { recursive: true });
  const log = [];
  const step = (i, m) => { console.log(i, m); log.push(i + ' ' + m); };

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  await installRoutes(page);
  await page.addInitScript(fakeSession);
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.isLoggedIn = true; });
  step('✅', 'App loaded at ' + APP_URL);

  // ── FLOW 1: search shows larger cards, no "not yet available" ──────────────
  step('──', 'FLOW 1: search "Alan Watts"');
  await page.fill('#searchInput', 'Alan Watts');
  await page.press('#searchInput', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#booksGrid .book-card').length > 0, { timeout: 5000 });
  await page.waitForTimeout(300);
  const cardCount = await page.locator('#booksGrid .book-card').count();
  const imgH = await page.locator('#booksGrid .book-card .book-image').first().evaluate(el => el.offsetHeight);
  const cardW = await page.locator('#booksGrid .book-card').first().evaluate(el => el.offsetWidth);
  const gridText = await page.locator('#booksGrid').innerText();
  const hasNotAvail = /not yet available/i.test(gridText);
  step('✅', `cards rendered: ${cardCount}`);
  step(imgH === 288 ? '✅' : '❌', `card image height = ${imgH}px (expect 288 = 250 +15%)`);
  step('✅', `card width = ${cardW}px (grid min raised 280→322)`);
  step(!hasNotAvail ? '✅' : '❌', `"not yet available" text present in grid: ${hasNotAvail}`);
  await page.screenshot({ path: ss('01-search-results'), fullPage: true });

  // ── FLOW 2: external book → rich page (no modal) + affiliate links ─────────
  step('──', 'FLOW 2: click external book "The Wisdom of Insecurity"');
  await page.locator('#booksGrid .book-card', { hasText: 'The Wisdom of Insecurity' }).first().click();
  await page.waitForTimeout(400);
  const detailVisible = await page.locator('#bookDetail').isVisible();
  const modalVisible = await page.locator('#addToShelfModal').isVisible().catch(() => false);
  const extActionsVis = await page.locator('#detailExternalActions').isVisible();
  const haveBtnVis = await page.locator('#detailHaveBtn').isVisible();
  const wantBtnVis = await page.locator('#detailWantBtn').isVisible();
  const offersVis = await page.locator('#detailOffers').isVisible().catch(() => false);
  const buyBtnVis = await page.locator('#detailBuyBtn').isVisible().catch(() => false);
  const affLinks = await page.locator('#detailAffiliates a').evaluateAll(as => as.map(a => ({ text: a.textContent.trim(), href: a.href })));
  step(detailVisible ? '✅' : '❌', `bookDetail visible: ${detailVisible}`);
  step(!modalVisible ? '✅' : '❌', `Add-to-Shelf MODAL visible (should be false): ${modalVisible}`);
  step(haveBtnVis && wantBtnVis && extActionsVis ? '✅' : '❌', `one-tap Have/Want buttons visible (have:${haveBtnVis} want:${wantBtnVis})`);
  step(!offersVis ? '✅' : '❌', `community offers hidden for external book: ${!offersVis}`);
  step(!buyBtnVis ? '✅' : '❌', `single-listing Buy button hidden: ${!buyBtnVis}`);
  step(affLinks.length === 2 ? '✅' : '❌', `affiliate links: ${JSON.stringify(affLinks)}`);
  const amazonOk = affLinks.some(l => /Amazon/i.test(l.text) && /amazon\.com/.test(l.href) && /9780222222222/.test(l.href));
  const abeOk = affLinks.some(l => /AbeBooks/i.test(l.text) && /abebooks\.com/.test(l.href) && /9780222222222/.test(l.href));
  step(amazonOk ? '✅' : '❌', `Amazon link targets ISBN: ${amazonOk}`);
  step(abeOk ? '✅' : '❌', `AbeBooks link targets ISBN: ${abeOk}`);

  // One-tap "I have this" on an EXTERNAL book: must resolve a catalog id via
  // ensureBook (select-by-ISBN here), then upsert shelf_entries — never a
  // books upsert (§6.1).
  await page.locator('#detailHaveBtn').click();
  await page.waitForTimeout(500);
  const f2HavePost = shelfPosts.find(p => p.body.shelf_type === 'have');
  const f2HaveOk = f2HavePost && f2HavePost.body.user_id === 'test-user-id' && f2HavePost.body.book_id === 'book-A';
  step(f2HaveOk ? '✅' : '❌', `external Have tap → shelf_entries upsert: ${JSON.stringify(f2HavePost && f2HavePost.body)}`);
  step(f2HavePost && /merge-duplicates/.test(f2HavePost.prefer) ? '✅' : '❌', `upsert is duplicate-safe (Prefer: ${f2HavePost && f2HavePost.prefer})`);
  const f2HaveLabel = await page.locator('#detailHaveBtn').innerText();
  const f2HaveDisabled = await page.locator('#detailHaveBtn').isDisabled();
  step(/Books I Have/.test(f2HaveLabel) && f2HaveDisabled ? '✅' : '❌', `Have button flipped to added state: "${f2HaveLabel}" disabled:${f2HaveDisabled}`);
  await page.screenshot({ path: ss('02-external-book-page'), fullPage: true });

  // ── FLOW 3: catalog/shelf book → unified page with seller offer tiles ──────
  step('──', 'FLOW 3: home → click community-shelf book');
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.isLoggedIn = true; });
  await page.waitForFunction(() => document.querySelectorAll('#communityHaveGrid .book-card, #communityWantGrid .book-card').length > 0, { timeout: 5000 });
  await page.locator('#communityHaveGrid .book-card, #communityWantGrid .book-card').first().click();
  await page.waitForFunction(() => document.querySelectorAll('#detailOffersGrid .book-card').length > 0, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  const f3DetailVis = await page.locator('#bookDetail').isVisible();
  const f3Title = await page.locator('#detailTitle').innerText();
  const f3OffersVis = await page.locator('#detailOffers').isVisible();
  const f3OfferTiles = await page.locator('#detailOffersGrid .book-card').count();
  const f3Prices = await page.locator('#detailOffersGrid .book-price').evaluateAll(els => els.map(e => e.textContent.trim()));
  const f3WantCount = await page.locator('#detailWantCount').innerText().catch(() => '');
  const f3AffVis = await page.locator('#detailExternalActions').isVisible();
  step(f3DetailVis ? '✅' : '❌', `bookDetail visible: ${f3DetailVis}, title: "${f3Title}"`);
  step(f3OffersVis && f3OfferTiles === 2 ? '✅' : '❌', `community offers visible with ${f3OfferTiles} seller tiles, prices: ${JSON.stringify(f3Prices)}`);
  step(f3AffVis ? '✅' : '❌', `affiliate/add-to-shelf section also shown (secondary): ${f3AffVis}`);
  step('🔍', `want-count social proof: "${f3WantCount}"`);

  // One-tap "I want this" on a CATALOG book: known book id, no ensureBook —
  // straight to the shelf_entries upsert, button flips, stays on the page.
  const f3PostsBefore = shelfPosts.length;
  await page.locator('#detailWantBtn').click();
  await page.waitForTimeout(500);
  const f3WantPost = shelfPosts.slice(f3PostsBefore).find(p => p.body.shelf_type === 'want');
  const f3WantOk = f3WantPost && f3WantPost.body.user_id === 'test-user-id' && f3WantPost.body.book_id === 'book-A';
  step(f3WantOk ? '✅' : '❌', `catalog Want tap → shelf_entries upsert: ${JSON.stringify(f3WantPost && f3WantPost.body)}`);
  const f3WantLabel = await page.locator('#detailWantBtn').innerText();
  const f3WantDisabled = await page.locator('#detailWantBtn').isDisabled();
  step(/Books I Want/.test(f3WantLabel) && f3WantDisabled ? '✅' : '❌', `Want button flipped to added state: "${f3WantLabel}" disabled:${f3WantDisabled}`);
  const f3StillOnPage = await page.locator('#bookDetail').isVisible();
  step(f3StillOnPage ? '✅' : '❌', `still on the book page after tap (no modal, no navigation): ${f3StillOnPage}`);
  await page.screenshot({ path: ss('03-unified-book-page'), fullPage: true });

  // ── FLOW 4: click an offer tile → single-listing detail page ──────────────
  step('──', 'FLOW 4: click first seller offer tile');
  await page.locator('#detailOffersGrid .book-card .book-title').first().click();
  await page.waitForTimeout(500);
  const f4DetailVis = await page.locator('#bookDetail').isVisible();
  const f4Price = await page.locator('#detailPrice').innerText();
  const f4OffersVis = await page.locator('#detailOffers').isVisible().catch(() => false);
  const f4ExtVis = await page.locator('#detailExternalActions').isVisible().catch(() => false);
  const f4BuyVis = await page.locator('#detailBuyBtn').isVisible();
  const f4Seller = await page.locator('#detailSeller').innerText().catch(() => '');
  const f4Cond = await page.locator('#detailCondition').innerText().catch(() => '');
  step(f4DetailVis ? '✅' : '❌', `single-listing page visible: ${f4DetailVis}`);
  step(/12\.50/.test(f4Price) ? '✅' : '❌', `listing price shown: "${f4Price}"`);
  step(!f4OffersVis && !f4ExtVis ? '✅' : '❌', `book-page sections hidden on listing view (offers:${f4OffersVis} ext:${f4ExtVis})`);
  step(f4BuyVis ? '✅' : '❌', `Buy Now button restored: ${f4BuyVis}`);
  step('🔍', `seller: "${f4Seller}", condition badge: "${f4Cond}"`);
  await page.screenshot({ path: ss('04-single-listing'), fullPage: true });

  // ── 🔍 Probe: external dedupe — "The Way of Zen" not an external card ──────
  step('──', 'PROBES');
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.isLoggedIn = true; });
  await page.fill('#searchInput', 'Alan Watts');
  await page.press('#searchInput', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#booksGrid .book-card').length > 0, { timeout: 5000 });
  await page.waitForTimeout(200);
  const wozCards = await page.locator('#booksGrid .book-card', { hasText: 'The Way of Zen' }).count();
  step(wozCards === 2 ? '🔍' : '⚠️', `"The Way of Zen" appears ${wozCards}x (2 local listings; external dup deduped, not a 3rd)`);

  // 🔍 Probe: external card has no price footer (not listed locally)
  const wisdomHasPrice = await page.locator('#booksGrid .book-card', { hasText: 'The Wisdom of Insecurity' }).first().locator('.book-price').count();
  step('🔍', `external card price footers: ${wisdomHasPrice} (0 = no price, "Be the first to list" CTA kept per user choice)`);

  if (consoleErrors.length === 0) step('🔍', 'Zero JS console errors during run');
  else step('⚠️', `Console errors (${consoleErrors.length}): ` + consoleErrors.slice(0, 4).join(' || '));

  await browser.close();
  console.log('\n=== SUMMARY ===');
  log.forEach(l => console.log(l));
  console.log('\nScreenshots: ' + DIR);
}
run().catch(e => { console.error('FATAL:', e.stack || e); process.exit(1); });
