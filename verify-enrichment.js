// Playwright verification for the Hardcover enrichment render path.
// Mocks Supabase REST + the book-enrichment Edge Function so we can drive the
// REAL UI to a book detail page and observe renderEnrichment() paint all five
// elements. This verifies the CLIENT rendering + wiring only — NOT the live
// deployed Edge Function or the DB migration (those need real Supabase access).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = 'http://localhost:7654/index.html';
const DIR = path.join(__dirname, 'verify-enrichment-screenshots');
const ss = (n) => path.join(DIR, n + '.png');

// ── Canned catalog data: a popular book (Dune) ──────────────────────────────
const ISBN = '9780441013593';
const booksJoin = { id: 'book-dune', title: 'Dune', author: 'Frank Herbert', cover_url: null, isbn: ISBN };
const BOOK = { ...booksJoin };

// ── The enrichment payload the (mocked) Edge Function returns ────────────────
// Shape matches payloadFromRow() in supabase/functions/book-enrichment/index.ts.
const ENRICHMENT = {
  enriched: true,
  source: 'cache',
  description:
    'Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides, heir to a ' +
    'noble family tasked with ruling an inhospitable world where the only thing of value is the ' +
    'spice melange, used to extend life and enhance consciousness. When House Atreides is ' +
    'betrayed, Paul is driven into the deep desert and the path of a messiah. A stunning blend of ' +
    'adventure and mysticism, environmentalism and politics, Dune won the first Nebula Award, ' +
    'shared the Hugo Award, and formed the basis of what is widely considered the greatest ' +
    'science fiction series of all time.',
  rating: 4.25,
  ratingCount: 123456,
  usersRead: 98765,
  genres: ['Science Fiction', 'Fantasy', 'Classics', 'Adventure', 'Fiction'],
  seriesName: 'Dune',
  seriesPosition: 1,
  category: 'Fiction',
  slug: 'dune',
  pageCount: 412,
  publisher: 'Ace',
  publishDate: '1965-08-01',
};

// Toggle the function's response between a full payload and graceful-degradation.
let enrichMode = 'full'; // 'full' | 'empty'

function isSingle(route) { return (route.request().headers()['accept'] || '').includes('vnd.pgrst.object'); }
const json = (route, body, headers = {}) => route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(body) });

async function installRoutes(page) {
  await page.route('**/auth/v1/**', (route) => {
    if (route.request().url().includes('/auth/v1/user')) {
      return json(route, { id: 'test-user-id', email: 'test@example.com', aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} });
    }
    return route.continue();
  });
  await page.route('**/rest/v1/listings*', (route) => json(route, []));
  await page.route('**/rest/v1/books*', (route) => isSingle(route) ? json(route, BOOK) : json(route, [BOOK]));
  await page.route('**/rest/v1/shelf_entries*', (route) => {
    if (route.request().method() === 'HEAD') return json(route, [], { 'content-range': '0-4/5' }); // want-count = 5
    return json(route, [{ book_id: 'book-dune', books: booksJoin }]);
  });
  await page.route('**/rest/v1/discussion_posts*', (route) => json(route, []));
  await page.route('**/rest/v1/profiles*', (route) => isSingle(route) ? json(route, { id: 'seller-1', username: 'dunefan' }) : json(route, []));
  await page.route('**/rest/v1/listing_photos*', (route) => json(route, []));
  await page.route('**/books/v1/volumes*', (route) => json(route, { items: [] }));
  await page.route('**/openlibrary.org/**', (route) => json(route, { docs: [] }));
  // THE KEY MOCK: the book-enrichment Edge Function.
  await page.route('**/functions/v1/book-enrichment', (route) =>
    json(route, enrichMode === 'full' ? ENRICHMENT : { enriched: false }));
}

function fakeSession() {
  localStorage.setItem('sb-kkmxdemnbuyuxnrezxmn-auth-token', JSON.stringify({
    access_token: 'fake', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r',
    user: { id: 'test-user-id', email: 'test@example.com', aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} },
  }));
}

async function openBookPage(page) {
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.isLoggedIn = true; });
  await page.waitForFunction(() => document.querySelectorAll('#communityHaveGrid .book-card, #communityWantGrid .book-card').length > 0, { timeout: 5000 });
  await page.locator('#communityHaveGrid .book-card, #communityWantGrid .book-card').first().click();
  await page.waitForSelector('#bookDetail', { state: 'visible', timeout: 5000 });
}

async function run() {
  fs.mkdirSync(DIR, { recursive: true });
  const log = [];
  const step = (i, m) => { console.log(i, m); log.push(i + ' ' + m); };

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  await installRoutes(page);
  await page.addInitScript(fakeSession);

  // ── FLOW 1: full enrichment payload → all five elements render ─────────────
  step('──', 'FLOW 1: open Dune book page, full enrichment payload');
  await openBookPage(page);
  // enrichment fills in async; wait for the Hardcover link — it's the last thing
  // painted, and now lives in the affiliate buy row (renderHardcoverBuyLink),
  // not inside #detailEnrichment.
  await page.waitForSelector('#detailAffiliates a[data-hc-link]', { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(300);

  const descText = await page.locator('#detailEnrichment .detail-book-description').innerText().catch(() => '');
  const starFilled = await page.locator('#detailEnrichment .detail-stars .star-filled').count();
  const starEmpty = await page.locator('#detailEnrichment .detail-stars .star-empty').count();
  const ratingNum = await page.locator('#detailEnrichment .detail-rating-num').innerText().catch(() => '');
  const ratingMeta = await page.locator('#detailEnrichment .detail-rating-meta').innerText().catch(() => '');
  const genrePills = await page.locator('#detailEnrichment .detail-genre-pill').evaluateAll(els => els.map(e => e.textContent.trim()));
  const seriesText = await page.locator('#detailEnrichment .detail-series').innerText().catch(() => '');
  const metaPills = await page.locator('#detailEnrichment .detail-pill').evaluateAll(els => els.map(e => e.textContent.trim()));
  // Hardcover link now sits in the affiliate buy row (alongside Amazon/AbeBooks),
  // rendered by renderHardcoverBuyLink(slug) — not inside #detailEnrichment.
  const hcLink = await page.locator('#detailAffiliates a[data-hc-link]').evaluateAll(as => as.map(a => ({ text: a.textContent.trim(), href: a.href, target: a.target })));

  step(descText.length > 100 ? '✅' : '❌', `description rendered (${descText.length} chars), starts: "${descText.slice(0, 60)}…"`);
  step(descText.includes('Read more') ? '✅' : '⚠️', `long description shows "Read more" toggle: ${descText.includes('Read more')}`);
  step(starFilled === 4 && starEmpty === 1 ? '✅' : '❌', `star rating: ${starFilled} filled + ${starEmpty} empty (expect 4+1 for 4.25→round 4)`);
  step(ratingNum === '4.3' ? '✅' : '⚠️', `rating number shown: "${ratingNum}" (4.25.toFixed(1)=4.3)`);
  step(/123,456 ratings/.test(ratingMeta) && /98,765 readers/.test(ratingMeta) ? '✅' : '⚠️', `rating meta: "${ratingMeta}"`);
  step(genrePills.length === 5 ? '✅' : '❌', `genre pills: ${genrePills.length} → ${JSON.stringify(genrePills)}`);
  step(/Book 1 in Dune/.test(seriesText) ? '✅' : '❌', `series line: "${seriesText}"`);
  step('🔍', `meta pills (pages/publisher/year/category): ${JSON.stringify(metaPills)}`);
  step(hcLink.length === 1 && hcLink[0].href === 'https://hardcover.app/books/dune' && hcLink[0].target === '_blank' && /View on Hardcover/.test(hcLink[0].text) ? '✅' : '❌',
    `Hardcover link (in affiliate row): ${JSON.stringify(hcLink)}`);
  await page.screenshot({ path: ss('01-enrichment-full'), fullPage: true });
  // tight crop of just the enrichment block for the report
  await page.locator('#detailEnrichment').screenshot({ path: ss('01b-enrichment-only') }).catch(() => {});

  // ── PROBE: graceful degradation when the function returns enriched:false ────
  step('──', 'PROBE: function returns {enriched:false}');
  enrichMode = 'empty';
  await openBookPage(page);
  await page.waitForTimeout(800);
  const emptyHTML = await page.locator('#detailEnrichment').innerHTML();
  const emptyHcLink = await page.locator('#detailAffiliates a[data-hc-link]').count();
  step(emptyHTML.trim() === '' ? '🔍' : '⚠️', `enrichment container empty on no-match (len=${emptyHTML.trim().length})`);
  step(emptyHcLink === 0 ? '✅' : '❌', `no Hardcover link when enrichment misses: ${emptyHcLink === 0}`);
  await page.screenshot({ path: ss('02-graceful-degradation'), fullPage: true });

  if (consoleErrors.length === 0) step('🔍', 'Zero JS console errors during run');
  else step('⚠️', `Console errors (${consoleErrors.length}): ` + consoleErrors.slice(0, 4).join(' || '));

  await browser.close();
  console.log('\n=== SUMMARY ===');
  log.forEach(l => console.log(l));
  console.log('\nScreenshots: ' + DIR);
}
run().catch(e => { console.error('FATAL:', e.stack || e); process.exit(1); });
