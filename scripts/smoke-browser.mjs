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
  const heroBadge = page.locator('[data-hero-badge]');
  assert.equal(await heroBadge.count(), 1, 'Hero badge is missing');
  assert.equal(await heroBadge.getByText('Free', { exact: true }).count(), 1, 'Hero badge does not show the free offer');
  assert.equal(await heroBadge.getByText('No account needed', { exact: true }).count(), 1, 'Hero badge does not explain that no account is needed');
  assert.notEqual(await heroBadge.locator('svg').evaluate((element) => getComputedStyle(element).animationName), 'none', 'Hero badge is not animated');
  const formatRadios = page.locator('input[name="format"]');
  assert.equal(await page.locator('#url').getAttribute('placeholder'), 'https://www.amazon.com/dp/B09B8X9RGM', 'Homepage form does not use the Amazon.com placeholder');
  assert.match(await page.locator('#api pre code').textContent() || '', /https:\/\/www\.amazon\.com\/dp\/B09B8X9RGM/, 'Homepage API example does not use Amazon.com');
  assert.equal(await page.locator('input[name="format"][value="json"]').isChecked(), true, 'JSON is not the default website output');
  for (const radio of await formatRadios.all()) {
    const borderRadius = await radio.evaluate((element) => getComputedStyle(element).borderRadius);
    assert.equal(borderRadius, '0px', 'A format radio is not square');
  }
  const supportedSection = page.locator('[aria-labelledby="supported-heading"]');
  const extractorCardBox = await page.locator('[aria-label="URL extractor"]').boundingBox();
  const supportedSectionBox = await supportedSection.boundingBox();
  assert.ok(extractorCardBox && supportedSectionBox, 'Extraction or supported-platform card geometry is unavailable');
  assert.ok(Math.abs(supportedSectionBox.y - (extractorCardBox.y + extractorCardBox.height) - 48) <= 1, 'Extraction and supported-platform cards do not have a 48px gap');
  const platformGrid = supportedSection.locator('#supported-platforms-grid');
  assert.equal(await page.locator('[aria-label="URL extractor"] > #works-with').count(), 0, 'Works with icons are still inside the extraction card');
  assert.equal(await platformGrid.locator(':scope > li').count(), 16, 'Supported platform tile grid is incomplete');
  assert.match(await platformGrid.locator(':scope > li').first().innerText(), /^Works\s+with$/, 'Works with lead tile is missing');
  assert.equal(await platformGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 8, 'Supported platforms do not use an eight-column desktop tile grid');
  assert.equal(await page.locator('.method-card').count(), 15);
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
  assert.equal((await page.locator('footer > span').textContent())?.trim(), '© extractor.sh', 'Footer copyright label is incorrect');
  assert.equal(await page.locator('footer a[href="https://dlvr.sh"]').count(), 0, 'dlvr.sh is still in the footer');
  const dlvrBanner = page.locator('main > [data-dlvr-banner]');
  assert.equal(await dlvrBanner.count(), 1, 'dlvr.sh homepage banner is missing');
  assert.equal(await dlvrBanner.getAttribute('href'), 'https://dlvr.sh', 'dlvr.sh homepage banner has the wrong URL');
  assert.equal(await dlvrBanner.getAttribute('target'), '_blank', 'dlvr.sh homepage banner is not marked as external');
  assert.equal(await dlvrBanner.locator('svg').count(), 1, 'dlvr.sh homepage banner external-link icon is missing');
  assert.equal(await dlvrBanner.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(0, 0, 0)', 'dlvr.sh homepage banner is not black');
  assert.equal(await dlvrBanner.evaluate((element) => getComputedStyle(element).color), 'rgb(255, 255, 255)', 'dlvr.sh homepage banner text is not white');
  assert.equal(await page.locator('a[href="/docs/mcp/"]').count() > 0, true, 'Hosted MCP documentation link is missing');
  assert.equal(await page.locator('#mcp pre code').textContent(), 'https://extractor.sh/mcp');
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
    if (route.startsWith('/alternatives/') && route !== '/alternatives/') {
      const provider = alternativePages.find((item) => route === `/alternatives/${item.slug}/`)?.provider;
      assert.ok(provider && (await page.locator('h1').textContent())?.includes(provider), `${route} does not name the competitor in its H1`);
      assert.equal(await page.locator('main a[href^="http"]').count(), 0, `${route} links to a competitor`);
      assert.equal(await page.locator('[data-extractor-choice]').count(), 1, `${route} is missing the extractor.sh value card`);
      assert.equal(await page.locator('[data-provider-choice]').count(), 1, `${route} is missing the provider-fit card`);
      assert.equal(await page.locator('#advantages-heading').count(), 1, `${route} is missing extractor.sh advantages`);
    }
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
  assert.equal(
    await page.locator('#supported-platforms-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    4,
    'Supported platforms do not use a four-column mobile grid',
  );
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
