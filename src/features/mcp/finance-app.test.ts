import { describe, expect, it } from 'vitest';
import {
  FINANCE_APP_HTML,
  FINANCE_APP_MIME_TYPE,
  FINANCE_APP_RESOURCE_META,
  FINANCE_APP_URI,
  financeToolResult,
  parseFinanceStructuredContent,
} from './finance-app';

const publicMarketResult = {
  schemaVersion: 1 as const,
  type: 'document' as const,
  source: 'finance' as const,
  id: 'AAPL',
  url: 'https://extractor.sh/api/finance?symbol=AAPL&format=json',
  title: 'Apple Inc. (AAPL)',
  author: null,
  publishedAt: '2026-08-05T14:00:00.000Z',
  content: '# Apple Inc. (AAPL)',
  media: [],
  attributes: {
    tickerSymbol: 'AAPL',
    currency: 'USD',
    marketPrice: 205.4,
    previousClose: 202.1,
    change: 3.3,
    changePercent: 1.632855,
    historyTimeframe: '1mo' as const,
    historyInterval: '1d' as const,
    history: [
      { timestamp: '2026-08-04T14:00:00.000Z', close: 202.1 },
      { timestamp: '2026-08-05T14:00:00.000Z', close: 205.4 },
    ],
  },
};

describe('finance MCP App', () => {
  it('serves one self-contained, deny-by-default MCP Apps resource', () => {
    expect(FINANCE_APP_URI).toMatch(/^ui:\/\//);
    expect(FINANCE_APP_MIME_TYPE).toBe('text/html;profile=mcp-app');
    expect(FINANCE_APP_RESOURCE_META.ui.csp).toEqual({
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [],
      baseUriDomains: [],
    });
    expect(FINANCE_APP_HTML).toContain('ui/initialize');
    expect(FINANCE_APP_HTML).toContain('Price trend');
    expect(FINANCE_APP_HTML).not.toMatch(/<script[^>]+src=/i);
    expect(FINANCE_APP_HTML).not.toMatch(/<link[^>]+rel=["']stylesheet/i);
    expect(FINANCE_APP_HTML).not.toContain('query1.finance.yahoo.com');
  });

  it('passes valid public schema-v1 finance data as structured content', () => {
    const text = JSON.stringify(publicMarketResult);
    const structured = parseFinanceStructuredContent(text);
    expect(structured).toEqual(publicMarketResult);
    expect(financeToolResult(text, structured)).toEqual({
      content: [{ type: 'text', text }],
      structuredContent: publicMarketResult,
    });
  });

  it('does not expose malformed or non-finance cached bodies to the chart', () => {
    expect(parseFinanceStructuredContent('{broken')).toBeUndefined();
    expect(parseFinanceStructuredContent(JSON.stringify({
      ...publicMarketResult,
      source: 'web',
    }))).toBeUndefined();
    expect(parseFinanceStructuredContent(JSON.stringify({
      ...publicMarketResult,
      method: 'internal-transport',
    }))).toBeUndefined();
  });
});
