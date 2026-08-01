import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { alternativePages, platformArticles } from '../src/features/marketing/content.ts';

const origin = (process.env.EXTRACTOR_ORIGIN || 'https://extractor.mcb-software.workers.dev').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'light',
});
const page = await context.newPage();
const browserErrors = [];

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

async function submitExtraction({ url, format, source, kind, text }) {
  await page.locator('#url').fill(url);
  await page.locator(`input[name="format"][value="${format}"]`).check();

  const responsePromise = page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    return responseUrl.pathname === '/api/extract'
      && responseUrl.searchParams.get('url') === url
      && responseUrl.searchParams.get('format') === format;
  });
  await page.locator('#extract-form button[type="submit"]').click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, `${source} returned HTTP ${response.status()}`);
  await page.locator('#result[data-state="success"]').waitFor({ timeout: 30_000 });

  const expectedLabel = format === 'json' ? 'JSON result' : 'Markdown result';
  assert.equal(await page.locator('#result-label').textContent(), expectedLabel);
  const content = page.locator('#result-content');
  await assertNoHorizontalOverflow(`${source} ${format} preview`);
  assert.match(await content.innerText(), text, `${source} preview did not contain expected content`);
  assert.equal(await content.locator('script, iframe').count(), 0, `${source} preview contains active embed elements`);

  const rawUrl = new URL(await page.locator('#raw-result').getAttribute('href'));
  assert.equal(rawUrl.searchParams.get('url'), url);
  assert.equal(rawUrl.searchParams.get('format'), format);

  if (format === 'json') {
    const payload = JSON.parse(await content.locator('pre').innerText());
    assert.equal(payload.source, source);
    assert.equal(payload.kind, kind);
    assert.equal(Object.hasOwn(payload, 'method'), false, 'Internal extraction method leaked publicly');
  } else {
    assert.match(response.headers()['content-type'] || '', /^text\/markdown/i);
  }
}

try {
  const home = await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  assert.equal(home?.status(), 200);
  await page.locator('#extract-form').waitFor();
  assert.equal(await page.locator('.method-card').count(), 12);
  assert.equal(await page.locator('footer a[href="/alternatives/"]').count(), 1, 'Alternatives footer link is missing');
  assert.equal(await page.locator('footer a[href="/blog/"]').count(), 1, 'Blog footer link is missing');
  for (const card of await page.locator('.method-card').all()) {
    assert.equal(await card.locator('svg').count(), 2, 'A source card is missing its platform or arrow icon');
    const arrowBox = await card.locator('svg').last().boundingBox();
    assert.ok(arrowBox && arrowBox.width >= 20 && arrowBox.height >= 20, 'A source card arrow is not visible');
  }
  await assertNoHorizontalOverflow('desktop homepage');

  await submitExtraction({
    url: 'https://bsky.app/profile/bsky.app/post/3mqcp5qjdfs26',
    format: 'markdown',
    source: 'bluesky',
    kind: 'document',
    text: /Post by Bluesky/,
  });
  await submitExtraction({
    url: 'https://bsky.app/profile/bsky.app',
    format: 'json',
    source: 'bluesky',
    kind: 'feed',
    text: /"source": "bluesky"/,
  });
  await submitExtraction({
    url: 'https://x.com/jack/status/20',
    format: 'json',
    source: 'x',
    kind: 'document',
    text: /just setting up my twttr/,
  });
  await submitExtraction({
    url: 'https://vimeo.com/286898202?extractor_adapter=browser-1',
    format: 'json',
    source: 'vimeo',
    kind: 'document',
    text: /My video/i,
  });
  await submitExtraction({
    url: 'https://soundcloud.com/forss/flickermood?extractor_adapter=browser-1',
    format: 'json',
    source: 'soundcloud',
    kind: 'document',
    text: /Flickermood by Forss/i,
  });
  await submitExtraction({
    url: 'https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5?extractor_adapter=browser-1',
    format: 'json',
    source: 'spotify',
    kind: 'document',
    text: /My Path to Spotify/i,
  });
  await submitExtraction({
    url: 'https://mastodon.social/@trwnh/99664077509711321?extractor_adapter=browser-1',
    format: 'json',
    source: 'mastodon',
    kind: 'document',
    text: /Mastodon Flat CSS/i,
  });
  await submitExtraction({
    url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173',
    format: 'json',
    source: 'tiktok',
    kind: 'document',
    text: /Scramble up ur name/i,
  });
  await submitExtraction({
    url: 'https://www.instagram.com/p/DbbY9pdm6Q2/',
    format: 'json',
    source: 'instagram',
    kind: 'document',
    text: /Instagram post/i,
  });
  await submitExtraction({
    url: 'https://www.instagram.com/instagram/',
    format: 'json',
    source: 'instagram',
    kind: 'feed',
    text: /"source": "instagram"/,
  });
  await submitExtraction({
    url: 'https://www.allbirds.com/products/mens-cruiser-shadow-blue-natural-white-sole',
    format: 'json',
    source: 'shopify',
    kind: 'document',
    text: /Men's Cruiser/,
  });
  await submitExtraction({
    url: 'https://www.allbirds.com/',
    format: 'json',
    source: 'shopify',
    kind: 'feed',
    text: /"source": "shopify"/,
  });
  await submitExtraction({
    url: 'https://www.amazon.de/echo-dot-2022/dp/B09B8X9RGM',
    format: 'json',
    source: 'amazon',
    kind: 'document',
    text: /Echo Dot/i,
  });

  const contentRoutes = [
    '/amazon/', '/bluesky/', '/instagram/', '/mastodon/', '/shopify/', '/soundcloud/', '/spotify/', '/tiktok/', '/vimeo/',
    '/docs/api/', '/docs/sources/', '/docs/limitations/', '/pricing/',
    '/alternatives/', '/blog/',
    ...alternativePages.map((item) => `/alternatives/${item.slug}/`),
    ...platformArticles.map((item) => `/blog/${item.slug}/`),
  ];
  for (const route of contentRoutes) {
    const response = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200, `${route} returned HTTP ${response?.status()}`);
    await page.locator('h1').waitFor();
    await assertNoHorizontalOverflow(route);
  }

  for (const route of ['/amazon/', '/bluesky/', '/instagram/', '/mastodon/', '/reddit/', '/shopify/', '/soundcloud/', '/spotify/', '/tiktok/', '/vimeo/', '/x/', '/youtube/']) {
    const response = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200, `${route} returned HTTP ${response?.status()}`);
    assert.equal(await page.locator('#capabilities-heading').count(), 1, `${route} is missing its capabilities section`);
  }

  const sitemapResponse = await page.request.get(`${origin}/sitemap.xml`);
  assert.equal(sitemapResponse.status(), 200, '/sitemap.xml is unavailable');
  assert.match(sitemapResponse.headers()['content-type'] || '', /^application\/xml/i);
  const sitemap = await sitemapResponse.text();
  assert.equal((sitemap.match(/<loc>/g) || []).length, 40, 'Sitemap does not contain every public page');
  for (const route of contentRoutes) {
    assert.ok(sitemap.includes(`${origin}${route}`), `${route} is missing from sitemap.xml`);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await assertNoHorizontalOverflow('mobile homepage');
  const sourceRail = page.locator('.method-card').first().locator('..');
  const railDimensions = await sourceRail.evaluate((element) => ({
    viewport: element.clientWidth,
    content: element.scrollWidth,
  }));
  assert.ok(railDimensions.content > railDimensions.viewport, 'Mobile source cards are not horizontally scrollable');
  const submitWidth = await page.locator('#extract-form button[type="submit"]').evaluate((element) => element.getBoundingClientRect().width);
  const formWidth = await page.locator('#extract-form').evaluate((element) => element.getBoundingClientRect().width);
  assert.ok(submitWidth >= formWidth - 2, 'Mobile submit button does not span the form width');

  assert.deepEqual(browserErrors, [], `Chromium reported errors:\n${browserErrors.join('\n')}`);
  process.stdout.write('Chromium production smoke passed: extraction adapters, alternatives, all platform articles, sitemap.xml, docs, pricing, and desktop/mobile layouts.\n');
} finally {
  await context.close();
  await browser.close();
}
