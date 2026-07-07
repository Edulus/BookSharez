// Playwright verification for dashboard batch-scanning behavior.
//
// Run locally with the repo served at http://localhost:7654/index.html, e.g.:
//   npx http-server . -p 7654
//   node verify-batchscan.js
//
// The harness uses a phone-sized 390×844 viewport and mocks Supabase calls. It
// cannot verify real camera restart because headless Chromium has no physical
// camera; it verifies the fallback/manual capture loop and persistence.

const { chromium } = require('playwright');

const APP_URL = 'http://localhost:7654/index.html';
const BOOK_A = {
  id: 'book-a',
  isbn: '9780679723004',
  title: 'The Way of Zen',
  author: 'Alan Watts',
  cover_url: null,
};
const BOOK_B = {
  id: 'book-b',
  isbn: '9780553296129',
  title: 'Dune',
  author: 'Frank Herbert',
  cover_url: null,
};

function json(route, body, status = 200, headers = {}) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body),
  });
}

async function installRoutes(page) {
  let shelfInsertCount = 0;

  await page.route('**/auth/v1/**', (route) => {
    if (route.request().url().includes('/auth/v1/user')) {
      return json(route, {
        id: 'test-user-id',
        email: 'test@example.com',
        aud: 'authenticated',
        role: 'authenticated',
        created_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: {},
      });
    }
    return route.continue();
  });

  await page.route('**/rest/v1/books*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      const match = body.isbn === BOOK_B.isbn ? BOOK_B : BOOK_A;
      return json(route, { id: match.id });
    }
    if (/isbn=eq\.9780553296129/.test(url)) return json(route, BOOK_B);
    if (/isbn=eq\.9780679723004/.test(url)) return json(route, BOOK_A);
    return json(route, [BOOK_A, BOOK_B]);
  });

  await page.route('**/rest/v1/shelf_entries*', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      shelfInsertCount += 1;
      if (shelfInsertCount === 3) {
        return json(route, {
          code: '23505',
          message: 'duplicate key value violates unique constraint',
        }, 409);
      }
      return json(route, [{ id: `shelf-${shelfInsertCount}` }], 201);
    }
    if (req.method() === 'HEAD') {
      return json(route, [], 200, { 'content-range': '0-0/0' });
    }
    return json(route, [
      { id: 'shelf-a', books: BOOK_A },
      { id: 'shelf-b', books: BOOK_B },
    ]);
  });

  await page.route('**/rest/v1/listings*', (route) => json(route, []));
  await page.route('**/rest/v1/profiles*', (route) => json(route, []));
  await page.route('**/rest/v1/discussion_posts*', (route) => json(route, []));
  await page.route('**/rest/v1/listing_photos*', (route) => json(route, []));
  await page.route('**/books/v1/volumes*', (route) => json(route, { items: [] }));
  await page.route('**/openlibrary.org/**', (route) => json(route, { docs: [] }));
}

function fakeSession() {
  localStorage.setItem('sb-kkmxdemnbuyuxnrezxmn-auth-token', JSON.stringify({
    access_token: 'fake',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'r',
    user: {
      id: 'test-user-id',
      email: 'test@example.com',
      aud: 'authenticated',
      role: 'authenticated',
      created_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
    },
  }));
  localStorage.removeItem(new Date().toISOString().slice(0, 10));
}

async function seedFoundBook(page, book) {
  await page.evaluate((b) => {
    _scannerTarget = 'dashboard';
    _scannedBookData = b;
    document.getElementById('scannerBookCover').src = b.cover_url || '';
    document.getElementById('scannerBookTitle').textContent = b.title;
    document.getElementById('scannerBookAuthor').textContent = b.author ? 'by ' + b.author : '';
    _showScannerState('found');
  }, book);
}

async function run() {
  const log = [];
  const step = (ok, msg) => {
    const icon = ok === true ? '✅' : ok === false ? '❌' : '🔍';
    console.log(icon, msg);
    log.push({ ok, msg });
  };

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const dialogs = [];
  const consoleErrors = [];

  page.on('dialog', async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await installRoutes(page);
  await page.addInitScript(fakeSession);
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__bookSharezBatchScan, { timeout: 5000 });
  await page.evaluate(() => window.__bookSharezBatchScan.resetTodayCount());

  step(true, 'App loaded and batch-scan enhancement present');

  await page.evaluate(() => { window.isLoggedIn = true; openBookScanner(); });
  await page.waitForSelector('#scannerSessionCounter');
  const initialChip = await page.locator('#scannerSessionCounter').innerText();
  step(initialChip === '0 books added today', `initial counter: "${initialChip}"`);

  await seedFoundBook(page, BOOK_A);
  await page.locator('#scannerStateFound .scanner-actions .btn-primary').click();
  await page.waitForFunction(() => document.getElementById('scannerStateScanning').style.display !== 'none');
  const modalStillOpen = await page.locator('#barcodeScannerModal').isVisible();
  const toast1 = await page.locator('#scannerBatchToast').innerText();
  const count1 = await page.evaluate(() => window.__bookSharezBatchScan.getTodayCount());
  step(modalStillOpen, 'modal stays open after first add');
  step(/added to Books I Have/.test(toast1), `success toast: "${toast1}"`);
  step(count1 === 1, `counter after first add: ${count1}`);

  await seedFoundBook(page, BOOK_B);
  await page.locator('#scannerStateFound .scanner-actions .btn-primary').click();
  await page.waitForFunction(() => window.__bookSharezBatchScan.getTodayCount() === 2);
  const count2 = await page.evaluate(() => window.__bookSharezBatchScan.getTodayCount());
  step(count2 === 2, `counter after second add: ${count2}`);

  await seedFoundBook(page, BOOK_B);
  await page.locator('#scannerStateFound .scanner-actions .btn-primary').click();
  await page.waitForTimeout(250);
  const countAfterDup = await page.evaluate(() => window.__bookSharezBatchScan.getTodayCount());
  const dupToast = await page.locator('#scannerBatchToast').innerText();
  step(countAfterDup === 2, `duplicate does not inflate counter: ${countAfterDup}`);
  step(/Already on Books I Have/.test(dupToast), `duplicate toast: "${dupToast}"`);

  await page.evaluate(() => closeBarcodeScanner());
  await page.evaluate(() => openBookScanner());
  const reopenedChip = await page.locator('#scannerSessionCounter').innerText();
  step(reopenedChip === '2 books added today', `counter persists after close/reopen: "${reopenedChip}"`);

  const manualDefined = await page.evaluate(() => typeof window.scannerManualLookup === 'function');
  step(manualDefined, 'scannerManualLookup exists for manual ISBN path');
  step(dialogs.length === 0, `blocking dialogs during batch add: ${dialogs.length}`);
  step(consoleErrors.length === 0, `console/page errors: ${consoleErrors.length}`);

  await browser.close();

  if (log.some((entry) => entry.ok === false)) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
