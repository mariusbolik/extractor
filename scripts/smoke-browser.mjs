import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { chromium } from 'playwright';
import { alternativePages, platformArticles } from '../src/features/marketing/content.ts';
import { platformPageList } from '../src/features/marketing/platform-pages.ts';

const origin = (process.env.EXTRACTOR_ORIGIN || 'https://extractor.sh').replace(/\/$/, '');
const apiKey = process.env.EXTRACTOR_API_KEY?.trim() || null;
const serviceSubject = process.env.EXTRACTOR_SERVICE_SUBJECT?.trim() || null;
const allowExhaustedAnonymousQuota = process.env.EXTRACTOR_SMOKE_ALLOW_EXHAUSTED_ANONYMOUS_QUOTA === '1';
if (!apiKey) {
  throw new Error('EXTRACTOR_API_KEY is required for the authenticated production Chromium suite. The suite separately verifies one anonymous MISS/HIT without using this key.');
}
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'light',
  extraHTTPHeaders: {
    Authorization: `Bearer ${apiKey}`,
    ...(serviceSubject ? { 'X-Extractr-Service-Subject': serviceSubject } : {}),
  },
});
// Analytics ingestion rejects automated browsers with 403. Stub only that
// third-party beacon so console assertions remain about extractor.sh itself;
// the page still verifies the production script URL and site code below.
await context.route('https://api.pirsch.io/**', (route) => route.fulfill({ status: 204 }));
await context.addInitScript(() => {
  Object.defineProperty(navigator, 'modelContext', {
    configurable: true,
    value: {
      registerTool(tool) {
        globalThis.__extractorRegisteredTools ??= [];
        globalThis.__extractorRegisteredTools.push(tool);
      },
    },
  });
});
// Keep the one anonymous MISS/HIT assertion isolated from the authenticated
// context used for the broader suite so it cannot consume that context's
// account-backed requests or inherit its Bearer header.
const anonymousContext = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  colorScheme: 'light',
});
const page = await context.newPage();
const mcpClient = new Client({ name: 'extractor-production-smoke', version: '1.0.0' });
const browserErrors = [];
const platformRoutes = platformPageList.map((platform) => `/${platform.slug}/`);

page.on('pageerror', (error) => browserErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`);
});
page.on('response', (response) => {
  if (response.status() >= 400) browserErrors.push(`response: HTTP ${response.status()} ${response.url()}`);
});

async function assertNoHorizontalOverflow(label) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert.ok(
    dimensions.content <= dimensions.viewport + 1,
    `${label} has horizontal overflow: ${dimensions.content}px in ${dimensions.viewport}px`,
  );
}

function assertEntity(entity, expectedSource, expectedType) {
  assert.equal(entity.source, expectedSource);
  assert.equal(entity.type, expectedType);
  assert.equal(Object.hasOwn(entity, 'kind'), false, 'Legacy kind field is still public');
  assert.equal(Object.hasOwn(entity, 'method'), false, 'Internal extraction method leaked publicly');
  assert.equal(typeof entity.url, 'string');
  assert.ok(entity.id === null || typeof entity.id === 'string');
  assert.ok(entity.title === null || typeof entity.title === 'string');
  assert.ok(entity.author === null || typeof entity.author === 'string');
  assert.ok(entity.publishedAt === null || typeof entity.publishedAt === 'string');
  assert.equal(typeof entity.content, 'string');
  assert.ok(Array.isArray(entity.media));
  assert.equal(typeof entity.attributes, 'object');
  if (expectedType === 'feed' || expectedType === 'profile') assert.ok(Array.isArray(entity.items));
  else assert.equal(Object.hasOwn(entity, 'items'), false, `${expectedType} must not expose items`);
}

function assertIntegerPrices(entity) {
  if (entity.attributes?.price !== undefined) {
    assert.ok(Number.isInteger(entity.attributes.price) && entity.attributes.price >= 0, 'Product price is not an integer minor-unit value');
  }
  for (const variant of entity.attributes?.variants || []) {
    if (variant.price !== undefined) assert.ok(Number.isInteger(variant.price) && variant.price >= 0, 'Variant price is not an integer minor-unit value');
  }
  for (const item of entity.items || []) assertIntegerPrices(item);
}

async function selectHomepageFormat(format) {
  const input = page.locator(`input[name="format"][value="${format}"]`);
  if (await input.isChecked()) return;
  await page.locator(`input[name="format"][value="${format}"] + span`).click();
  assert.equal(await input.isChecked(), true, `Homepage ${format} format toggle did not activate`);
}

async function submitExtraction({ url, format, source, type, text }) {
  const extractMode = page.locator('[data-form-mode="extract"]');
  if (await extractMode.getAttribute('aria-pressed') !== 'true') await extractMode.click();
  await page.locator('#url').fill(url);
  await selectHomepageFormat(format);

  const responsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return responseUrl.pathname === '/api/extract'
      && responseUrl.searchParams.get('url') === url
      && responseUrl.searchParams.get('format') === format;
  });
  await page.locator('#extract-form button[type="submit"]').click({ force: true });
  const response = await responsePromise;
  assert.equal(response.status(), 200, `${source} returned HTTP ${response.status()}`);
  await page.locator('#result[data-state="success"]').waitFor({ timeout: 30_000 });

  const expectedLabel = format === 'json' ? 'JSON result' : 'Raw Markdown result';
  assert.equal(await page.locator('#result-label').textContent(), expectedLabel);
  const content = page.locator('#result-content');
  await assertNoHorizontalOverflow(`${source} ${format} preview`);
  assert.match(await content.innerText(), text, `${source} preview did not contain expected content`);
  assert.equal(await content.locator('script, iframe').count(), 0, `${source} preview contains active embed elements`);

  const rawUrl = new URL(await page.locator('#raw-result').getAttribute('href'));
  assert.equal(rawUrl.searchParams.get('url'), url);
  assert.equal(rawUrl.searchParams.get('format'), format);

  if (format === 'json') {
    assert.equal(await content.locator('pre.shiki').count(), 1, 'JSON preview is not highlighted by Shiki');
    const background = await content.locator('pre.shiki').evaluate((element) => getComputedStyle(element).backgroundColor);
    assert.equal(background, 'rgb(0, 0, 0)', 'Shiki JSON preview does not use a black background');
    const payload = JSON.parse(await content.locator('pre').innerText());
    assert.equal(payload.schemaVersion, 1);
    assertEntity(payload, source, type);
    assertIntegerPrices(payload);
  } else {
    assert.equal(await content.locator('pre').count(), 1, 'Markdown preview is not raw preformatted text');
    assert.equal(await content.locator('pre.shiki').count(), 0, 'Markdown preview should not be syntax highlighted');
    assert.equal(await content.locator('h1, h2, h3, p, ul, ol, blockquote').count(), 0, 'Markdown preview was rendered as HTML');
    assert.match(response.headers()['content-type'] || '', /^text\/markdown/i);
  }
}

async function submitSearch({ query, format }) {
  const searchMode = page.locator('[data-form-mode="search"]');
  if (await searchMode.getAttribute('aria-pressed') !== 'true') await searchMode.click();
  await page.locator('#url').fill(query);
  await selectHomepageFormat(format);

  const responsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return responseUrl.pathname === '/api/search'
      && responseUrl.searchParams.get('q') === query
      && responseUrl.searchParams.get('format') === format;
  });
  await page.locator('#extract-form button[type="submit"]').click({ force: true });
  const response = await responsePromise;
  assert.equal(response.status(), 200, `Homepage search returned HTTP ${response.status()}`);
  await page.locator('#result[data-state="success"]').waitFor({ timeout: 30_000 });

  const expectedLabel = format === 'json' ? 'JSON result' : 'Raw Markdown result';
  assert.equal(await page.locator('#result-label').textContent(), expectedLabel);
  const rawUrl = new URL(await page.locator('#raw-result').getAttribute('href'));
  assert.equal(rawUrl.pathname, '/api/search');
  assert.equal(rawUrl.searchParams.get('q'), query);
  assert.equal(rawUrl.searchParams.get('format'), format);

  const content = page.locator('#result-content');
  assert.match(await content.innerText(), /LLMBase/i, 'Homepage search preview does not contain the requested business');
  if (format === 'json') {
    const payload = JSON.parse(await content.locator('pre').innerText());
    assert.equal(payload.schemaVersion, 1);
    assertEntity(payload, 'web-search', 'feed');
    assert.equal(await content.locator('pre.shiki').count(), 1, 'Search JSON preview is not highlighted');
  } else {
    assert.equal(await content.locator('pre.shiki').count(), 0, 'Search Markdown should remain raw');
    assert.match(response.headers()['content-type'] || '', /^text\/markdown/i);
  }
  await assertNoHorizontalOverflow(`homepage search ${format} preview`);
}

async function submitNews({ query, format }) {
  const newsMode = page.locator('[data-form-mode="news"]');
  if (await newsMode.getAttribute('aria-pressed') !== 'true') await newsMode.click();
  await page.locator('#url').fill(query);
  await selectHomepageFormat(format);

  const responsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return responseUrl.pathname === '/api/news'
      && responseUrl.searchParams.get('q') === query
      && responseUrl.searchParams.get('format') === format;
  });
  await page.locator('#extract-form button[type="submit"]').click({ force: true });
  const response = await responsePromise;
  assert.equal(response.status(), 200, `Homepage news search returned HTTP ${response.status()}`);
  await page.locator('#result[data-state="success"]').waitFor({ timeout: 30_000 });

  const expectedLabel = format === 'json' ? 'JSON result' : 'Raw Markdown result';
  assert.equal(await page.locator('#result-label').textContent(), expectedLabel);
  const rawUrl = new URL(await page.locator('#raw-result').getAttribute('href'));
  assert.equal(rawUrl.pathname, '/api/news');
  assert.equal(rawUrl.searchParams.get('q'), query);
  assert.equal(rawUrl.searchParams.get('format'), format);

  const content = page.locator('#result-content');
  assert.match(await content.innerText(), /Cloudflare/i, 'Homepage news preview does not contain current coverage');
  if (format === 'json') {
    const payload = JSON.parse(await content.locator('pre').innerText());
    assert.equal(payload.schemaVersion, 1);
    assertEntity(payload, 'google-news', 'feed');
    assert.ok(payload.items.length > 0 && payload.items.length <= 10, 'Homepage news result count is invalid');
    for (const item of payload.items) assertEntity(item, 'google-news', 'article');
    assert.equal(await content.locator('pre.shiki').count(), 1, 'News JSON preview is not highlighted');
  } else {
    assert.equal(await content.locator('pre.shiki').count(), 0, 'News Markdown should remain raw');
    assert.match(response.headers()['content-type'] || '', /^text\/markdown/i);
  }
  await assertNoHorizontalOverflow(`homepage news ${format} preview`);
}

async function submitImageSearch({ query, format }) {
  const mode = page.locator('[data-form-mode="images"]');
  if (await mode.getAttribute('aria-pressed') !== 'true') await mode.click();
  await page.locator('#url').fill(query);
  await selectHomepageFormat(format);
  const responsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return responseUrl.pathname === '/api/images'
      && responseUrl.searchParams.get('q') === query
      && responseUrl.searchParams.get('format') === format;
  });
  await page.locator('#extract-form button[type="submit"]').click({ force: true });
  const response = await responsePromise;
  assert.equal(response.status(), 200, `Homepage image search returned HTTP ${response.status()}`);
  await page.locator('#result[data-state="success"]').waitFor({ timeout: 30_000 });
  const rawUrl = new URL(await page.locator('#raw-result').getAttribute('href'));
  assert.equal(rawUrl.pathname, '/api/images');
  const content = page.locator('#result-content');
  assert.match(await content.innerText(), /coral/i, 'Homepage image preview does not contain the query subject');
  if (format === 'json') {
    const payload = JSON.parse(await content.locator('pre').innerText());
    assert.equal(payload.schemaVersion, 1);
    assertEntity(payload, 'image-search', 'feed');
    assert.ok(payload.items.length > 0 && payload.items.length <= 10, 'Homepage image result count is invalid');
    for (const item of payload.items) {
      assertEntity(item, 'image-search', 'document');
      assert.equal(item.media[0]?.type, 'image');
    }
    assert.equal(await content.locator('pre.shiki').count(), 1, 'Image JSON preview is not highlighted');
  } else {
    assert.equal(await content.locator('pre.shiki').count(), 0, 'Image Markdown should remain raw');
    assert.match(response.headers()['content-type'] || '', /^text\/markdown/i);
  }
  await assertNoHorizontalOverflow(`homepage image search ${format} preview`);
}

async function submitVideoSearch({ query, format }) {
  const mode = page.locator('[data-form-mode="videos"]');
  if (await mode.getAttribute('aria-pressed') !== 'true') await mode.click();
  await page.locator('#url').fill(query);
  await selectHomepageFormat(format);
  const responsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return responseUrl.pathname === '/api/videos'
      && responseUrl.searchParams.get('q') === query
      && responseUrl.searchParams.get('format') === format;
  });
  await page.locator('#extract-form button[type="submit"]').click({ force: true });
  const response = await responsePromise;
  assert.equal(response.status(), 200, `Homepage video search returned HTTP ${response.status()}`);
  await page.locator('#result[data-state="success"]').waitFor({ timeout: 30_000 });
  const rawUrl = new URL(await page.locator('#raw-result').getAttribute('href'));
  assert.equal(rawUrl.pathname, '/api/videos');
  const content = page.locator('#result-content');
  assert.match(await content.innerText(), /Cloudflare|Workers|Taylor|Swift/i, 'Homepage video preview does not contain the query subject');
  if (format === 'json') {
    const payload = JSON.parse(await content.locator('pre').innerText());
    assert.equal(payload.schemaVersion, 1);
    assertEntity(payload, 'video-search', 'feed');
    assert.equal(payload.attributes.videoSort, 'date', 'Homepage video search did not use newest-first ordering');
    assert.ok(payload.items.length > 0 && payload.items.length <= 10, 'Homepage video result count is invalid');
    for (const item of payload.items) assertEntity(item, 'video-search', 'video');
    assert.equal(await content.locator('pre.shiki').count(), 1, 'Video JSON preview is not highlighted');
  } else {
    assert.equal(await content.locator('pre.shiki').count(), 0, 'Video Markdown should remain raw');
    assert.match(response.headers()['content-type'] || '', /^text\/markdown/i);
  }
  await assertNoHorizontalOverflow(`homepage video search ${format} preview`);
}

async function submitPlaceSearch({ query, format }) {
  const mode = page.locator('[data-form-mode="places"]');
  if (await mode.getAttribute('aria-pressed') !== 'true') await mode.click();
  await page.locator('#url').fill(query);
  await selectHomepageFormat(format);
  const responsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return responseUrl.pathname === '/api/places'
      && responseUrl.searchParams.get('q') === query
      && responseUrl.searchParams.get('format') === format;
  });
  await page.locator('#extract-form button[type="submit"]').click({ force: true });
  const response = await responsePromise;
  assert.equal(response.status(), 200, `Homepage place search returned HTTP ${response.status()}`);
  await page.locator('#result[data-state="success"]').waitFor({ timeout: 30_000 });
  const rawUrl = new URL(await page.locator('#raw-result').getAttribute('href'));
  assert.equal(rawUrl.pathname, '/api/places');
  const content = page.locator('#result-content');
  assert.match(await content.innerText(), /Brandenburg|Berlin/i, 'Homepage place preview does not contain the requested place');
  if (format === 'json') {
    const payload = JSON.parse(await content.locator('pre').innerText());
    assert.equal(payload.schemaVersion, 1);
    assertEntity(payload, 'place-search', 'feed');
    assert.equal(payload.attributes.attribution, '© OpenStreetMap contributors');
    assert.ok(payload.items.length > 0 && payload.items.length <= 5, 'Homepage place result count is invalid');
    for (const item of payload.items) {
      assertEntity(item, 'place-search', 'document');
      assert.equal(typeof item.attributes.latitude, 'number');
      assert.equal(typeof item.attributes.longitude, 'number');
    }
    assert.equal(await content.locator('pre.shiki').count(), 1, 'Place JSON preview is not highlighted');
  } else {
    assert.equal(await content.locator('pre.shiki').count(), 0, 'Place Markdown should remain raw');
    assert.match(response.headers()['content-type'] || '', /^text\/markdown/i);
  }
  await assertNoHorizontalOverflow(`homepage place search ${format} preview`);
}

async function submitFinance({ symbol, format, timeframe = '1mo', quote }) {
  const mode = page.locator('[data-form-mode="finance"]');
  if (await mode.getAttribute('aria-pressed') !== 'true') await mode.click();
  await page.locator('#url').fill(symbol);
  await page.locator('#finance-timeframe').selectOption(timeframe);
  await page.locator('#finance-quote').selectOption(quote || '');
  await selectHomepageFormat(format);
  const responsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return responseUrl.pathname === '/api/finance'
      && responseUrl.searchParams.get('symbol') === symbol
      && responseUrl.searchParams.get('timeframe') === timeframe
      && responseUrl.searchParams.get('quote') === (quote || null)
      && responseUrl.searchParams.get('format') === format;
  });
  await page.locator('#extract-form button[type="submit"]').click({ force: true });
  const response = await responsePromise;
  assert.equal(response.status(), 200, `Homepage finance request returned HTTP ${response.status()}`);
  await page.locator('#result[data-state="success"]').waitFor({ timeout: 30_000 });
  const rawUrl = new URL(await page.locator('#raw-result').getAttribute('href'));
  assert.equal(rawUrl.pathname, '/api/finance');
  assert.equal(rawUrl.searchParams.get('symbol'), symbol);
  assert.equal(rawUrl.searchParams.get('timeframe'), timeframe);
  assert.equal(rawUrl.searchParams.get('quote'), quote || null);
  const content = page.locator('#result-content');
  assert.match(await content.innerText(), /AAPL|Apple/i, 'Homepage finance preview does not contain the symbol');
  if (format === 'json') {
    const payload = JSON.parse(await content.locator('pre').innerText());
    assert.equal(payload.schemaVersion, 1);
    assertEntity(payload, 'finance', 'document');
    assert.equal(payload.attributes.tickerSymbol, 'AAPL');
    assert.equal(payload.attributes.historyTimeframe, timeframe);
    assert.equal(typeof payload.attributes.currency, 'string');
    if (quote) {
      assert.equal(payload.attributes.currency, quote);
      assert.equal(payload.attributes.quoteCurrency, quote);
      assert.equal(typeof payload.attributes.listingCurrency, 'string');
      if (payload.attributes.listingCurrency !== quote) assert.equal(typeof payload.attributes.exchangeRate, 'number');
    }
  } else {
    assert.equal(await content.locator('pre.shiki').count(), 0, 'Finance Markdown should remain raw');
    assert.match(response.headers()['content-type'] || '', /^text\/markdown/i);
  }
  await assertNoHorizontalOverflow(`homepage finance ${format} preview`);
}

try {
  const homeUrl = new URL('/', origin);
  homeUrl.searchParams.set('smoke', Date.now().toString());
  const home = await page.goto(homeUrl.toString(), { waitUntil: 'networkidle' });
  assert.equal(home?.status(), 200);
  assert.match(home?.headers()['cache-control'] || '', /no-store/, 'Homepage is cacheable');
  assert.equal(home?.headers()['cloudflare-cdn-cache-control'], undefined, 'Homepage exposes an edge-cache directive');
  assert.equal(await page.locator('main h1').first().innerText(), 'Turn web pages into\nAI-friendly context', 'Homepage hero copy is incorrect');
  assert.equal(await page.locator('head link[rel="icon"][type="image/png"][href="/favicon-96x96.png"][sizes="96x96"]').count(), 1, '96px PNG favicon link is missing');
  assert.equal(await page.locator('head link[rel="icon"][type="image/svg+xml"][href="/favicon.svg"]').count(), 1, 'SVG favicon link is missing');
  assert.equal(await page.locator('head link[rel="shortcut icon"][href="/favicon.ico"]').count(), 1, 'Shortcut favicon link is missing');
  assert.equal(await page.locator('head link[rel="apple-touch-icon"][href="/apple-touch-icon.png"][sizes="180x180"]').count(), 1, 'Apple touch icon link is missing');
  assert.equal(await page.locator('head meta[name="apple-mobile-web-app-title"][content="Extractor"]').count(), 1, 'Apple web app title is missing');
  assert.equal(await page.locator('head link[rel="manifest"][href="/site.webmanifest"]').count(), 1, 'Web app manifest link is missing');
  for (const asset of [
    '/favicon-96x96.png', '/favicon.svg', '/favicon.ico', '/apple-touch-icon.png',
    '/site.webmanifest', '/web-app-manifest-192x192.png', '/web-app-manifest-512x512.png',
  ]) {
    const response = await page.request.get(`${origin}${asset}`);
    assert.equal(response.status(), 200, `${asset} is unavailable`);
    assert.match(response.headers()['cache-control'] || '', /no-store/, `${asset} is cacheable`);
    assert.equal(response.headers()['cloudflare-cdn-cache-control'], undefined, `${asset} exposes an edge-cache directive`);
  }

  const loginResponse = await page.request.get(`${origin}/login/?smoke=${Date.now()}`);
  assert.equal(loginResponse.status(), 200, 'Locked login page is unavailable');
  assert.match(loginResponse.headers()['cache-control'] || '', /no-store/, 'Login page is cacheable');
  assert.match(loginResponse.headers()['x-robots-tag'] || '', /noindex/, 'Login page is indexable');
  const lockedLoginHtml = await loginResponse.text();
  assert.doesNotMatch(lockedLoginHtml, /<hanko-auth\b/i, 'Locked login HTML contains the Hanko component');
  assert.doesNotMatch(lockedLoginHtml, /@teamhanko|hanko-elements|auth\.extractor\.sh/i, 'Locked login HTML exposes the Hanko bundle or tenant URL');
  assert.match(lockedLoginHtml, /cf-turnstile|Sign-in is temporarily unavailable/i, 'Locked login does not show its Turnstile gate');
  assert.match(lockedLoginHtml, /<script[^>]+id="pianjs"[^>]+data-code="HtWyEgcWVShOy1wxwPv6D7V4XsX0GuKk"/i, 'Locked login omits global Pirsch analytics');

  const pricingResponse = await page.goto(`${origin}/pricing/?smoke=${Date.now()}`, { waitUntil: 'domcontentloaded' });
  assert.equal(pricingResponse?.status(), 200, 'Pricing page is unavailable');
  assert.match(pricingResponse?.headers()['cache-control'] || '', /no-store/, 'Pricing page is cacheable');
  assert.match(await page.locator('main').innerText(), /\$0\.49/i, 'Pricing is not denominated in USD');
  const pricingText = await page.locator('main').innerText();
  assert.match(pricingText, /10\s+requests \/ day/i, 'Pricing omits the anonymous daily allowance');
  assert.match(pricingText, /1,000\s+welcome credits/i, 'Pricing omits the new-account welcome bonus');
  assert.equal(await page.locator('a[href="/dashboard/"]').count() > 0, true, 'Pricing CTA does not open the dashboard');
  const pirschScript = page.locator('script#pianjs');
  assert.equal(await pirschScript.count(), 1, 'Pricing does not contain exactly one Pirsch analytics script');
  assert.equal(await pirschScript.getAttribute('src'), 'https://api.pirsch.io/pa.js', 'Pricing loads the wrong Pirsch analytics script');
  assert.equal(await pirschScript.getAttribute('data-code'), 'HtWyEgcWVShOy1wxwPv6D7V4XsX0GuKk', 'Pricing uses the wrong Pirsch site code');
  await assertNoHorizontalOverflow('desktop pricing');

  const meteredUrl = new URL('/api/extract', origin);
  meteredUrl.searchParams.set('url', `https://example.com/?meter-smoke=${Date.now()}`);
  meteredUrl.searchParams.set('format', 'json');
  const firstMetered = await anonymousContext.request.get(meteredUrl.toString());
  if (firstMetered.status() === 429 && allowExhaustedAnonymousQuota) {
    const payload = await firstMetered.json();
    assert.equal(payload.error?.code, 'daily_quota_exhausted', 'Exhausted anonymous smoke returned the wrong error code');
    assert.equal(payload.error?.message, 'The daily anonymous allowance is exhausted. Please create an account.', 'Exhausted anonymous smoke returned the wrong guidance');
    process.stderr.write('Anonymous MISS/HIT smoke skipped because this runner\'s daily production allowance is already exhausted.\n');
  } else {
    assert.equal(firstMetered.status(), 200, 'Anonymous metered miss failed');
    assert.equal(firstMetered.headers()['x-extractor-cache'], 'MISS', 'Unique anonymous request was not a cache miss');
    assert.match(firstMetered.headers()['x-extractor-free-remaining'] || '', /^\d+$/, 'Anonymous miss omitted its remaining allowance');
    const repeatedMetered = await anonymousContext.request.get(meteredUrl.toString());
    assert.equal(repeatedMetered.status(), 200, 'Repeated cache request failed');
    assert.equal(repeatedMetered.headers()['x-extractor-cache'], 'HIT', 'Repeated anonymous request was not a cache hit');
    assert.equal(repeatedMetered.headers()['x-extractor-free-remaining'], undefined, 'Cache hit leaked a metering header');
  }

  const invalidKeyUrl = new URL('/api/extract', origin);
  invalidKeyUrl.searchParams.set('url', `https://example.com/?invalid-key-smoke=${Date.now()}`);
  const invalidKey = await anonymousContext.request.get(invalidKeyUrl.toString(), { headers: { Authorization: 'Bearer ext_live_invalid_smoke_key_value' } });
  assert.equal(invalidKey.status(), 401, 'Invalid API key did not return 401 on a cache miss');

  await page.goto(homeUrl.toString(), { waitUntil: 'networkidle' });
  await page.locator('#extract-form').waitFor();
  const heroBadge = page.locator('[data-hero-badge]');
  assert.equal(await heroBadge.count(), 1, 'Hero badge is missing');
  assert.equal(await heroBadge.getByText('Free', { exact: true }).count(), 1, 'Hero badge does not show the free offer');
  assert.equal(await heroBadge.getByText('No account needed', { exact: true }).count(), 1, 'Hero badge does not explain that no account is needed');
  assert.notEqual(await heroBadge.locator('svg').evaluate((element) => getComputedStyle(element).animationName), 'none', 'Hero badge is not animated');
  const formatRadios = page.locator('input[name="format"]');
  assert.equal(await page.locator('#extract-form > div #url').count(), 1, 'Homepage primary input is missing or duplicated');
  assert.equal(await page.locator('#form-options').count(), 1, 'Homepage inline controls are missing');
  assert.equal(await page.locator('#form-options summary').count(), 0, 'Homepage controls still use an options disclosure');
  assert.equal(await page.locator('[data-form-mode]').count(), 7, 'Homepage mode controls are incomplete');
  assert.deepEqual(
    await page.locator('[data-form-mode]').allTextContents().then((labels) => labels.map((label) => label.trim())),
    ['Web Search', 'Extract', 'News', 'Images', 'Videos', 'Places', 'Finance'],
    'Homepage mode labels are incorrect',
  );
  assert.equal(await page.locator('[data-form-mode="search"]').getAttribute('aria-pressed'), 'true', 'Web Search is not selected initially');
  assert.equal(await page.locator('[data-form-mode="extract"]').getAttribute('aria-pressed'), 'false', 'Extract mode is selected initially');
  assert.equal(await page.locator('[data-form-mode="news"]').getAttribute('aria-pressed'), 'false', 'News mode is selected initially');
  assert.equal(await page.locator('[data-form-mode="images"]').getAttribute('aria-pressed'), 'false', 'Image mode is selected initially');
  assert.equal(await page.locator('[data-form-mode="videos"]').getAttribute('aria-pressed'), 'false', 'Video mode is selected initially');
  assert.equal(await page.locator('[data-form-mode="places"]').getAttribute('aria-pressed'), 'false', 'Place mode is selected initially');
  assert.equal(await page.locator('[data-form-mode="stocks"]').count(), 0, 'Stock search is still shown as a homepage mode');
  assert.equal(await page.locator('[data-form-mode="finance"]').getAttribute('aria-pressed'), 'false', 'Finance mode is selected initially');
  assert.equal(await page.locator('#url').getAttribute('placeholder'), 'the white house', 'Homepage form does not show the web-search prompt');
  assert.equal(await page.locator('#url').inputValue(), 'the white house', 'Homepage does not preload the Web Search example');
  assert.equal(await page.locator('#result').getAttribute('data-state'), 'success', 'Homepage did not automatically fetch its first example');
  const initialRawResult = new URL(await page.locator('#raw-result').getAttribute('href'));
  assert.equal(initialRawResult.pathname, '/api/search', 'Homepage initial example did not use web search');
  assert.equal(initialRawResult.searchParams.get('q'), 'the white house', 'Homepage initial search query is incorrect');
  assert.match(await page.locator('#api pre code').textContent() || '', /https:\/\/www\.amazon\.com\/dp\/B09B8V1LZ3/, 'Homepage API example does not use the verified Amazon.com product');
  assert.equal(await page.locator('input[name="format"][value="markdown"]').isChecked(), true, 'Markdown is not the default website output');
  assert.deepEqual(await formatRadios.evaluateAll((radios) => radios.map((radio) => radio.value)), ['markdown', 'json'], 'Markdown is not the first output option');
  for (const toggle of await page.locator('input[name="format"] + span').all()) {
    const borderRadius = await toggle.evaluate((element) => getComputedStyle(element).borderRadius);
    assert.equal(borderRadius, '0px', 'A format toggle is not square');
  }
  const automaticJsonResponse = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return responseUrl.pathname === '/api/search'
      && responseUrl.searchParams.get('q') === 'the white house'
      && responseUrl.searchParams.get('format') === 'json';
  });
  await selectHomepageFormat('json');
  assert.equal((await automaticJsonResponse).status(), 200, 'Format toggle did not automatically refetch JSON');
  await page.locator('#result[data-state="success"]').waitFor();
  assert.equal(await page.locator('#result-label').textContent(), 'JSON result', 'Automatic JSON preview did not render');
  const automaticSearchPayload = JSON.parse(await page.locator('#result-content pre').innerText());
  assert.equal(automaticSearchPayload.schemaVersion, 1);
  assertEntity(automaticSearchPayload, 'web-search', 'feed');
  assert.equal(automaticSearchPayload.items.length, 10, 'Homepage White House example did not return ten results');
  const automaticMarkdownResponse = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return responseUrl.pathname === '/api/search'
      && responseUrl.searchParams.get('q') === 'the white house'
      && responseUrl.searchParams.get('format') === 'markdown';
  });
  await selectHomepageFormat('markdown');
  assert.equal((await automaticMarkdownResponse).status(), 200, 'Format toggle did not automatically refetch Markdown');
  await page.locator('#result[data-state="success"]').waitFor();
  const supportedSection = page.locator('[aria-labelledby="supported-heading"]');
  const extractorCardBox = await page.locator('[aria-label="Web extraction, search, and finance"]').boundingBox();
  const supportedSectionBox = await supportedSection.boundingBox();
  assert.ok(extractorCardBox && supportedSectionBox, 'Extraction or supported-platform card geometry is unavailable');
  const modeButtonBoxes = await page.locator('[data-form-mode]').evaluateAll((buttons) => buttons.map((button) => {
    const box = button.getBoundingClientRect();
    return { x: box.x, y: box.y };
  }));
  assert.ok(modeButtonBoxes.every((box) => Math.abs(box.x - modeButtonBoxes[0].x) <= 1), 'Homepage example segments are not vertically aligned');
  assert.ok(modeButtonBoxes.every((box, index) => index === 0 || box.y > modeButtonBoxes[index - 1].y), 'Homepage example segments are not stacked on desktop');
  const examplesBox = await page.locator('[aria-label="Live API examples"]').boundingBox();
  const demoFormBox = await page.locator('#extract-form').boundingBox();
  assert.ok(examplesBox && demoFormBox && examplesBox.x < demoFormBox.x, 'Homepage examples are not positioned to the left of the live response');
  assert.ok(Math.abs(supportedSectionBox.y - (extractorCardBox.y + extractorCardBox.height) - 48) <= 1, 'Extraction and supported-platform cards do not have a 48px gap');
  const platformGrid = supportedSection.locator('#supported-platforms-grid');
  assert.equal(await page.locator('[aria-label="Web extraction, search, and finance"] > #works-with').count(), 0, 'Works with icons are still inside the extraction card');
  assert.equal(await platformGrid.locator(':scope > li').count(), platformPageList.length + 1, 'Supported platform tile grid is incomplete');
  assert.match(await platformGrid.locator(':scope > li').first().innerText(), /^Works\s+with$/, 'Works with lead tile is missing');
  assert.equal(await platformGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 9, 'Supported platforms do not use a nine-column desktop tile grid');
  assert.equal(await page.locator('.method-card').count(), platformPageList.length);
  for (const card of await page.locator('.method-card').all()) {
    assert.equal(await card.locator(':scope > svg').count(), 1, 'A platform tile does not show exactly one logo');
    assert.ok(await card.locator('[role="tooltip"] ul > li').count() > 0, 'A platform tile is missing its capability tooltip');
  }
  assert.deepEqual(
    await page.locator('.method-card[href="/amazon/"] [role="tooltip"] ul > li').allTextContents(),
    ['Product Search', 'Product Details'],
    'Amazon card capabilities are incorrect',
  );
  assert.equal(await page.locator('footer a[href="/alternatives/"]').count(), 1, 'Alternatives footer link is missing');
  assert.equal(await page.locator('footer a[href="/blog/"]').count(), 1, 'Blog footer link is missing');
  assert.equal(await page.locator('footer a[href="/privacy/"]').count(), 1, 'Privacy footer link is missing');
  assert.equal(await page.locator('footer a[href="/legal/"]').count(), 1, 'Legal Notice footer link is missing');
  assert.equal(await page.locator('footer a[href="/terms/"]').count(), 1, 'Terms footer link is missing');
  assert.equal((await page.locator('footer > span').textContent())?.trim(), '© extractor.sh', 'Footer copyright label is incorrect');
  assert.equal(await page.locator('footer a[href="https://dlvr.sh"]').count(), 0, 'dlvr.sh is still in the footer');
  assert.deepEqual(
    await page.locator('header nav a').allTextContents(),
    ['Docs', 'Pricing', 'Contact', 'Dashboard'],
    'Dashboard is not the final header navigation item',
  );
  const dashboardNavigation = page.locator('header nav a[href="/dashboard/"]');
  assert.equal(await dashboardNavigation.evaluate((element) => getComputedStyle(element).borderRightWidth), '4px', 'Dashboard navigation is not styled as a button');
  const dlvrBanner = page.locator('main > [data-dlvr-banner]');
  assert.equal(await dlvrBanner.count(), 1, 'dlvr.sh homepage banner is missing');
  assert.equal(await dlvrBanner.getAttribute('href'), 'https://dlvr.sh', 'dlvr.sh homepage banner has the wrong URL');
  assert.equal(await dlvrBanner.getAttribute('target'), '_blank', 'dlvr.sh homepage banner is not marked as external');
  assert.equal(await dlvrBanner.locator('svg').count(), 1, 'dlvr.sh homepage banner external-link icon is missing');
  assert.equal(await dlvrBanner.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(0, 0, 0)', 'dlvr.sh homepage banner is not black');
  assert.equal(await dlvrBanner.evaluate((element) => getComputedStyle(element).color), 'rgb(255, 255, 255)', 'dlvr.sh homepage banner text is not white');
  assert.equal(await page.locator('a[href="/docs/mcp/"]').count() > 0, true, 'Hosted MCP documentation link is missing');
  assert.equal(await page.locator('#api a[href="/docs/news/"]').count(), 1, 'Homepage does not link to the news API documentation');
  assert.equal(await page.locator('#api a[href="/docs/images/"]').count(), 1, 'Homepage does not link to the image API documentation');
  assert.equal(await page.locator('#api a[href="/docs/videos/"]').count(), 1, 'Homepage does not link to the video API documentation');
  assert.equal(await page.locator('#api a[href="/docs/places/"]').count(), 1, 'Homepage does not link to the place API documentation');
  assert.equal(await page.locator('#api a[href="/docs/finance/"]').count(), 1, 'Homepage does not link to the finance API documentation');
  assert.equal(await page.locator('#mcp pre code').textContent(), 'https://extractor.sh/mcp');
  const browserTools = await page.evaluate(() => (globalThis.__extractorRegisteredTools || []).map((tool) => ({
    name: tool.name,
    properties: Object.keys(tool.inputSchema?.properties || {}),
  })));
  assert.deepEqual(browserTools.map((tool) => tool.name), [
    'extract_public_url', 'search_web', 'search_images', 'search_videos', 'search_places',
    'search_news', 'search_stocks', 'get_market_movers', 'get_market_data',
  ], 'Homepage browser-native AI tools are incomplete');
  assert.equal(browserTools.find((tool) => tool.name === 'search_web')?.properties.includes('site'), true, 'Browser-native web search omits site');
  assert.equal(browserTools.find((tool) => tool.name === 'search_videos')?.properties.includes('creator'), true, 'Browser-native video search omits creator');
  assert.equal(browserTools.find((tool) => tool.name === 'get_market_data')?.properties.includes('quote'), true, 'Browser-native finance omits quote currency');
  const [supportedCardBox, apiCardBox, mcpCardBox, dlvrBannerBox] = await Promise.all([
    supportedSection.boundingBox(),
    page.locator('#api').boundingBox(),
    page.locator('#mcp').boundingBox(),
    dlvrBanner.boundingBox(),
  ]);
  assert.ok(apiCardBox && mcpCardBox && Math.abs(apiCardBox.y - mcpCardBox.y) <= 1 && mcpCardBox.x > apiCardBox.x, 'API and MCP cards are not side by side on desktop');
  assert.ok(supportedCardBox && apiCardBox && dlvrBannerBox, 'Homepage card geometry is unavailable');
  assert.ok(Math.abs(apiCardBox.y - (supportedCardBox.y + supportedCardBox.height) - 32) <= 1, 'Supported platforms and API/MCP cards do not have a 32px gap');
  assert.ok(Math.abs(dlvrBannerBox.y - (apiCardBox.y + apiCardBox.height) - 32) <= 1, 'API/MCP cards and dlvr.sh banner do not have a 32px gap');
  for (const card of await page.locator('.method-card').all()) assert.equal(await card.locator('svg').count(), 1, 'A platform tile contains more than its logo');
  const amazonIcon = page.locator('.method-card[href="/amazon/"] svg').first();
  assert.equal(await amazonIcon.getAttribute('data-brand-icon'), 'amazon', 'Amazon card does not use its inline SVG brand logo');
  assert.deepEqual(await amazonIcon.locator('path').evaluateAll((paths) => paths.map((path) => path.getAttribute('fill'))), ['#f90', '#000'], 'Amazon logo does not use its black and orange artwork');
  assert.equal(await amazonIcon.locator('path[fill="#000"]').getAttribute('fill-rule'), 'evenodd', 'Amazon logo counter is not transparent');
  const instagramIcon = page.locator('.method-card[href="/instagram/"] svg').first();
  assert.equal(await instagramIcon.getAttribute('data-brand-icon'), 'instagram', 'Instagram card does not use its inline SVG brand logo');
  assert.equal(await instagramIcon.locator('defs stop').count(), 3, 'Instagram logo gradient is missing');
  const yahooIcon = page.locator('.method-card[href="/yahoo-finance/"] svg').first();
  assert.equal(await yahooIcon.getAttribute('data-brand-icon'), 'yahoo', 'Yahoo Finance card does not use its inline SVG brand logo');
  assert.equal(await yahooIcon.getAttribute('viewBox'), '1.5 2.5 21 19', 'Yahoo Finance logo does not use its optically cropped viewBox');
  assert.equal(await yahooIcon.locator('path').getAttribute('fill'), '#5f01d1', 'Yahoo Finance logo does not use the requested purple');
  const wooCommerceIcon = page.locator('.method-card[href="/woocommerce/"] svg').first();
  assert.equal(await wooCommerceIcon.getAttribute('data-brand-icon'), 'woocommerce', 'WooCommerce card does not use its inline SVG brand logo');
  assert.equal(await wooCommerceIcon.locator('path').first().getAttribute('fill'), '#7f54b3', 'WooCommerce logo does not use the requested purple');
  await assertNoHorizontalOverflow('desktop homepage');

  // The same single field must exercise both new search representations from
  // the visible homepage UI, not only through request-level API checks.
  await page.locator('[data-form-mode="search"]').click();
  assert.equal(await page.locator('#url').getAttribute('name'), 'q');
  assert.equal(await page.locator('#url').getAttribute('type'), 'text');
  assert.equal(await page.locator('#url').getAttribute('maxlength'), '200');
  assert.equal(await page.locator('#form-input-label').textContent(), 'Search query');
  assert.equal((await page.locator('#extract-form button[type="submit"]').textContent())?.trim(), 'Search');
  assert.equal(await page.locator('#url').evaluate((element) => getComputedStyle(element).outlineStyle), 'none', 'Active homepage input still shows an outline');
  assert.equal(await page.locator('[data-options-mode="search news videos"]').isVisible(), true, 'Search locale controls are hidden');
  await page.locator('#search-locale').selectOption('en-GB|GB');
  await page.locator('#search-site').fill('llmbase.ai');
  await submitSearch({ query: 'llmbase', format: 'json' });
  assert.match(await page.locator('#raw-result').getAttribute('href') || '', /language=en-GB.*country=GB|country=GB.*language=en-GB/, 'Homepage search did not forward its locale preset');
  assert.match(await page.locator('#raw-result').getAttribute('href') || '', /site=llmbase\.ai/, 'Homepage search did not forward its hostname restriction');
  await submitSearch({ query: 'llmbase', format: 'markdown' });
  await page.locator('[data-form-mode="news"]').click();
  assert.equal(await page.locator('#url').getAttribute('name'), 'q');
  assert.equal(await page.locator('#url').getAttribute('type'), 'text');
  assert.equal(await page.locator('#url').getAttribute('maxlength'), '200');
  assert.equal(await page.locator('#form-input-label').textContent(), 'News query');
  assert.equal((await page.locator('#extract-form button[type="submit"]').textContent())?.trim(), 'Search news');
  await page.locator('#news-timeframe').selectOption('30d');
  await submitNews({ query: 'Cloudflare', format: 'json' });
  assert.match(await page.locator('#raw-result').getAttribute('href') || '', /timeframe=30d/, 'Homepage news did not forward its timeframe');
  await submitNews({ query: 'Cloudflare', format: 'markdown' });
  await page.locator('[data-form-mode="images"]').click();
  assert.equal(await page.locator('#form-input-label').textContent(), 'Image query');
  assert.equal((await page.locator('#extract-form button[type="submit"]').textContent())?.trim(), 'Search images');
  await page.locator('#image-usage').selectOption('commercial');
  await page.locator('#image-orientation').selectOption('landscape');
  await submitImageSearch({ query: 'coral reef', format: 'json' });
  assert.match(await page.locator('#raw-result').getAttribute('href') || '', /usage=commercial/, 'Homepage image search did not forward usage rights');
  assert.match(await page.locator('#raw-result').getAttribute('href') || '', /orientation=landscape/, 'Homepage image search did not forward orientation');
  await submitImageSearch({ query: 'coral reef', format: 'markdown' });
  await page.locator('[data-form-mode="videos"]').click();
  assert.equal(await page.locator('#form-input-label').textContent(), 'Video query');
  assert.equal((await page.locator('#extract-form button[type="submit"]').textContent())?.trim(), 'Search videos');
  await page.locator('#search-locale').selectOption('en-US|US');
  await page.locator('#video-platform').selectOption('youtube');
  await page.locator('#video-sort').selectOption('date');
  await page.locator('#video-creator').fill('Taylor Swift');
  await submitVideoSearch({ query: 'Taylor Swift', format: 'json' });
  assert.match(await page.locator('#raw-result').getAttribute('href') || '', /platform=youtube/, 'Homepage video search did not forward its YouTube filter');
  assert.match(await page.locator('#raw-result').getAttribute('href') || '', /sort=date/, 'Homepage video search did not forward newest-first ordering');
  assert.match(await page.locator('#raw-result').getAttribute('href') || '', /creator=Taylor(?:\+|%20)Swift/, 'Homepage video search did not forward its creator constraint');
  await submitVideoSearch({ query: 'Taylor Swift', format: 'markdown' });
  await page.locator('[data-form-mode="places"]').click();
  assert.equal(await page.locator('#form-input-label').textContent(), 'Place or address');
  assert.equal((await page.locator('#extract-form button[type="submit"]').textContent())?.trim(), 'Search places');
  await page.locator('[data-options-mode="places"] input[name="language"]').fill('de');
  await page.locator('[data-options-mode="places"] input[name="country"]').fill('DE');
  await page.locator('[data-options-mode="places"] input[name="lat"]').fill('52.52');
  await page.locator('[data-options-mode="places"] input[name="lon"]').fill('13.405');
  await submitPlaceSearch({ query: 'Brandenburg Gate Berlin', format: 'json' });
  assert.match(await page.locator('#raw-result').getAttribute('href') || '', /country=DE/, 'Homepage place search did not forward its country filter');
  assert.match(await page.locator('#raw-result').getAttribute('href') || '', /lat=52.52/, 'Homepage place search did not forward nearby coordinates');
  await submitPlaceSearch({ query: 'Brandenburg Gate Berlin', format: 'markdown' });
  await page.locator('[data-form-mode="finance"]').click();
  assert.equal(await page.locator('#form-input-label').textContent(), 'Market symbol');
  assert.equal((await page.locator('#extract-form button[type="submit"]').textContent())?.trim(), 'Get market data');
  await submitFinance({ symbol: 'AAPL', format: 'json', timeframe: '5d', quote: 'EUR' });
  await submitFinance({ symbol: 'AAPL', format: 'markdown', timeframe: '1mo' });
  await page.locator('[data-form-mode="extract"]').click();
  assert.equal(await page.locator('[data-options-mode="extract"]').isVisible(), true, 'Extract focus control is hidden');
  await page.locator('#extract-focus').fill('example');
  await submitExtraction({
    url: 'https://example.com/',
    format: 'json',
    source: 'web',
    type: 'article',
    text: /Example Domain/i,
  });
  assert.match(await page.locator('#raw-result').getAttribute('href') || '', /focus=example/, 'Homepage extraction did not forward focus');
  await page.locator('#extract-focus').fill('');
  assert.equal(await page.locator('#url').getAttribute('name'), 'url');
  assert.equal(await page.locator('#url').getAttribute('type'), 'url');
  assert.equal(await page.locator('#url').getAttribute('maxlength'), '2048');

  // Discovery metadata can still exist in a pre-deployment CDN object while
  // its previous one-hour TTL drains. A unique query validates the asset from
  // this deployment; the route now requires revalidation for future updates.
  const serverCardResponse = await page.request.get(`${origin}/.well-known/mcp/server-card.json?smoke=${Date.now()}`);
  assert.equal(serverCardResponse.status(), 200, 'MCP Server Card is unavailable');
  const serverCard = await serverCardResponse.json();
  assert.equal(serverCard.serverInfo?.name, 'extractor.sh');
  assert.equal(serverCard.serverInfo?.version, '1.9.0');
  assert.equal(serverCard.transport?.endpoint, `${origin}/mcp`);
  assert.equal(serverCard.capabilities?.tools, true);
  assert.equal(serverCard.capabilities?.resources, true);
  assert.equal(serverCard.resources?.some((resource) => resource.uri === 'ui://extractor.sh/finance/price-chart-v1.html'), true);
  assert.deepEqual(serverCard.tools?.map((tool) => tool.name), ['extract_public_url', 'search_web', 'search_images', 'search_videos', 'search_places', 'search_news', 'search_stocks', 'get_market_movers', 'get_market_data']);

  const catalogResponse = await page.request.get(`${origin}/.well-known/api-catalog`);
  assert.equal(catalogResponse.status(), 200, 'API catalog is unavailable');
  const catalog = await catalogResponse.json();
  assert.equal(
    catalog.linkset?.[0]?.item?.some((item) => item.href === `${origin}/api/news`),
    true,
    'API catalog does not advertise the news endpoint',
  );
  assert.equal(catalog.linkset?.[0]?.item?.some((item) => item.href === `${origin}/api/images`), true, 'API catalog does not advertise the image endpoint');
  assert.equal(catalog.linkset?.[0]?.item?.some((item) => item.href === `${origin}/api/videos`), true, 'API catalog does not advertise the video endpoint');
  assert.equal(catalog.linkset?.[0]?.item?.some((item) => item.href === `${origin}/api/places`), true, 'API catalog does not advertise the place endpoint');
  assert.equal(catalog.linkset?.[0]?.item?.some((item) => item.href === `${origin}/api/maps`), false, 'API catalog still advertises the deprecated maps alias');
  assert.equal(catalog.linkset?.[0]?.item?.some((item) => item.href === `${origin}/api/finance`), true, 'API catalog does not advertise the finance endpoint');
  assert.equal(catalog.linkset?.[0]?.item?.some((item) => item.href === `${origin}/api/finance/search`), true, 'API catalog does not advertise stock search');
  assert.equal(catalog.linkset?.[0]?.item?.some((item) => item.href === `${origin}/api/finance/movers`), true, 'API catalog does not advertise market movers');
  const openApiResponse = await page.request.get(`${origin}/openapi.json`);
  assert.equal(openApiResponse.status(), 200, 'OpenAPI document is unavailable');
  const openApi = await openApiResponse.json();
  assert.equal(openApi.paths?.['/api/news']?.get?.operationId, 'searchNews', 'OpenAPI does not describe the news endpoint');
  assert.equal(openApi.paths?.['/api/images']?.get?.operationId, 'searchImages', 'OpenAPI does not describe the image endpoint');
  assert.equal(openApi.paths?.['/api/videos']?.get?.operationId, 'searchVideos', 'OpenAPI does not describe the video endpoint');
  assert.equal(openApi.paths?.['/api/places']?.get?.operationId, 'searchPlaces', 'OpenAPI does not describe the place endpoint');
  assert.equal(openApi.paths?.['/api/maps'], undefined, 'OpenAPI still advertises the deprecated maps alias');
  assert.equal(openApi.paths?.['/api/finance']?.get?.operationId, 'getMarketData', 'OpenAPI does not describe the finance endpoint');
  assert.equal(openApi.paths?.['/api/finance/search']?.get?.operationId, 'searchFinanceInstruments', 'OpenAPI does not describe finance instrument search');
  assert.equal(openApi.paths?.['/api/finance/movers']?.get?.operationId, 'getMarketMovers', 'OpenAPI does not describe market movers');

  // Exercise both public representations before MCP. The repeated identical
  // JSON GET proves the new route participates in the Worker cache rather than
  // charging every agent for the same query.
  const searchJsonUrl = new URL('/api/search', origin);
  // Use a broad, durable documentation query here. Very small domains can
  // legitimately disappear from an index and turn the browser smoke into an
  // upstream-indexing check rather than a product regression check.
  searchJsonUrl.searchParams.set('q', 'Cloudflare Workers');
  searchJsonUrl.searchParams.set('limit', '3');
  searchJsonUrl.searchParams.set('format', 'json');
  searchJsonUrl.searchParams.set('language', 'en-US');
  searchJsonUrl.searchParams.set('country', 'US');
  searchJsonUrl.searchParams.set('site', 'cloudflare.com');
  const searchMiss = await page.request.get(searchJsonUrl.toString());
  assert.equal(searchMiss.status(), 200, `Web search returned HTTP ${searchMiss.status()}`);
  const searchPayload = await searchMiss.json();
  assert.equal(searchPayload.schemaVersion, 1);
  assertEntity(searchPayload, 'web-search', 'feed');
  assert.equal(searchPayload.attributes.language, 'en-US');
  assert.equal(searchPayload.attributes.country, 'US');
  assert.equal(searchPayload.attributes.site, 'cloudflare.com');
  assert.ok(searchPayload.items.length > 0 && searchPayload.items.length <= 3, 'Web search result count is outside the requested limit');
  assert.equal(searchPayload.items.every((item) => {
    const hostname = new URL(item.url).hostname;
    return hostname === 'cloudflare.com' || hostname.endsWith('.cloudflare.com');
  }), true, 'Hostname-restricted web search returned another site');
  for (const item of searchPayload.items) assertEntity(item, 'web-search', 'document');
  assert.ok(searchPayload.items.every((item) => {
    const text = `${item.title ?? ''} ${item.url} ${item.content}`;
    return /cloudflare/i.test(text) && /workers/i.test(text);
  }), 'Web search returned an unrelated result for Cloudflare Workers');
  assert.equal(searchPayload.items.some((item) => /cloudflare\.com/i.test(item.url)), true, 'Web search did not find Cloudflare documentation');
  let searchCacheStatus = '';
  for (let attempt = 0; attempt < 5 && searchCacheStatus !== 'HIT'; attempt += 1) {
    await page.waitForTimeout(200);
    const repeated = await page.request.get(searchJsonUrl.toString());
    assert.equal(repeated.status(), 200);
    searchCacheStatus = repeated.headers()['x-extractor-cache'] || '';
  }
  assert.equal(searchCacheStatus, 'HIT', 'Repeated web search was not served from the Worker cache');

  const searchMarkdownUrl = new URL(searchJsonUrl);
  searchMarkdownUrl.searchParams.set('format', 'markdown');
  const searchMarkdown = await page.request.get(searchMarkdownUrl.toString());
  assert.equal(searchMarkdown.status(), 200);
  assert.match(searchMarkdown.headers()['content-type'] || '', /^text\/markdown/i);
  assert.match(await searchMarkdown.text(), /^# Search results for Cloudflare Workers/m);

  const newsJsonUrl = new URL('/api/news', origin);
  newsJsonUrl.searchParams.set('q', 'Cloudflare');
  newsJsonUrl.searchParams.set('limit', '3');
  newsJsonUrl.searchParams.set('format', 'json');
  newsJsonUrl.searchParams.set('language', 'en-US');
  newsJsonUrl.searchParams.set('country', 'US');
  newsJsonUrl.searchParams.set('timeframe', '30d');
  const newsMiss = await page.request.get(newsJsonUrl.toString());
  assert.equal(newsMiss.status(), 200, `News search returned HTTP ${newsMiss.status()}`);
  const newsPayload = await newsMiss.json();
  assert.equal(newsPayload.schemaVersion, 1);
  assertEntity(newsPayload, 'google-news', 'feed');
  assert.equal(newsPayload.attributes.feedType, 'news-search');
  assert.equal(newsPayload.attributes.query, 'Cloudflare');
  assert.equal(newsPayload.attributes.timeframe, '30d');
  assert.ok(newsPayload.items.length > 0 && newsPayload.items.length <= 3, 'News result count is outside the requested limit');
  for (const item of newsPayload.items) assertEntity(item, 'google-news', 'article');
  let newsCacheStatus = '';
  for (let attempt = 0; attempt < 5 && newsCacheStatus !== 'HIT'; attempt += 1) {
    await page.waitForTimeout(200);
    const repeated = await page.request.get(newsJsonUrl.toString());
    assert.equal(repeated.status(), 200);
    newsCacheStatus = repeated.headers()['x-extractor-cache'] || '';
  }
  assert.equal(newsCacheStatus, 'HIT', 'Repeated news search was not served from the Worker cache');

  const newsMarkdownUrl = new URL(newsJsonUrl);
  newsMarkdownUrl.searchParams.set('format', 'markdown');
  const newsMarkdown = await page.request.get(newsMarkdownUrl.toString());
  assert.equal(newsMarkdown.status(), 200);
  assert.match(newsMarkdown.headers()['content-type'] || '', /^text\/markdown/i);
  assert.match(await newsMarkdown.text(), /^# News results for Cloudflare/m);

  const imageJsonUrl = new URL('/api/images', origin);
  imageJsonUrl.searchParams.set('q', 'coral reef');
  imageJsonUrl.searchParams.set('limit', '3');
  imageJsonUrl.searchParams.set('format', 'json');
  imageJsonUrl.searchParams.set('usage', 'commercial');
  imageJsonUrl.searchParams.set('orientation', 'landscape');
  const imageResponse = await page.request.get(imageJsonUrl.toString());
  assert.equal(imageResponse.status(), 200, `Image search returned HTTP ${imageResponse.status()}`);
  const imagePayload = await imageResponse.json();
  assert.equal(imagePayload.schemaVersion, 1);
  assertEntity(imagePayload, 'image-search', 'feed');
  assert.equal(imagePayload.attributes.usage, 'commercial');
  assert.equal(imagePayload.attributes.orientation, 'landscape');
  assert.ok(imagePayload.items.length > 0 && imagePayload.items.length <= 3, 'Image result count is outside the requested limit');
  for (const item of imagePayload.items) {
    assertEntity(item, 'image-search', 'document');
    assert.equal(item.media[0]?.type, 'image');
  }
  let imageCacheStatus = '';
  for (let attempt = 0; attempt < 5 && imageCacheStatus !== 'HIT'; attempt += 1) {
    await page.waitForTimeout(200);
    const repeated = await page.request.get(imageJsonUrl.toString());
    assert.equal(repeated.status(), 200);
    imageCacheStatus = repeated.headers()['x-extractor-cache'] || '';
  }
  assert.equal(imageCacheStatus, 'HIT', 'Repeated image search was not served from the Worker cache');
  const imageMarkdownUrl = new URL(imageJsonUrl);
  imageMarkdownUrl.searchParams.set('format', 'markdown');
  const imageMarkdown = await page.request.get(imageMarkdownUrl.toString());
  assert.equal(imageMarkdown.status(), 200);
  assert.match(imageMarkdown.headers()['content-type'] || '', /^text\/markdown/i);
  assert.match(await imageMarkdown.text(), /^# Image results for coral reef/m);

  const videoJsonUrl = new URL('/api/videos', origin);
  videoJsonUrl.searchParams.set('q', 'Taylor Swift');
  videoJsonUrl.searchParams.set('limit', '3');
  videoJsonUrl.searchParams.set('format', 'json');
  videoJsonUrl.searchParams.set('language', 'en-US');
  videoJsonUrl.searchParams.set('country', 'US');
  videoJsonUrl.searchParams.set('platform', 'youtube');
  videoJsonUrl.searchParams.set('sort', 'date');
  videoJsonUrl.searchParams.set('creator', 'Taylor Swift');
  const videoResponse = await page.request.get(videoJsonUrl.toString());
  assert.equal(videoResponse.status(), 200, `Video search returned HTTP ${videoResponse.status()}`);
  const videoPayload = await videoResponse.json();
  assert.equal(videoPayload.schemaVersion, 1);
  assertEntity(videoPayload, 'video-search', 'feed');
  assert.equal(videoPayload.attributes.language, 'en-US');
  assert.equal(videoPayload.attributes.country, 'US');
  assert.equal(videoPayload.attributes.videoPlatform, 'youtube');
  assert.equal(videoPayload.attributes.videoSort, 'date');
  assert.equal(videoPayload.attributes.videoCreator, 'Taylor Swift');
  assert.ok(videoPayload.items.length > 0 && videoPayload.items.length <= 3, 'Video result count is outside the requested limit');
  for (const item of videoPayload.items) {
    assertEntity(item, 'video-search', 'video');
    assert.match(new URL(item.url).hostname, /(?:^|\.)youtube\.com$|^youtu\.be$/);
    assert.equal(item.author, 'Taylor Swift');
  }
  assert.equal(typeof videoPayload.items[0]?.attributes?.publishedAtDisplay, 'string', 'Newest video result has no displayed upload time');
  let videoCacheStatus = '';
  for (let attempt = 0; attempt < 5 && videoCacheStatus !== 'HIT'; attempt += 1) {
    await page.waitForTimeout(200);
    const repeated = await page.request.get(videoJsonUrl.toString());
    assert.equal(repeated.status(), 200);
    videoCacheStatus = repeated.headers()['x-extractor-cache'] || '';
  }
  assert.equal(videoCacheStatus, 'HIT', 'Repeated video search was not served from the Worker cache');
  const videoMarkdownUrl = new URL(videoJsonUrl);
  videoMarkdownUrl.searchParams.set('format', 'markdown');
  let videoMarkdown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    videoMarkdown = await page.request.get(videoMarkdownUrl.toString());
    if (videoMarkdown.status() === 200) break;
    await page.waitForTimeout(200);
  }
  assert.ok(videoMarkdown, 'Video Markdown request did not run');
  assert.equal(videoMarkdown.status(), 200);
  assert.match(videoMarkdown.headers()['content-type'] || '', /^text\/markdown/i);
  assert.match(await videoMarkdown.text(), /^# Video results for Taylor Swift/m);

  const placeJsonUrl = new URL('/api/places', origin);
  placeJsonUrl.searchParams.set('q', 'Brandenburg Gate Berlin');
  placeJsonUrl.searchParams.set('limit', '3');
  placeJsonUrl.searchParams.set('format', 'json');
  placeJsonUrl.searchParams.set('language', 'de');
  placeJsonUrl.searchParams.set('country', 'DE');
  placeJsonUrl.searchParams.set('lat', '52.52');
  placeJsonUrl.searchParams.set('lon', '13.405');
  const placeResponse = await page.request.get(placeJsonUrl.toString());
  assert.equal(placeResponse.status(), 200, `Place search returned HTTP ${placeResponse.status()}`);
  const placePayload = await placeResponse.json();
  assert.equal(placePayload.schemaVersion, 1);
  assertEntity(placePayload, 'place-search', 'feed');
  assert.equal(placePayload.attributes.attribution, '© OpenStreetMap contributors');
  assert.equal(placePayload.attributes.language, 'de');
  assert.equal(placePayload.attributes.country, 'DE');
  assert.ok(placePayload.items.length > 0 && placePayload.items.length <= 3, 'Place result count is outside the requested limit');
  for (const item of placePayload.items) {
    assertEntity(item, 'place-search', 'document');
    assert.equal(typeof item.attributes.latitude, 'number');
    assert.equal(typeof item.attributes.longitude, 'number');
  }
  let placeCacheStatus = '';
  for (let attempt = 0; attempt < 5 && placeCacheStatus !== 'HIT'; attempt += 1) {
    await page.waitForTimeout(200);
    const repeated = await page.request.get(placeJsonUrl.toString());
    assert.equal(repeated.status(), 200);
    placeCacheStatus = repeated.headers()['x-extractor-cache'] || '';
  }
  assert.equal(placeCacheStatus, 'HIT', 'Repeated place search was not served from the Worker cache');
  const placeMarkdownUrl = new URL(placeJsonUrl);
  placeMarkdownUrl.searchParams.set('format', 'markdown');
  const placeMarkdown = await page.request.get(placeMarkdownUrl.toString());
  assert.equal(placeMarkdown.status(), 200);
  assert.match(placeMarkdown.headers()['content-type'] || '', /^text\/markdown/i);
  assert.match(await placeMarkdown.text(), /^# Place results for Brandenburg Gate Berlin/m);

  // The deprecated alias must reuse the already-warm canonical Places entry,
  // return the canonical represented URL, and perform no duplicate search.
  const mapAliasUrl = new URL(placeJsonUrl);
  mapAliasUrl.pathname = '/api/maps';
  const mapAliasResponse = await page.request.get(mapAliasUrl.toString());
  assert.equal(mapAliasResponse.status(), 200, `Deprecated maps alias returned HTTP ${mapAliasResponse.status()}`);
  assert.equal(mapAliasResponse.headers()['x-extractor-cache'], 'HIT', 'Deprecated maps alias did not share the Places cache entry');
  const mapAliasPayload = await mapAliasResponse.json();
  assertEntity(mapAliasPayload, 'place-search', 'feed');
  assert.equal(new URL(mapAliasPayload.url).pathname, '/api/places');

  const stockSearchUrl = new URL('/api/finance/search', origin);
  stockSearchUrl.searchParams.set('q', 'Apple');
  stockSearchUrl.searchParams.set('limit', '5');
  stockSearchUrl.searchParams.set('format', 'json');
  const stockSearchResponse = await page.request.get(stockSearchUrl.toString());
  assert.equal(stockSearchResponse.status(), 200, `Stock search returned HTTP ${stockSearchResponse.status()}`);
  const stockSearchPayload = await stockSearchResponse.json();
  assertEntity(stockSearchPayload, 'finance', 'feed');
  assert.ok(stockSearchPayload.items.some((item) => item.attributes.tickerSymbol === 'AAPL'), 'Stock search did not return AAPL');
  let stockCacheStatus = '';
  for (let attempt = 0; attempt < 5 && stockCacheStatus !== 'HIT'; attempt += 1) {
    await page.waitForTimeout(200);
    const repeated = await page.request.get(stockSearchUrl.toString());
    assert.equal(repeated.status(), 200);
    stockCacheStatus = repeated.headers()['x-extractor-cache'] || '';
  }
  assert.equal(stockCacheStatus, 'HIT', 'Repeated stock search was not served from the Worker cache');

  const moversJsonUrl = new URL('/api/finance/movers', origin);
  moversJsonUrl.searchParams.set('list', 'gainers');
  moversJsonUrl.searchParams.set('limit', '3');
  moversJsonUrl.searchParams.set('format', 'json');
  const moversResponse = await page.request.get(moversJsonUrl.toString());
  assert.equal(moversResponse.status(), 200, `Market movers returned HTTP ${moversResponse.status()}`);
  const moversPayload = await moversResponse.json();
  assertEntity(moversPayload, 'finance', 'feed');
  assert.equal(moversPayload.attributes.feedType, 'market-movers');
  assert.equal(moversPayload.attributes.financeMoverList, 'gainers');
  assert.ok(moversPayload.items.length > 0 && moversPayload.items.length <= 3, 'Market mover count is outside the requested limit');
  for (const item of moversPayload.items) {
    assertEntity(item, 'finance', 'document');
    assert.equal(typeof item.attributes.tickerSymbol, 'string');
    assert.equal(typeof item.attributes.changePercent, 'number');
  }
  let moversCacheStatus = '';
  for (let attempt = 0; attempt < 5 && moversCacheStatus !== 'HIT'; attempt += 1) {
    await page.waitForTimeout(200);
    const repeated = await page.request.get(moversJsonUrl.toString());
    assert.equal(repeated.status(), 200);
    moversCacheStatus = repeated.headers()['x-extractor-cache'] || '';
  }
  assert.equal(moversCacheStatus, 'HIT', 'Repeated market movers request was not served from the Worker cache');
  const moversMarkdownUrl = new URL(moversJsonUrl);
  moversMarkdownUrl.searchParams.set('format', 'markdown');
  const moversMarkdown = await page.request.get(moversMarkdownUrl.toString());
  assert.equal(moversMarkdown.status(), 200);
  assert.match(moversMarkdown.headers()['content-type'] || '', /^text\/markdown/i);
  assert.match(await moversMarkdown.text(), /^# Daily stock gainers/m);

  const financeJsonUrl = new URL('/api/finance', origin);
  financeJsonUrl.searchParams.set('symbol', 'AAPL');
  financeJsonUrl.searchParams.set('timeframe', '5d');
  financeJsonUrl.searchParams.set('quote', 'EUR');
  financeJsonUrl.searchParams.set('format', 'json');
  const financeResponse = await page.request.get(financeJsonUrl.toString());
  assert.equal(financeResponse.status(), 200, `Finance returned HTTP ${financeResponse.status()}`);
  const financePayload = await financeResponse.json();
  assert.equal(financePayload.schemaVersion, 1);
  assertEntity(financePayload, 'finance', 'document');
  assert.equal(financePayload.attributes.tickerSymbol, 'AAPL');
  assert.equal(financePayload.attributes.historyTimeframe, '5d');
  assert.equal(financePayload.attributes.historyInterval, '15m');
  assert.equal(financePayload.attributes.currency, 'EUR');
  assert.equal(financePayload.attributes.quoteCurrency, 'EUR');
  assert.equal(typeof financePayload.attributes.listingCurrency, 'string');
  assert.equal(typeof financePayload.attributes.exchangeRate, 'number');
  assert.ok(financePayload.attributes.history.length <= 512, 'Finance history exceeds its point cap');
  let financeCacheStatus = '';
  for (let attempt = 0; attempt < 5 && financeCacheStatus !== 'HIT'; attempt += 1) {
    await page.waitForTimeout(200);
    const repeated = await page.request.get(financeJsonUrl.toString());
    assert.equal(repeated.status(), 200);
    financeCacheStatus = repeated.headers()['x-extractor-cache'] || '';
  }
  assert.equal(financeCacheStatus, 'HIT', 'Repeated finance request was not served from the Worker cache');
  const financeMarkdownUrl = new URL(financeJsonUrl);
  financeMarkdownUrl.searchParams.set('format', 'markdown');
  const financeMarkdown = await page.request.get(financeMarkdownUrl.toString());
  assert.equal(financeMarkdown.status(), 200);
  assert.match(financeMarkdown.headers()['content-type'] || '', /^text\/markdown/i);
  assert.match(await financeMarkdown.text(), /Price history \(5d, 15m\)/i);

  await mcpClient.connect(new StreamableHTTPClientTransport(
    new URL(`${origin}/mcp`),
    apiKey ? {
      requestInit: {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(serviceSubject ? { 'X-Extractr-Service-Subject': serviceSubject } : {}),
        },
      },
    } : undefined,
  ));
  const tools = await mcpClient.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['extract_public_url', 'search_images', 'search_videos', 'search_places', 'search_web', 'search_news', 'search_stocks', 'get_market_movers', 'get_market_data']);
  const financeTool = tools.tools.find((tool) => tool.name === 'get_market_data');
  assert.equal(financeTool?._meta?.ui?.resourceUri, 'ui://extractor.sh/finance/price-chart-v1.html');
  const resources = await mcpClient.listResources();
  const financeResource = resources.resources.find((resource) => resource.uri === 'ui://extractor.sh/finance/price-chart-v1.html');
  assert.ok(financeResource, 'MCP finance chart resource is not discoverable');
  assert.equal(financeResource.mimeType, 'text/html;profile=mcp-app');
  const financeApp = await mcpClient.readResource({ uri: financeResource.uri });
  const financeAppHtml = financeApp.contents.find((item) => item.uri === financeResource.uri)?.text;
  assert.ok(financeAppHtml, 'MCP finance chart resource has no HTML');
  assert.match(financeAppHtml, /Price trend/);
  assert.doesNotMatch(financeAppHtml, /<script[^>]+src=/i, 'MCP finance chart loads an external script');
  const mcpSearchResult = await mcpClient.callTool({
    name: 'search_web',
    arguments: { query: 'Cloudflare Workers', format: 'json', limit: 3, language: 'en-US', country: 'US', site: 'cloudflare.com' },
  });
  assert.notEqual(mcpSearchResult.isError, true, 'MCP search returned a tool error');
  const mcpSearchText = mcpSearchResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(mcpSearchText, 'MCP search did not return text content');
  assertEntity(JSON.parse(mcpSearchText), 'web-search', 'feed');
  assert.equal(JSON.parse(mcpSearchText).attributes.site, 'cloudflare.com');
  assertEntity(mcpSearchResult.structuredContent, 'web-search', 'feed');
  const mcpImageResult = await mcpClient.callTool({
    name: 'search_images',
    arguments: { query: 'coral reef', format: 'json', limit: 3, usage: 'commercial', orientation: 'landscape' },
  });
  assert.notEqual(mcpImageResult.isError, true, 'MCP image search returned a tool error');
  const mcpImageText = mcpImageResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(mcpImageText, 'MCP image search did not return text content');
  assertEntity(JSON.parse(mcpImageText), 'image-search', 'feed');
  const mcpVideoResult = await mcpClient.callTool({
    name: 'search_videos',
    arguments: { query: 'Taylor Swift', format: 'json', limit: 3, language: 'en-US', country: 'US', platform: 'youtube', sort: 'date', creator: 'Taylor Swift' },
  });
  assert.notEqual(mcpVideoResult.isError, true, 'MCP video search returned a tool error');
  const mcpVideoText = mcpVideoResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(mcpVideoText, 'MCP video search did not return text content');
  assert.equal(JSON.parse(mcpVideoText).attributes.videoSort, 'date');
  assert.equal(JSON.parse(mcpVideoText).attributes.videoCreator, 'Taylor Swift');
  assertEntity(mcpVideoResult.structuredContent, 'video-search', 'feed');
  const mcpPlaceResult = await mcpClient.callTool({
    name: 'search_places',
    arguments: { query: 'Brandenburg Gate Berlin', format: 'json', limit: 3, language: 'de', country: 'DE', lat: 52.52, lon: 13.405 },
  });
  assert.notEqual(mcpPlaceResult.isError, true, 'MCP place search returned a tool error');
  const mcpPlaceText = mcpPlaceResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(mcpPlaceText, 'MCP place search did not return text content');
  assertEntity(JSON.parse(mcpPlaceText), 'place-search', 'feed');
  const mcpNewsResult = await mcpClient.callTool({
    name: 'search_news',
    arguments: { query: 'Cloudflare', format: 'json', limit: 3, language: 'en-US', country: 'US', timeframe: '30d' },
  });
  assert.notEqual(mcpNewsResult.isError, true, 'MCP news search returned a tool error');
  const mcpNewsText = mcpNewsResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(mcpNewsText, 'MCP news search did not return text content');
  assertEntity(JSON.parse(mcpNewsText), 'google-news', 'feed');
  const mcpStockResult = await mcpClient.callTool({
    name: 'search_stocks',
    arguments: { query: 'Apple', format: 'json', limit: 5 },
  });
  assert.notEqual(mcpStockResult.isError, true, 'MCP stock search returned a tool error');
  const mcpStockText = mcpStockResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(mcpStockText, 'MCP stock search did not return text content');
  assertEntity(JSON.parse(mcpStockText), 'finance', 'feed');
  const mcpMoversResult = await mcpClient.callTool({
    name: 'get_market_movers',
    arguments: { list: 'gainers', format: 'json', limit: 3 },
  });
  assert.notEqual(mcpMoversResult.isError, true, 'MCP market movers returned a tool error');
  const mcpMoversText = mcpMoversResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(mcpMoversText, 'MCP market movers did not return text content');
  assertEntity(JSON.parse(mcpMoversText), 'finance', 'feed');
  assert.equal(mcpMoversResult.structuredContent.attributes.financeMoverList, 'gainers');
  const mcpFinanceResult = await mcpClient.callTool({
    name: 'get_market_data',
    arguments: { symbol: 'AAPL', format: 'json', timeframe: '5d', quote: 'EUR' },
  });
  assert.notEqual(mcpFinanceResult.isError, true, 'MCP finance returned a tool error');
  const mcpFinanceText = mcpFinanceResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(mcpFinanceText, 'MCP finance did not return text content');
  assertEntity(JSON.parse(mcpFinanceText), 'finance', 'document');
  assertEntity(mcpFinanceResult.structuredContent, 'finance', 'document');
  assert.equal(mcpFinanceResult.structuredContent.attributes.currency, 'EUR');

  // Render the exact MCP resource with a minimal standards-compatible host
  // bridge. This verifies that the production bundle consumes the tool's
  // structured content and draws its chart, rather than only checking strings.
  const appErrors = [];
  const appPage = await context.newPage();
  appPage.on('pageerror', (error) => appErrors.push(`pageerror: ${error.message}`));
  appPage.on('console', (message) => {
    if (message.type() === 'error') appErrors.push(`console: ${message.text()}`);
  });
  await appPage.addInitScript((toolResult) => {
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      if (message.method === 'ui/initialize' && message.id !== undefined) {
        window.postMessage({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2026-01-26',
            hostInfo: { name: 'extractor-smoke-host', version: '1.0.0' },
            hostCapabilities: {},
            hostContext: { theme: 'light', platform: 'web' },
          },
        }, '*');
      }
      if (message.method === 'ui/notifications/initialized') {
        window.postMessage({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: toolResult,
        }, '*');
      }
    });
  }, mcpFinanceResult);
  await appPage.route('https://mcp-finance-app.test/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: financeAppHtml,
  }));
  await appPage.goto('https://mcp-finance-app.test/');
  await appPage.locator('#chart-section').waitFor({ state: 'visible' });
  assert.match(await appPage.locator('#instrument').textContent() || '', /AAPL|Apple/i);
  assert.ok((await appPage.locator('#line').getAttribute('d'))?.startsWith('M '), 'MCP finance chart did not draw a line');
  assert.equal(await appPage.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true, 'MCP finance chart overflows horizontally');
  assert.deepEqual(appErrors, [], `MCP finance App emitted browser errors:\n${appErrors.join('\n')}`);
  await appPage.close();
  const mcpResult = await mcpClient.callTool({
    name: 'extract_public_url',
    arguments: { url: 'https://example.com/', format: 'json' },
  });
  assert.notEqual(mcpResult.isError, true, 'MCP extraction returned a tool error');
  const mcpText = mcpResult.content.find((item) => item.type === 'text')?.text;
  assert.ok(mcpText, 'MCP extraction did not return text content');
  const mcpExtraction = JSON.parse(mcpText);
  assert.equal(mcpExtraction.schemaVersion, 1);
  assertEntity(mcpExtraction, 'web', 'article');

  await submitExtraction({
    url: 'https://openai.com/index/gpt-5-6/',
    format: 'json',
    source: 'web',
    type: 'article',
    text: /GPT-5\.6: Frontier intelligence/i,
  });
  await submitExtraction({
    url: 'https://blog.hubspot.com/',
    format: 'json',
    source: 'web',
    type: 'feed',
    text: /HubSpot Blog/i,
  });
  await submitExtraction({
    url: 'https://www.copart.com/',
    format: 'json',
    source: 'web',
    type: 'article',
    text: /Online Auto Auctions/i,
  });
  await submitExtraction({
    url: 'https://bsky.app/profile/bsky.app/post/3mqcp5qjdfs26',
    format: 'markdown',
    source: 'bluesky',
    type: 'post',
    text: /Post by Bluesky/,
  });
  await submitExtraction({
    url: 'https://bsky.app/profile/bsky.app',
    format: 'json',
    source: 'bluesky',
    type: 'profile',
    text: /"source": "bluesky"/,
  });
  await submitExtraction({
    url: 'https://x.com/jack/status/20',
    format: 'json',
    source: 'x',
    type: 'post',
    text: /just setting up my twttr/,
  });
  await submitExtraction({
    url: 'https://vimeo.com/286898202?extractor_adapter=browser-1',
    format: 'json',
    source: 'vimeo',
    type: 'video',
    text: /My video/i,
  });
  await submitExtraction({
    url: 'https://soundcloud.com/forss/flickermood?extractor_adapter=browser-1',
    format: 'json',
    source: 'soundcloud',
    type: 'audio',
    text: /Flickermood by Forss/i,
  });
  await submitExtraction({
    url: 'https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5?extractor_adapter=browser-1',
    format: 'json',
    source: 'spotify',
    type: 'audio',
    text: /My Path to Spotify/i,
  });
  await submitExtraction({
    url: 'https://mastodon.social/@trwnh/99664077509711321?extractor_adapter=browser-1',
    format: 'json',
    source: 'mastodon',
    type: 'post',
    text: /Mastodon Flat CSS/i,
  });
  await submitExtraction({
    url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173',
    format: 'json',
    source: 'tiktok',
    type: 'post',
    text: /Scramble up ur name/i,
  });
  await submitExtraction({
    url: 'https://www.tiktok.com/@scout2015',
    format: 'json',
    source: 'tiktok',
    type: 'profile',
    text: /"totalLikeCount"/i,
  });
  await submitExtraction({
    url: 'https://www.instagram.com/p/DbbY9pdm6Q2/',
    format: 'json',
    source: 'instagram',
    type: 'post',
    text: /Instagram post/i,
  });
  await submitExtraction({
    url: 'https://www.instagram.com/instagram/',
    format: 'json',
    source: 'instagram',
    type: 'profile',
    text: /"source": "instagram"/,
  });
  await submitExtraction({
    url: 'https://www.allbirds.com/products/mens-cruiser-shadow-blue-natural-white-sole',
    format: 'json',
    source: 'shopify',
    type: 'product',
    text: /Men's Cruiser/,
  });
  await submitExtraction({
    url: 'https://www.allbirds.com/',
    format: 'json',
    source: 'shopify',
    type: 'feed',
    text: /"source": "shopify"/,
  });
  await submitExtraction({
    url: 'https://www.goodamerican.com/en-de/products/always-fits-good-classic-bootcut-jeans-indigo316?extractor_adapter=shopify-routes-v2',
    format: 'json',
    source: 'shopify',
    type: 'product',
    text: /ALWAYS FITS GOOD CLASSIC BOOTCUT JEANS/i,
  });
  await submitExtraction({
    url: 'https://www.goodamerican.com/collections/sweat-sets?extractor_adapter=shopify-routes-v2',
    format: 'json',
    source: 'shopify',
    type: 'feed',
    text: /"feedType": "collection"/,
  });
  await submitExtraction({
    url: 'https://www.goodamerican.com/blogs/good-times?extractor_adapter=shopify-routes-v2',
    format: 'json',
    source: 'web',
    type: 'article',
    text: /Good Times/i,
  });
  await submitExtraction({
    url: 'https://muista.eu/shop/rugs/sunrise-rug/',
    format: 'json',
    source: 'woocommerce',
    type: 'product',
    text: /Handmade Designer Rug.*Sunrise/i,
  });
  await submitExtraction({
    url: 'https://muista.eu/?s=chair&post_type=product',
    format: 'json',
    source: 'woocommerce',
    type: 'feed',
    text: /"query": "chair"/i,
  });
  await submitExtraction({
    url: 'https://www.giant-montabaur.de/de/bikes/city-und-trekking',
    format: 'json',
    source: 'web',
    type: 'feed',
    text: /"feedType": "products"/i,
  });
  await submitExtraction({
    url: 'https://www.giant-montabaur.de/de/dailytour-eplus-3-gts-2022',
    format: 'json',
    source: 'web',
    type: 'product',
    text: /DailyTour E\+ 3 GTS/i,
  });
  await submitExtraction({
    url: 'https://www.amazon.de/echo-dot-2022/dp/B09B8X9RGM',
    format: 'json',
    source: 'amazon',
    type: 'product',
    text: /Echo Dot/i,
  });
  await submitExtraction({
    url: 'https://www.amazon.de/s?k=mechanical+keyboard&extractor_adapter=browser-1',
    format: 'json',
    source: 'amazon',
    type: 'feed',
    text: /Amazon search: mechanical keyboard/i,
  });
  await submitExtraction({
    url: 'https://apps.apple.com/de/app/chatgpt/id6448311069',
    format: 'json',
    source: 'app-store',
    type: 'product',
    text: /"title": "ChatGPT"/,
  });
  await submitExtraction({
    url: 'https://play.google.com/store/apps/details?id=com.openai.chatgpt',
    format: 'json',
    source: 'google-play',
    type: 'product',
    text: /"title": "ChatGPT"/,
  });
  await submitExtraction({
    url: 'https://news.google.com/search?q=Cloudflare&hl=en-US&gl=US&ceid=US%3Aen',
    format: 'json',
    source: 'google-news',
    type: 'feed',
    text: /"source": "google-news"/,
  });
  await submitExtraction({
    url: 'https://www.reddit.com/r/reddit.com/comments/87/the_downing_street_memo/',
    format: 'json',
    source: 'reddit',
    type: 'post',
    text: /Downing Street Memo/i,
  });
  await submitExtraction({
    url: 'https://www.youtube.com/@Cloudflare',
    format: 'json',
    source: 'youtube',
    type: 'feed',
    text: /"source": "youtube"/,
  });
  await submitExtraction({
    url: 'https://finance.yahoo.com/quote/AAPL/',
    format: 'json',
    source: 'yahoo-finance',
    type: 'document',
    text: /"tickerSymbol": "AAPL"/,
  });
  await submitExtraction({
    url: 'https://finance.yahoo.com/quote/AAPL/',
    format: 'markdown',
    source: 'yahoo-finance',
    type: 'document',
    text: /Recent daily prices/,
  });

  const legalRoutes = ['/privacy/', '/legal/', '/terms/'];
  const contentRoutes = [
    ...platformRoutes,
    '/docs/search/', '/docs/news/', '/docs/images/', '/docs/videos/', '/docs/places/', '/docs/finance/', '/docs/mcp/', '/docs/api/', '/docs/schema/', '/docs/sources/', '/docs/limitations/', '/pricing/', '/contact/',
    '/alternatives/', '/blog/',
    ...alternativePages.map((item) => `/alternatives/${item.slug}/`),
    ...platformArticles.map((item) => `/blog/${item.slug}/`),
  ];
  for (const route of contentRoutes) {
    const unslashed = route.slice(0, -1);
    const canonicalResponse = await page.request.get(`${origin}${unslashed}`, { maxRedirects: 0 });
    assert.equal(canonicalResponse.status(), 308, `${unslashed} does not permanently redirect to its trailing-slash URL`);
    assert.equal(new URL(canonicalResponse.headers().location).pathname, route, `${unslashed} redirects to the wrong canonical path`);
    const response = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200, `${route} returned HTTP ${response?.status()}`);
    await page.locator('h1').waitFor();
    if (route.startsWith('/alternatives/') && route !== '/alternatives/') {
      const provider = alternativePages.find((item) => route === `/alternatives/${item.slug}/`)?.provider;
      assert.ok(provider && (await page.locator('h1').textContent())?.includes(provider), `${route} does not name the competitor in its H1`);
      assert.equal(await page.locator('main a[href^="http"]').count(), 0, `${route} links to a competitor`);
      assert.equal(await page.locator('[data-extractor-choice]').count(), 1, `${route} is missing the extractor.sh value card`);
      assert.equal(await page.locator('[data-provider-choice]').count(), 1, `${route} is missing the provider-fit card`);
      assert.equal(await page.locator('#advantages-heading').count(), 1, `${route} is missing extractor.sh advantages`);
    }
    if (route === '/pricing/') {
      const mainText = await page.locator('main').textContent() || '';
      assert.match(mainText, /10\s*requests \/ day/i, 'Pricing does not explain the anonymous daily allowance');
      assert.match(mainText, /1,000\s*welcome credits/i, 'Pricing does not explain the new-account welcome bonus');
      assert.match(mainText, /\$0\.49\s*\/ 1,000 credits/i, 'Pricing does not use credits as its paid unit');
      assert.match(mainText, /Each extraction, web search, news search, image search, video search, place or map search, or finance request counts as one credit\./i, 'Pricing does not define which features count as one credit');
      assert.match(
        mainText,
        /Please test extractor\.sh with your intended URLs before adding credits\./,
        'Pricing does not include the pre-credit testing disclaimer',
      );
      assert.doesNotMatch(mainText, /Contact us if you need help evaluating a specific use case\./, 'Pricing still includes the removed contact sentence');
      const includedItems = await page.locator('section[aria-labelledby="pricing-heading"] ul li').allTextContents();
      assert.ok(includedItems.includes('Extract data from any supported source'), 'Pricing does not describe broad supported-source extraction');
      assert.equal(includedItems.at(-1), '60 API calls per minute', 'Pricing does not show the API limit as the last Included item');
      const freeAccess = page.locator('section[aria-label="Free access"]');
      assert.equal(await freeAccess.locator('article').count(), 2, 'Pricing free access is not split into two cards');
      assert.deepEqual(await freeAccess.locator('article > strong').allTextContents(), ['No account', 'Free account'], 'Pricing account badges are incorrect');
      assert.equal(await freeAccess.locator('article > strong').first().evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(0, 0, 0)', 'Pricing account badges are not black');
      assert.equal(await freeAccess.locator('h2').first().evaluate((element) => getComputedStyle(element).fontWeight), '400', 'Pricing request labels should not be bold');
      const getStarted = page.getByRole('link', { name: 'Get started', exact: true });
      assert.equal(await getStarted.count(), 1, 'Pricing Get started CTA is missing');
      assert.equal(await getStarted.locator('svg').count(), 1, 'Pricing Get started CTA is missing its arrow icon');
      assert.equal(
        await getStarted.locator('svg path').evaluate((element) => getComputedStyle(element).strokeWidth),
        '2.25px',
        'Pricing Get started arrow is too thin',
      );
      assert.match(await getStarted.evaluate((element) => element.nextElementSibling?.textContent || ''), /Please test extractor\.sh/, 'Testing disclaimer is not below the Get started CTA');
      assert.equal(await page.getByRole('heading', { name: /Top up exactly|Secure checkout/i }).count(), 0, 'Removed billing detail cards are still present');
      assert.equal(await page.locator('main a[href="/contact/"]').count(), 0, 'Pricing still includes the removed contact link');
      const pricingFaq = page.locator('[data-pricing-faq]');
      assert.equal(await pricingFaq.locator('details').count(), 10, 'Pricing FAQ should contain the selected questions');
      assert.match(mainText, /standard limit is 60 uncached requests per client per minute/i, 'Pricing FAQ does not show the 60-per-minute standard limit');
      assert.match(mainText, /Do all endpoints and features cost the same\?/i, 'Pricing FAQ does not explain consistent endpoint pricing');
      const failedRequestFaq = pricingFaq.locator('details').filter({ hasText: 'Do you charge for failed requests?' });
      await failedRequestFaq.locator('summary').click();
      assert.match(await failedRequestFaq.innerText(), /released when the request fails/i, 'Pricing FAQ does not explain failed-request refunds');
      const monthlyFaq = pricingFaq.locator('details').filter({ hasText: 'Is there a monthly plan?' });
      await monthlyFaq.locator('summary').click();
      assert.equal(await failedRequestFaq.getAttribute('open'), null, 'Opening another pricing FAQ item should close the previous item');
    }
    if (route === '/contact/') {
      assert.equal(await page.locator('form[data-contact-form][action="/api/contact"][method="post"]').count(), 1, 'Contact form is missing');
      assert.equal(await page.locator('input[name="email"][required]').count(), 1, 'Contact email field is not required');
      assert.equal(await page.locator('textarea[name="message"][required]').count(), 1, 'Contact message field is not required');
      assert.equal(await page.locator('input[name="website"]').count(), 1, 'Contact form honeypot is missing');
      const invalidContact = await page.request.post(`${origin}/api/contact`, {
        headers: { Accept: 'application/json', Origin: origin },
        form: { email: 'invalid', topic: 'extraction', message: 'This is long enough to pass the message length check.', website: '' },
      });
      assert.equal(invalidContact.status(), 400, 'Invalid contact submission is not rejected');
      assert.deepEqual((await invalidContact.json()).error?.code, 'invalid_request');
    }
    await assertNoHorizontalOverflow(route);
  }

  // Keep JavaScript disabled so production Turnstile cannot automatically
  // navigate while the locked server response itself is being inspected.
  const legalContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const legalPage = await legalContext.newPage();
  for (const route of legalRoutes) {
    const unslashed = route.slice(0, -1);
    const canonicalResponse = await legalPage.request.get(`${origin}${unslashed}`, { maxRedirects: 0 });
    assert.equal(canonicalResponse.status(), 308, `${unslashed} does not permanently redirect to its trailing-slash URL`);
    assert.equal(new URL(canonicalResponse.headers().location).pathname, route, `${unslashed} redirects to the wrong canonical legal path`);
    const response = await legalPage.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded' });
    assert.equal(response?.status(), 200, `${route} returned HTTP ${response?.status()}`);
    assert.match(await legalPage.locator('meta[name="robots"]').getAttribute('content') || '', /noindex/, `${route} is missing its noindex meta directive`);
    assert.match(response?.headers()['x-robots-tag'] || '', /noindex/, `${route} is missing its X-Robots-Tag header`);
    assert.match(response?.headers()['cache-control'] || '', /no-store/, `${route} can be cached before or after verification`);
    assert.equal(await legalPage.locator('link[rel="alternate"][type="text/markdown"]').count(), 0, `${route} advertises an agent Markdown representation`);
    assert.equal(await legalPage.locator('[data-legal-gate]').count(), 1, `${route} does not require Turnstile`);
    assert.equal(await legalPage.locator('main article').count(), 0, `${route} renders legal information before verification`);
    assert.doesNotMatch(await legalPage.locator('html').textContent() || '', /Eyloo GmbH|DE350377015|HRB 28282|Im Hemchen/, `${route} leaks protected operator information`);
    assert.equal(await legalPage.locator('form[data-legal-gate-form][action="/api/legal-access"][method="post"]').count(), 1, `${route} has no server-side verification form`);
    assert.equal(await legalPage.locator('.cf-turnstile[data-action="legal_access"]').count(), 1, `${route} has no legal-access Turnstile widget`);
    assert.equal(await legalPage.locator('[data-legal-gate-form] button[type="submit"]').count(), 0, `${route} still requires a redundant Continue click`);
    assert.equal(await legalPage.locator('input[name="next"]').getAttribute('value'), route, `${route} has the wrong post-verification destination`);
    assert.ok(await legalPage.locator('main').evaluate((element) => element.scrollWidth <= document.documentElement.clientWidth), `${route} overflows on mobile`);
  }
  await legalContext.close();

  const rejectedLegalAccess = await page.request.post(`${origin}/api/legal-access`, {
    form: { next: '/legal/', 'cf-turnstile-response': 'invalid-smoke-token' },
    headers: { Origin: origin },
    maxRedirects: 0,
  });
  assert.equal(rejectedLegalAccess.status(), 303, 'Invalid Turnstile token does not return to the legal gate');
  assert.equal(new URL(rejectedLegalAccess.headers().location).pathname, '/legal/', 'Invalid Turnstile redirect leaves the legal routes');
  assert.equal(new URL(rejectedLegalAccess.headers().location).searchParams.get('gate'), 'failed', 'Invalid Turnstile redirect does not expose a safe retry state');

  for (const route of platformRoutes) {
    const platform = platformPageList.find((item) => route === `/${item.slug}/`);
    const response = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200, `${route} returned HTTP ${response?.status()}`);
    assert.ok(platform, `${route} has no platform configuration`);
    assert.equal(await page.title(), platform.title, `${route} has the wrong SEO title`);
    assert.match(await page.title(), /\bFree\b/, `${route} does not advertise the free preview in its SEO title`);
    assert.equal((await page.locator('h1').textContent())?.trim(), platform.headline, `${route} has the wrong search-focused H1`);
    assert.match(platform.headline, /Scraper - Extract/, `${route} H1 does not match scraper search intent`);
    assert.equal(await page.locator('#capabilities-heading').count(), 1, `${route} is missing its capabilities section`);
    assert.equal(await page.locator('[data-capability-card] li').count(), platform.capabilities.length, `${route} has an incomplete capability card`);
    if (platform.slug === 'yahoo-finance') {
      assert.equal(await page.locator('[data-finance-playground] form[action="/api/finance"][method="get"]').count(), 1, `${route} is missing its symbol finance playground`);
    } else {
      assert.equal(await page.locator('[data-platform-playground] form[action="/api/extract"][method="get"]').count(), 1, `${route} is missing its live playground`);
    }
    assert.equal(await page.locator('[data-code-tab]').count(), 3, `${route} is missing curl, Node, or Python examples`);
    assert.equal(await page.locator('[data-code-panel]').count(), 3, `${route} is missing a code panel`);
    assert.equal(await page.locator('#faq-heading').count(), 1, `${route} is missing its FAQ`);
    const structuredData = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() || '{}');
    const graphTypes = structuredData['@graph']?.map((item) => item['@type']) ?? [];
    assert.ok(graphTypes.includes('HowTo'), `${route} is missing HowTo structured data`);
    assert.ok(graphTypes.includes('FAQPage'), `${route} is missing FAQ structured data`);
  }

  // Exercise the reusable platform playground itself, including capability
  // presets and both public output formats, against production.
  await page.goto(`${origin}/woocommerce/`, { waitUntil: 'networkidle' });
  const platformInput = page.locator('[data-playground-input]');
  const platformForm = page.locator('[data-playground-form]');
  assert.match(await platformInput.inputValue(), /^https:\/\//);
  const searchPreset = page.locator('[data-example-url]').filter({ hasText: 'Store search' });
  await searchPreset.click();
  assert.match(await platformInput.inputValue(), /[?&]s=chair/);
  await platformForm.locator('input[value="json"]').check();
  const platformJsonResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/extract' && url.searchParams.get('format') === 'json' && url.searchParams.get('url')?.includes('muista.eu');
  });
  await platformForm.locator('button[type="submit"]').click({ force: true });
  assert.equal((await platformJsonResponse).status(), 200, 'Platform JSON playground request failed');
  await page.locator('[data-playground-result]:not([hidden])').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-playground-output]')?.textContent?.includes('"source": "woocommerce"'));
  assert.match(await page.locator('[data-playground-output]').textContent() || '', /"source": "woocommerce"/);
  assert.match(await page.locator('[data-playground-raw]').getAttribute('href') || '', /format=json/);
  await page.locator('[data-example-url]').filter({ hasText: 'Product details' }).click();
  await platformForm.locator('input[value="markdown"]').check();
  const platformMarkdownResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/extract' && url.searchParams.get('format') === 'markdown' && url.searchParams.get('url')?.includes('sunrise-rug');
  });
  await platformForm.locator('button[type="submit"]').click({ force: true });
  assert.equal((await platformMarkdownResponse).status(), 200, 'Platform Markdown playground request failed');
  await page.waitForFunction(() => /Handmade Designer Rug/i.test(document.querySelector('[data-playground-output]')?.textContent || ''));
  assert.match(await page.locator('[data-playground-output]').textContent() || '', /Handmade Designer Rug/i);
  assert.match(await page.locator('[data-playground-raw]').getAttribute('href') || '', /format=markdown/);
  await page.locator('[data-code-tab="node"]').click();
  assert.equal(await page.locator('[data-code-panel="node"]').getAttribute('hidden'), null, 'Node code example did not open');
  assert.match(await page.locator('[data-code-panel="node"]').textContent() || '', /URLSearchParams/);

  // Yahoo Finance has a dedicated symbol playground while ordinary quote
  // URLs remain covered above through the generic extractor.
  await page.goto(`${origin}/yahoo-finance/`, { waitUntil: 'networkidle' });
  const financePlayground = page.locator('[data-finance-playground]');
  await financePlayground.locator('[data-symbol="^GSPC"]').click();
  assert.equal(await financePlayground.locator('[data-finance-symbol]').inputValue(), '^GSPC');
  await financePlayground.locator('[data-symbol="AAPL"]').click();
  await financePlayground.locator('select[name="timeframe"]').selectOption('3mo');
  await financePlayground.locator('select[name="quote"]').selectOption('EUR');
  await financePlayground.locator('input[name="format"][value="json"]').check();
  const financePlaygroundResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/finance' && url.searchParams.get('symbol') === 'AAPL'
      && url.searchParams.get('timeframe') === '3mo' && url.searchParams.get('quote') === 'EUR'
      && url.searchParams.get('format') === 'json';
  });
  await financePlayground.locator('button[type="submit"]').click({ force: true });
  assert.equal((await financePlaygroundResponse).status(), 200, 'Finance playground request failed');
  await page.waitForFunction(() => /"source":\s*"finance"/.test(document.querySelector('[data-finance-output]')?.textContent || ''));
  assert.match(await financePlayground.locator('[data-finance-raw]').getAttribute('href') || '', /timeframe=3mo/);
  assert.match(await financePlayground.locator('[data-finance-raw]').getAttribute('href') || '', /quote=EUR/);
  await assertNoHorizontalOverflow('finance playground');

  const sitemapResponse = await page.request.get(`${origin}/sitemap.xml`);
  assert.equal(sitemapResponse.status(), 200, '/sitemap.xml is unavailable');
  assert.match(sitemapResponse.headers()['content-type'] || '', /^application\/xml/i);
  const sitemap = await sitemapResponse.text();
  const expectedSitemapUrls = 21 + platformPageList.length + alternativePages.length + platformArticles.length;
  assert.equal((sitemap.match(/<loc>/g) || []).length, expectedSitemapUrls, 'Sitemap does not contain every public page');
  for (const route of contentRoutes) {
    assert.ok(sitemap.includes(`${origin}${route}`), `${route} is missing from sitemap.xml`);
  }
  for (const route of legalRoutes) assert.ok(!sitemap.includes(`${origin}${route}`), `${route} must be excluded from sitemap.xml`);

  const robotsResponse = await page.request.get(`${origin}/robots.txt`);
  assert.equal(robotsResponse.status(), 200, '/robots.txt is unavailable');
  const robots = await robotsResponse.text();
  for (const route of legalRoutes) assert.ok(robots.includes(`Disallow: ${route}`), `${route} is not disallowed in robots.txt`);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  assert.equal(await page.locator('main h1').first().innerText(), 'Turn web pages into\nAI-friendly context', 'Mobile homepage hero copy is incorrect');
  await assertNoHorizontalOverflow('mobile homepage');
  assert.equal(
    await page.locator('#supported-platforms-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    4,
    'Supported platforms do not use a four-column mobile grid',
  );
  const submitWidth = await page.locator('#extract-form button[type="submit"]').evaluate((element) => element.getBoundingClientRect().width);
  const formWidth = await page.locator('#extract-form').evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(submitWidth >= formWidth - 2, 'Mobile submit button does not span the form width');

  await page.goto(`${origin}/amazon/`, { waitUntil: 'networkidle' });
  await assertNoHorizontalOverflow('mobile platform page');
  assert.equal(await page.locator('[data-platform-playground]').count(), 1, 'Mobile platform page lost its playground');
  await page.goto(`${origin}/yahoo-finance/`, { waitUntil: 'networkidle' });
  await assertNoHorizontalOverflow('mobile finance playground');
  assert.equal(await page.locator('[data-finance-playground]').count(), 1, 'Mobile Yahoo Finance page lost its finance playground');

  assert.deepEqual(browserErrors, [], `Chromium reported errors:\n${browserErrors.join('\n')}`);
  process.stdout.write('Chromium production smoke passed: site-restricted web search, news, image, creator video, place/map, stock search, market movers, finance; MCP; extraction adapters; alternatives; all platform articles; gated legal pages; sitemap.xml; docs; pricing; contact; and desktop/mobile layouts.\n');
} finally {
  await mcpClient.close().catch(() => {});
  await anonymousContext.close();
  await context.close();
  await browser.close();
}
