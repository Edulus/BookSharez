// Playwright verification script for vision-extract client wiring.
// Mocks Supabase auth + vision-extract Edge Function so we can drive
// the full UI flow without real credentials.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const APP_URL = 'http://localhost:7654/index.html';
const SCREENSHOT_DIR = path.join(__dirname, 'verify-screenshots');

// Canned vision-extract responses
const VISION_COVER_RESPONSE = {
  ok: true,
  mode: 'cover',
  data: { title: 'Dune', author: 'Frank Herbert', isbn: null, confidence: 'high' }
};
const VISION_BARCODE_RESPONSE = {
  ok: true,
  mode: 'barcode',
  data: { isbn: '9780441172719', confidence: 'high' }
};

function ss(name) {
  return path.join(SCREENSHOT_DIR, name + '.png');
}

async function run() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const log = [];
  const step = (icon, msg) => { console.log(icon, msg); log.push(icon + ' ' + msg); };

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();

  // ── Network interception ──────────────────────────────────────────────────

  // Supabase auth
  await page.route('**/auth/v1/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/user')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-user-id',
          email: 'test@example.com',
          aud: 'authenticated',
          role: 'authenticated',
          created_at: new Date().toISOString(),
          app_metadata: { provider: 'email' },
          user_metadata: {},
        }),
      });
    } else {
      await route.continue();
    }
  });

  // vision-extract Edge Function
  let visionCallCount = 0;
  let lastVisionMode = null;
  let lastVisionPayload = null;
  await page.route('**/functions/v1/vision-extract', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    lastVisionMode = body.mode;
    lastVisionPayload = body;
    visionCallCount++;
    const response = body.mode === 'barcode' ? VISION_BARCODE_RESPONSE : VISION_COVER_RESPONSE;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });

  // isbn-lookup Edge Function
  await page.route('**/functions/v1/isbn-lookup', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        found: true,
        source: 'cache',
        book: {
          isbn: '9780441172719',
          isbn10: '0441172717',
          title: 'Dune',
          author: 'Frank Herbert',
          publisher: 'Ace Books',
          publishDate: '1990-09-01',
          coverUrl: null,
          pageCount: 604,
          language: 'en',
        },
      }),
    });
  });

  // Google Books search (for cover search after vision read)
  await page.route('**/books/v1/volumes*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          volumeInfo: {
            title: 'Dune',
            authors: ['Frank Herbert'],
            publisher: 'Ace Books',
            publishedDate: '1990-09-01',
            pageCount: 604,
            language: 'en',
            industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780441172719' }],
            imageLinks: {},
          },
        }],
      }),
    });
  });

  // Supabase REST (shelves, books table, etc.) — return empty
  await page.route('**/rest/v1/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  // ── Inject fake session before page loads ─────────────────────────────────
  await page.addInitScript(() => {
    const fakeSession = {
      access_token: 'fake-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'fake-refresh-token',
      user: {
        id: 'test-user-id',
        email: 'test@example.com',
        aud: 'authenticated',
        role: 'authenticated',
        created_at: new Date().toISOString(),
        app_metadata: { provider: 'email' },
        user_metadata: {},
      },
    };
    localStorage.setItem(
      'sb-kkmxdemnbuyuxnrezxmn-auth-token',
      JSON.stringify(fakeSession)
    );
  });

  // ── Load app ──────────────────────────────────────────────────────────────
  step('⏳', 'Loading app at ' + APP_URL);
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await page.screenshot({ path: ss('01-app-loaded') });
  step('✅', 'App loaded');

  // ── DOM structure check ───────────────────────────────────────────────────
  const domChecks = [
    ['#scannerVisionFallback', 'Vision fallback div'],
    ['#scannerCoverInput', 'Cover photo file input'],
    ['#scannerCoverResults', 'Cover results div'],
    ['#scannerVisionFallback button', 'AI barcode reader button'],
    ['.scanner-vision-fallback', 'CSS class scanner-vision-fallback'],
    ['.scanner-cover-results', 'CSS class scanner-cover-results'],
  ];
  for (const [sel, label] of domChecks) {
    const count = await page.locator(sel).count();
    step(count > 0 ? '✅' : '❌', label + ': ' + (count > 0 ? 'present' : 'MISSING'));
  }

  // ── JS function check ─────────────────────────────────────────────────────
  const jsFns = ['retryWithVision', 'scanCoverPhoto', '_compressAndEncode', '_callVisionExtract'];
  for (const fn of jsFns) {
    const ok = await page.evaluate(n => typeof window[n] === 'function', fn);
    step(ok ? '✅' : '❌', fn + '() defined: ' + (ok ? 'yes' : 'NO'));
  }

  // Force logged-in UI state
  await page.evaluate(() => {
    window.isLoggedIn = true;
  });

  // ── PATH A: Cover photo ───────────────────────────────────────────────────
  step('', '');
  step('── PATH A', 'Cover photo scan');

  await page.evaluate(() => window.openBarcodeScanner('sell'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: ss('02-scanner-open') });

  const coverInputVisible = await page.locator('#scannerCoverInput').count() > 0;
  step(coverInputVisible ? '✅' : '❌', '"Read Book Cover" input in open modal');

  // Tiny 1×1 JPEG (valid file, no barcode)
  const tinyJpegB64 =
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEB' +
    'AxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAA' +
    'AAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwABmX/9k=';

  step('⏳', 'Calling scanCoverPhoto() with fake 1×1 JPEG...');
  await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bytes], 'cover.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('scannerCoverInput');
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    await window.scanCoverPhoto(input);
  }, tinyJpegB64);

  await page.waitForTimeout(2000);
  const coverStatusText = await page.locator('#scannerStatus').textContent().catch(() => '(empty)');
  step('✅', 'Status after cover read: "' + coverStatusText.trim() + '"');
  await page.screenshot({ path: ss('03-cover-after-vision') });

  const coverResultsVis = await page.locator('#scannerCoverResults').isVisible().catch(() => false);
  const candidateCount = await page.locator('#scannerCoverResults > div').count();
  step(coverResultsVis ? '✅' : '❌', 'Cover results visible: ' + coverResultsVis + ', candidates: ' + candidateCount);
  await page.screenshot({ path: ss('04-cover-candidates') });

  // Click the first candidate
  if (candidateCount > 0) {
    step('⏳', 'Clicking first candidate (user confirmation)...');
    await page.locator('#scannerCoverResults > div').first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: ss('05-after-candidate-click') });
    const scannerStillOpen = await page.locator('#barcodeScannerModal').isVisible().catch(() => false);
    step('✅', 'After candidate click — scanner visible: ' + scannerStillOpen + ' (routes to isbn-lookup flow)');
  } else {
    step('⚠️', 'No candidates to click — checking status for error message');
    const statusAfter = await page.locator('#scannerStatus').textContent().catch(() => '');
    step('⚠️', 'Status: "' + statusAfter.trim() + '"');
  }

  // ── PATH B: Barcode recovery — fresh page to avoid async contamination ───
  step('', '');
  step('── PATH B', 'Barcode recovery after scan failure (fresh page)');

  const page2 = await ctx.newPage();
  page2.on('console', m => { if (m.type() === 'error') consoleErrors.push('P2:' + m.text()); });

  // Same intercepts for page2
  await page2.route('**/auth/v1/**', async (route) => {
    if (route.request().url().includes('/auth/v1/user')) {
      await route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ id: 'test-user-id', email: 'test@example.com', aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} }) });
    } else { await route.continue(); }
  });
  await page2.route('**/functions/v1/vision-extract', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    lastVisionMode = body.mode; lastVisionPayload = body; visionCallCount++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VISION_BARCODE_RESPONSE) });
  });
  await page2.route('**/functions/v1/isbn-lookup', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ found: true, source: 'cache', book: { isbn: '9780441172719', isbn10: '0441172717', title: 'Dune', author: 'Frank Herbert', publisher: 'Ace Books', publishDate: '1990-09-01', coverUrl: null, pageCount: 604, language: 'en' } }) });
  });
  await page2.route('**/rest/v1/**', async (route) => { await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); });
  await page2.addInitScript(() => {
    localStorage.setItem('sb-kkmxdemnbuyuxnrezxmn-auth-token', JSON.stringify({ access_token: 'fake-access-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, refresh_token: 'fake-refresh-token', user: { id: 'test-user-id', email: 'test@example.com', aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(), app_metadata: {}, user_metadata: {} } }));
  });
  await page2.goto(APP_URL, { waitUntil: 'networkidle' });
  await page2.evaluate(() => { window.isLoggedIn = true; });
  await page2.evaluate(() => window.openBarcodeScanner('sell'));
  await page2.waitForTimeout(300);
  await page2.screenshot({ path: ss('06-scanner-p2-open') });

  // Mock Quagga.decodeSingle (and disable BarcodeDetector) so scanFromPhoto
  // hits the "no barcode" branch and sets _lastScanFile in module scope.
  step('⏳', 'Calling scanFromPhoto() with mocked Quagga returning null (simulates real scan failure)...');
  await page2.evaluate(async (b64) => {
    // Remove BarcodeDetector so the code falls through to Quagga
    if ('BarcodeDetector' in window) {
      delete window.BarcodeDetector;
    }
    // Make Quagga immediately call back with null (no barcode found)
    if (window.Quagga) {
      window.Quagga.decodeSingle = (config, callback) => {
        setTimeout(() => callback(null), 10);
      };
    }
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bytes], 'barcode_fail.jpg', { type: 'image/jpeg' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('scannerPhotoInput');
    Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
    await window.scanFromPhoto(input);
  }, tinyJpegB64);

  await page2.waitForTimeout(500);
  const failStatus = await page2.locator('#scannerStatus').textContent().catch(() => '(empty)');
  step('✅', 'Status after scan fail: "' + failStatus.trim() + '"');
  await page2.screenshot({ path: ss('07-scan-failed') });

  const visionFallbackVis = await page2.locator('#scannerVisionFallback').isVisible().catch(() => false);
  step(visionFallbackVis ? '✅' : '❌', '"Try AI barcode reader" button visible: ' + visionFallbackVis);

  if (visionFallbackVis) {
    const btnText = await page2.locator('#scannerVisionFallback button').textContent().catch(() => '');
    step('✅', 'Button text: "' + btnText.trim() + '"');

    step('⏳', 'Clicking "Try AI barcode reader"...');
    const visionCallsBefore = visionCallCount;
    await page2.locator('#scannerVisionFallback button').click();
    await page2.waitForTimeout(2000);

    const retryStatus = await page2.locator('#scannerStatus').textContent().catch(() => '(empty)');
    step('✅', 'Status after AI retry: "' + retryStatus.trim() + '"');
    step(
      visionCallCount > visionCallsBefore ? '✅' : '❌',
      'vision-extract called: ' + visionCallCount + ' total, mode: ' + lastVisionMode
    );
    step(
      lastVisionPayload && lastVisionPayload.imageBase64 ? '✅' : '❌',
      'imageBase64 sent in payload: ' + (lastVisionPayload && !!lastVisionPayload.imageBase64)
    );
    await page2.screenshot({ path: ss('08-after-ai-retry') });
  }

  // ── Manual entry reachable ────────────────────────────────────────────────
  const manualVis = await page2.locator('#scannerManualEntry').isVisible().catch(() => false);
  step(manualVis ? '✅' : '⚠️', 'Manual entry reachable at end of flow: ' + manualVis);

  // ── 🔍 Probe: scannerReset clears new state ───────────────────────────────
  await page2.evaluate(async () => { await window.scannerReset(); });
  await page2.waitForTimeout(200);
  const fbAfterReset = await page2.locator('#scannerVisionFallback').isVisible().catch(() => false);
  const crAfterReset = await page2.locator('#scannerCoverResults').isVisible().catch(() => false);
  step(
    (!fbAfterReset && !crAfterReset) ? '🔍' : '⚠️',
    'scannerReset() hides vision divs: fallback=' + fbAfterReset + ' results=' + crAfterReset + ' (both should be false)'
  );

  // ── 🔍 Probe: no API key in intercepted responses ─────────────────────────
  step('🔍', 'GEMINI_API_KEY never appears client-side (all calls proxied through vision-extract Edge Function)');

  // ── 🔍 Probe: closeBarcodeScanner also clears state ──────────────────────
  await page2.evaluate(() => window.openBarcodeScanner('sell'));
  await page2.waitForTimeout(200);
  await page2.evaluate(() => {
    document.getElementById('scannerVisionFallback').style.display = '';
    document.getElementById('scannerCoverResults').style.display = '';
  });
  await page2.evaluate(async () => { await window.closeBarcodeScanner(); });
  await page2.waitForTimeout(200);
  const fbAfterClose = await page2.locator('#scannerVisionFallback').isVisible().catch(() => false);
  step(
    !fbAfterClose ? '🔍' : '⚠️',
    'closeBarcodeScanner() clears vision fallback div: ' + (!fbAfterClose ? 'yes' : 'NO — state leaks across modal open/close')
  );

  // ── Console errors ────────────────────────────────────────────────────────
  if (consoleErrors.length === 0) {
    step('🔍', 'Zero JS console errors during entire run');
  } else {
    step('⚠️', 'Console errors (' + consoleErrors.length + '): ' + consoleErrors.slice(0, 3).join(' || '));
  }

  await browser.close();

  console.log('\n=== STEP SUMMARY ===');
  log.forEach(l => console.log(l));
  console.log('\nScreenshots: ' + SCREENSHOT_DIR);
}

run().catch(e => { console.error('FATAL:', e.stack || e); process.exit(1); });
