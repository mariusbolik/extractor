import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { chromium } from 'playwright';

const origin = (process.env.EXTRACTOR_ORIGIN || 'http://127.0.0.1:4321').replace(/\/$/, '');
const apiKey = process.env.EXTRACTOR_API_KEY?.trim();
const client = new Client({ name: 'extractor-mcp-smoke', version: '1.0.0' });
let browser;

try {
  await client.connect(new StreamableHTTPClientTransport(
    new URL(`${origin}/mcp`),
    apiKey ? { requestInit: { headers: { Authorization: `Bearer ${apiKey}` } } } : undefined,
  ));

  const tools = await client.listTools();
  const financeTool = tools.tools.find((tool) => tool.name === 'get_market_data');
  const stockTool = tools.tools.find((tool) => tool.name === 'search_stocks');
  const moverTool = tools.tools.find((tool) => tool.name === 'get_market_movers');
  const searchTool = tools.tools.find((tool) => tool.name === 'search_web');
  const videoTool = tools.tools.find((tool) => tool.name === 'search_videos');
  const placeTool = tools.tools.find((tool) => tool.name === 'search_places');
  assert.ok(financeTool, 'get_market_data is missing');
  assert.ok(stockTool, 'search_stocks is missing');
  assert.ok(moverTool, 'get_market_movers is missing');
  assert.ok(searchTool, 'search_web is missing');
  assert.ok(videoTool, 'search_videos is missing');
  assert.ok(placeTool, 'search_places is missing');
  assert.equal(tools.tools.some((tool) => tool.name === 'search_maps'), false, 'deprecated search_maps is still exposed');
  assert.deepEqual(tools.tools.map((tool) => tool.name), [
    'extract_public_url', 'search_images', 'search_videos', 'search_places', 'search_web',
    'search_news', 'search_stocks', 'get_market_movers', 'get_market_data',
  ]);
  assert.equal(financeTool._meta?.ui?.resourceUri, 'ui://extractor.sh/finance/price-chart-v1.html');
  assert.equal(financeTool._meta?.['ui/resourceUri'], 'ui://extractor.sh/finance/price-chart-v1.html');

  const resources = await client.listResources();
  const financeResource = resources.resources.find((resource) => resource.uri === financeTool._meta.ui.resourceUri);
  assert.ok(financeResource, 'finance chart resource is missing');
  assert.equal(financeResource.mimeType, 'text/html;profile=mcp-app');

  const resource = await client.readResource({ uri: financeResource.uri });
  const html = resource.contents.find((content) => content.uri === financeResource.uri)?.text;
  assert.ok(html, 'finance chart resource is empty');
  assert.match(html, /Price trend/);
  assert.doesNotMatch(html, /<script[^>]+src=/i);

  const stockResult = await client.callTool({
    name: 'search_stocks',
    arguments: { query: 'Apple', limit: 5, format: 'json' },
  });
  assert.notEqual(stockResult.isError, true, 'search_stocks returned an error');
  assert.equal(stockResult.structuredContent?.type, 'feed');
  assert.ok(stockResult.structuredContent?.items?.some((item) => item.attributes?.tickerSymbol === 'AAPL'));

  const searchResult = await client.callTool({
    name: 'search_web',
    arguments: { query: 'Cloudflare Workers', site: 'cloudflare.com', limit: 3, format: 'json' },
  });
  assert.notEqual(searchResult.isError, true, 'search_web returned an error');
  assert.equal(searchResult.structuredContent?.attributes?.site, 'cloudflare.com');
  assert.ok(searchResult.structuredContent?.items?.every((item) => {
    const hostname = new URL(item.url).hostname;
    return hostname === 'cloudflare.com' || hostname.endsWith('.cloudflare.com');
  }));

  const videoResult = await client.callTool({
    name: 'search_videos',
    arguments: { query: 'Taylor Swift', creator: 'Taylor Swift', limit: 3, language: 'en-US', country: 'US', platform: 'youtube', sort: 'date', format: 'json' },
  });
  assert.notEqual(videoResult.isError, true, 'search_videos returned an error');
  assert.equal(videoResult.structuredContent?.schemaVersion, 1);
  assert.equal(videoResult.structuredContent?.source, 'video-search');
  assert.equal(videoResult.structuredContent?.type, 'feed');
  assert.equal(videoResult.structuredContent?.attributes?.videoPlatform, 'youtube');
  assert.equal(videoResult.structuredContent?.attributes?.videoSort, 'date');
  assert.equal(videoResult.structuredContent?.attributes?.videoCreator, 'Taylor Swift');
  assert.ok(videoResult.structuredContent?.items?.length > 0);
  assert.ok(videoResult.structuredContent?.items?.every((item) => /(?:^|\.)youtube\.com$|^youtu\.be$/.test(new URL(item.url).hostname)));
  assert.ok(videoResult.structuredContent?.items?.every((item) => item.author === 'Taylor Swift'));

  const placeResult = await client.callTool({
    name: 'search_places',
    arguments: { query: 'coffee Berlin', limit: 3, language: 'en', country: 'DE', lat: 52.52, lon: 13.405, format: 'json' },
  });
  assert.notEqual(placeResult.isError, true, 'search_places returned an error');
  assert.equal(placeResult.structuredContent?.schemaVersion, 1);
  assert.equal(placeResult.structuredContent?.source, 'place-search');
  assert.equal(placeResult.structuredContent?.type, 'feed');
  assert.ok(placeResult.structuredContent?.items?.length > 0);

  const moverResult = await client.callTool({
    name: 'get_market_movers',
    arguments: { list: 'gainers', limit: 3, format: 'json' },
  });
  assert.notEqual(moverResult.isError, true, 'get_market_movers returned an error');
  assert.equal(moverResult.structuredContent?.schemaVersion, 1);
  assert.equal(moverResult.structuredContent?.source, 'finance');
  assert.equal(moverResult.structuredContent?.type, 'feed');
  assert.equal(moverResult.structuredContent?.attributes?.financeMoverList, 'gainers');
  assert.ok(moverResult.structuredContent?.items?.length > 0);

  const result = await client.callTool({
    name: 'get_market_data',
    arguments: { symbol: 'AAPL', timeframe: '1mo', quote: 'EUR', format: 'json' },
  });
  const errorText = result.content.find((item) => item.type === 'text')?.text || 'unknown tool error';
  assert.notEqual(result.isError, true, `get_market_data returned an error: ${errorText}`);
  assert.equal(result.structuredContent?.schemaVersion, 1);
  assert.equal(result.structuredContent?.source, 'finance');
  assert.equal(result.structuredContent?.type, 'document');
  assert.equal(result.structuredContent?.attributes?.tickerSymbol, 'AAPL');
  assert.equal(result.structuredContent?.attributes?.currency, 'EUR');
  assert.equal(result.structuredContent?.attributes?.quoteCurrency, 'EUR');
  assert.ok(Array.isArray(result.structuredContent?.attributes?.history));

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 820, height: 720 }, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript((toolResult) => {
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      if (message.method === 'ui/initialize' && message.id !== undefined) {
        window.postMessage({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2026-01-26',
            hostInfo: { name: 'extractor-mcp-smoke', version: '1.0.0' },
            hostCapabilities: {},
            hostContext: { theme: 'light', platform: 'web' },
          },
        }, '*');
      }
      if (message.method === 'ui/notifications/initialized') {
        window.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: toolResult }, '*');
      }
    });
  }, result);
  await page.route('https://mcp-finance-app.test/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: html,
  }));
  await page.goto('https://mcp-finance-app.test/');
  await page.locator('#chart-section').waitFor({ state: 'visible' });
  assert.match(await page.locator('#instrument').textContent() || '', /AAPL|Apple/i);
  assert.ok((await page.locator('#line').getAttribute('d'))?.startsWith('M '));
  assert.equal(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
  assert.deepEqual(errors, []);
  await context.close();

  process.stdout.write(`MCP initialize, site-restricted web search, creator video search, place search, stock search, market movers, converted market tool call, resource read, and rendered finance chart passed for ${origin}.\n`);
} finally {
  await browser?.close().catch(() => {});
  await client.close().catch(() => {});
}
