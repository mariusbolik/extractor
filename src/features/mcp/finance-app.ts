import {
  ExtractionResponseSchema,
  type PublicExtractionResult,
} from '@extractor/core';
import financeChartHtml from './apps/generated/index.html?raw';

export const FINANCE_APP_URI = 'ui://extractor.sh/finance/price-chart-v1.html';
export const FINANCE_APP_MIME_TYPE = 'text/html;profile=mcp-app';
export const FINANCE_APP_HTML = financeChartHtml;

export const FINANCE_APP_RESOURCE_META = {
  ui: {
    csp: {
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [],
      baseUriDomains: [],
    },
    // The chart draws its own square black boundary.
    prefersBorder: false,
  },
} as const;

/** Parse only public schema-v1 data; never pass cached error bodies to a View. */
export function parseFinanceStructuredContent(text: string): PublicExtractionResult | undefined {
  try {
    const parsed = ExtractionResponseSchema.safeParse(JSON.parse(text));
    if (!parsed.success || parsed.data.source !== 'finance' || parsed.data.type !== 'document') return undefined;
    return parsed.data as PublicExtractionResult;
  } catch {
    return undefined;
  }
}

export function financeToolResult(text: string, structuredContent?: PublicExtractionResult) {
  return {
    content: [{ type: 'text' as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}
