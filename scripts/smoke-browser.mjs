import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { chromium } from 'playwright';
import { alternativePages, platformArticles } from '../src/features/marketing/content.ts';

const origin = (process.env.EXTRACTOR_ORIGIN || 'https://extractor.mcb-software.workers.dev').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  colorScheme: 'light',
});
const page = await context.newPage();
const mcpClient = new Client({ name: 'extractor-production-smoke', version: '1.0.0' });
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

async function submitExtraction({ url, format, source, type, text }) {
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
    assert.equal(background, 'rgb(255, 255, 255)', 'Shiki JSON preview does not use a white background');
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

try {
  // Static asset caches can briefly retain the previous homepage immediately
  // after a Worker deployment. A unique query verifies the newly deployed
  // production asset instead of accidentally testing the preceding version.
  const homeUrl = new URL('/', origin);
  homeUrl.searchParams.set('smoke', Date.now().toString());
  const home = await page.goto(homeUrl.toString(), { waitUntil: 'networkidle' });
  assert.equal(home?.status(), 200);
  await page.locator('#extract-form').waitFor();
  assert.equal(await page.locator('input[name="format"][value="json"]').isChecked(), true, 'JSON is not the default website output');
  assert.equal(await page.locator('.method-card').count(), 15);
  assert.equal(await page.locator('footer a[href="/alternatives/"]').count(), 1, 'Alternatives footer link is missing');
  assert.equal(await page.locator('footer a[href="/blog/"]').count(), 1, 'Blog footer link is missing');
  const footerLinks = page.locator('footer nav a');
  const dlvrLink = footerLinks.last();
  assert.equal(await dlvrLink.getAttribute('href'), 'https://dlvr.sh', 'dlvr.sh is not the final footer link');
  assert.equal(await dlvrLink.getAttribute('target'), '_blank', 'dlvr.sh is not marked as an external link');
  assert.equal(await dlvrLink.locator('svg').count(), 1, 'dlvr.sh external-link icon is missing');
  assert.equal(await dlvrLink.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(0, 0, 0)', 'dlvr.sh footer link does not have a black background');
  assert.equal(await page.locator('a[href="/docs/mcp/"]').count() > 0, true, 'Hosted MCP documentation link is missing');
  assert.equal(await page.locator('#mcp pre code').textContent(), `${origin}/mcp`);
  for (const card of await page.locator('.method-card').all()) {
    assert.equal(await card.locator('svg').count(), 2, 'A source card is missing its platform or arrow icon');
    const arrowBox = await card.locator('svg').last().boundingBox();
    assert.ok(arrowBox && arrowBox.width >= 20 && arrowBox.height >= 20, 'A source card arrow is not visible');
  }
  const amazonIcon = page.locator('.method-card[href="/amazon/"] svg').first();
  assert.equal(await amazonIcon.getAttribute('data-brand-icon'), 'amazon', 'Amazon card does not use its inline SVG brand logo');
  assert.deepEqual(await amazonIcon.locator('path').evaluateAll((paths) => paths.map((path) => path.getAttribute('fill'))), ['#f90', '#000'], 'Amazon logo does not use its black and orange artwork');
  const instagramIcon = page.locator('.method-card[href="/instagram/"] svg').first();
  assert.equal(await instagramIcon.getAttribute('data-brand-icon'), 'instagram', 'Instagram card does not use its inline SVG brand logo');
  assert.equal(await instagramIcon.locator('defs stop').count(), 3, 'Instagram logo gradient is missing');
  const worksWith = page.locator('[aria-labelledby="extract-heading"] > #works-with');
  assert.equal(await worksWith.getByText('Works with:').count(), 1, 'Works with label is missing from the extraction card');
  assert.equal(await worksWith.locator('a').count(), 15, 'Works with row does not list every supported platform');
  assert.equal(await worksWith.locator('a svg').count(), 15, 'A Works with platform is missing its SVG icon');
  assert.equal(await worksWith.locator('a[href="/amazon/"] [data-brand-icon="amazon"]').count(), 1, 'Works with row has the wrong Amazon artwork');
  assert.equal(await worksWith.locator('a[href="/instagram/"] [data-brand-icon="instagram"]').count(), 1, 'Works with row has the wrong Instagram artwork');
  await assertNoHorizontalOverflow('desktop homepage');

  const serverCardResponse = await page.request.get(`${origin}/.well-known/mcp/server-card.json`);
  assert.equal(serverCardResponse.status(), 200, 'MCP Server Card is unavailable');
  const serverCard = await serverCardResponse.json();
  assert.equal(serverCard.serverInfo?.name, 'extractor.sh');
  assert.equal(serverCard.transport?.endpoint, `${origin}/mcp`);
  assert.equal(serverCard.capabilities?.tools, true);

  await mcpClient.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)));
  const tools = await mcpClient.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ['extract_public_url']);
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
    url: 'https://apps.apple.com/us/app/chatgpt/id6448311069',
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
    url: 'https://www.reddit.com/r/CloudFlare/',
    format: 'json',
    source: 'reddit',
    type: 'feed',
    text: /"source": "reddit"/,
  });
  await submitExtraction({
    url: 'https://www.youtube.com/@Cloudflare',
    format: 'json',
    source: 'youtube',
    type: 'feed',
    text: /"source": "youtube"/,
  });

  const contentRoutes = [
    '/amazon/', '/app-store/', '/bluesky/', '/google-news/', '/google-play/', '/instagram/', '/mastodon/', '/shopify/', '/soundcloud/', '/spotify/', '/tiktok/', '/vimeo/',
    '/docs/mcp/', '/docs/api/', '/docs/schema/', '/docs/sources/', '/docs/limitations/', '/pricing/',
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

  for (const route of ['/amazon/', '/app-store/', '/bluesky/', '/google-news/', '/google-play/', '/instagram/', '/mastodon/', '/reddit/', '/shopify/', '/soundcloud/', '/spotify/', '/tiktok/', '/vimeo/', '/x/', '/youtube/']) {
    const response = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle' });
    assert.equal(response?.status(), 200, `${route} returned HTTP ${response?.status()}`);
    assert.equal(await page.locator('#capabilities-heading').count(), 1, `${route} is missing its capabilities section`);
  }

  const sitemapResponse = await page.request.get(`${origin}/sitemap.xml`);
  assert.equal(sitemapResponse.status(), 200, '/sitemap.xml is unavailable');
  assert.match(sitemapResponse.headers()['content-type'] || '', /^application\/xml/i);
  const sitemap = await sitemapResponse.text();
  assert.equal((sitemap.match(/<loc>/g) || []).length, 48, 'Sitemap does not contain every public page');
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
  await mcpClient.close().catch(() => {});
  await context.close();
  await browser.close();
}
