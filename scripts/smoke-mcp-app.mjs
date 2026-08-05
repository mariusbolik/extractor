import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const html = await readFile(new URL('../src/features/mcp/apps/generated/index.html', import.meta.url), 'utf8');
const market = {
  schemaVersion: 1,
  type: 'document',
  source: 'finance',
  id: 'AAPL',
  url: 'https://extractor.sh/api/finance?symbol=AAPL&format=json',
  title: 'Apple Inc. (AAPL)',
  author: null,
  publishedAt: '2026-08-05T14:00:00.000Z',
  content: '# Apple Inc. (AAPL)',
  media: [],
  attributes: {
    tickerSymbol: 'AAPL',
    exchange: 'Nasdaq',
    marketState: 'REGULAR',
    currency: 'USD',
    marketPrice: 205.4,
    previousClose: 202.1,
    change: 3.3,
    changePercent: 1.632855,
    dayLow: 201.2,
    dayHigh: 206.8,
    fiftyTwoWeekLow: 164.08,
    fiftyTwoWeekHigh: 237.49,
    volume: 51_400_000,
    historyTimeframe: '1mo',
    historyInterval: '1d',
    history: [
      { timestamp: '2026-08-01T14:00:00.000Z', close: 198.2 },
      { timestamp: '2026-08-02T14:00:00.000Z', close: 201.7 },
      { timestamp: '2026-08-03T14:00:00.000Z', close: 200.1 },
      { timestamp: '2026-08-04T14:00:00.000Z', close: 202.1 },
      { timestamp: '2026-08-05T14:00:00.000Z', close: 205.4 },
    ],
  },
};
const toolResult = {
  content: [{ type: 'text', text: JSON.stringify(market) }],
  structuredContent: market,
};

async function renderAt(browser, viewport) {
  const context = await browser.newContext({ viewport, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript((result) => {
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!message || message.jsonrpc !== '2.0') return;
      if (message.method === 'ui/initialize' && message.id !== undefined) {
        window.postMessage({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: '2026-01-26',
            hostInfo: { name: 'extractor-local-smoke', version: '1.0.0' },
            hostCapabilities: {},
            hostContext: { theme: 'light', platform: viewport.width < 500 ? 'mobile' : 'web' },
          },
        }, '*');
      }
      if (message.method === 'ui/notifications/initialized') {
        window.postMessage({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: result,
        }, '*');
      }
    });
  }, toolResult);
  await page.route('https://mcp-finance-app.test/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: html,
  }));
  await page.goto('https://mcp-finance-app.test/');
  await page.locator('#chart-section').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#instrument').textContent(), 'Apple Inc. (AAPL)');
  assert.match(await page.locator('#price').textContent() || '', /205[.,]4 USD/);
  assert.ok((await page.locator('#line').getAttribute('d'))?.startsWith('M '));
  assert.equal(await page.locator('html').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);

  await page.locator('#chart-hitbox').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.locator('#tooltip').isVisible(), true);
  assert.match(await page.locator('#tooltip-price').textContent() || '', /202[.,]1 USD/);
  assert.deepEqual(errors, []);
  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await renderAt(browser, { width: 820, height: 720 });
  await renderAt(browser, { width: 390, height: 720 });
  process.stdout.write('MCP finance App smoke passed at desktop and mobile widths.\n');
} finally {
  await browser.close();
}
