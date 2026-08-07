import puppeteer from '@cloudflare/puppeteer';
import {
  assertNoAccessInterstitial,
  ExtractionError,
  sourceResponseError,
  validateTargetUrl,
} from '@extractor/core';

const BROWSER_TIMEOUT_MS = 12_000;
const NETWORK_SETTLE_TIMEOUT_MS = 2_000;
const CLIENT_RENDER_SETTLE_TIMEOUT_MS = 4_000;
const CLIENT_RENDER_STABILITY_MS = 500;
const BROWSER_CLOSE_TIMEOUT_MS = 1_000;
const MAX_RENDERED_BYTES = 5 * 1024 * 1024;

const UNNEEDED_RESOURCE_TYPES = new Set(['font', 'image', 'media']);
const CLIENT_ROOT_SELECTORS = [
  '#__next', '#__nuxt', '#root', '#app', '[data-reactroot]', '[data-v-app]',
  '[data-server-rendered]', 'app-root', 'main', '[role="main"]', 'body',
];

export function alignedBrowserUserAgent(originalUserAgent: string, browserVersion: string): string {
  const version = browserVersion.match(/(?:HeadlessChrome|Chrome)\/([\d.]+)/i)?.[1];
  if (!version) return originalUserAgent;
  return originalUserAgent.replace(/HeadlessChrome\/[\d.]+/i, `Chrome/${version}`);
}

/** Select the public DOM root whose content should settle after hydration. */
export function clientRenderRootSelector(document: Pick<Document, 'querySelector'>): string {
  return CLIENT_ROOT_SELECTORS.find((selector) => document.querySelector(selector)) ?? 'body';
}

function rootSnapshot(selectors: string[]) {
  for (const selector of selectors) {
    const root = document.querySelector(selector);
    if (root) return { selector, text: (root as HTMLElement).innerText ?? root.textContent ?? '' };
  }
  return { selector: 'body', text: document.body?.innerText ?? '' };
}

function meaningfulText(value: string): boolean {
  return value.replace(/\s+/g, ' ').trim().length >= 80;
}

function numericErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as Record<string, unknown>;
  for (const key of ['status', 'statusCode', 'code']) {
    const value = record[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value)) return Number(value);
  }
  return null;
}

export function normalizeBrowserRunError(error: unknown, browserStarted: boolean): ExtractionError {
  if (error instanceof ExtractionError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const status = numericErrorStatus(error);
  if (
    status === 429
    || /(?:too many requests|browser time limit exceeded|unable to create new browser[^\n]*429|browser acquisition[^\n]*limit)/i.test(message)
  ) {
    return new ExtractionError(
      'rate_limited',
      'High-cost extraction capacity is temporarily exhausted. Try again shortly.',
      429,
      20,
    );
  }
  if (/timeout/i.test(message)) {
    return new ExtractionError('timeout', 'The source did not finish loading within 12 seconds.', 504);
  }
  if (/ERR_NAME_NOT_RESOLVED/i.test(message)) {
    return new ExtractionError('upstream_error', 'The source hostname could not be resolved.', 502);
  }
  if (/ERR_CONNECTION_REFUSED/i.test(message)) {
    return new ExtractionError('upstream_error', 'The source refused the connection.', 502);
  }
  if (/ERR_CONNECTION_(?:TIMED_OUT|CLOSED|RESET)|ERR_TIMED_OUT/i.test(message)) {
    return new ExtractionError('timeout', 'The connection to the source timed out.', 504);
  }
  if (/ERR_TOO_MANY_REDIRECTS/i.test(message)) {
    return new ExtractionError('upstream_error', 'The source redirected too many times.', 502);
  }
  if (/ERR_CERT_/i.test(message)) {
    return new ExtractionError('upstream_error', 'The source has an invalid or unsupported TLS certificate.', 502);
  }
  if (/(?:protocol error|target closed|browser closed|session closed|connection closed)/i.test(message)) {
    return new ExtractionError('upstream_error', 'A required extraction service ended unexpectedly.', 502);
  }
  if (!browserStarted) {
    return new ExtractionError('upstream_error', 'A required extraction service is temporarily unavailable.', 502);
  }
  return new ExtractionError('extraction_failed', 'The source loaded, but its content could not be extracted.', 422);
}

async function closeBrowserWithinDeadline(
  browser: Awaited<ReturnType<typeof puppeteer.launch>>,
): Promise<void> {
  // Browser cleanup has occasionally stalled after a failed navigation. Do not
  // keep the API request—and the billable browser session—open indefinitely.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      browser.close(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, BROWSER_CLOSE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // Cleanup must not replace the extraction result or its error.
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function renderPageHtml(url: URL, binding: BrowserRun): Promise<string> {
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;

  try {
    browser = await puppeteer.launch(binding);
    const page = await browser.newPage();
    // Keep the browser's real platform and Chromium version. Removing only the
    // HeadlessChrome token avoids stale, internally inconsistent identities;
    // it does not add cookies, credentials, stealth patches, or challenge work.
    try {
      const [originalUserAgent, browserVersion] = await Promise.all([
        browser.userAgent(),
        browser.version(),
      ]);
      const userAgent = alignedBrowserUserAgent(originalUserAgent, browserVersion);
      if (userAgent !== originalUserAgent) await page.setUserAgent(userAgent);
    } catch {
      // Identity normalization is optional; the managed browser default is safe.
    }
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      // Extraction needs DOM text, not visual assets. Blocking these resource
      // types reduces transfer, page activity, and billable session duration.
      if (UNNEEDED_RESOURCE_TYPES.has(request.resourceType())) {
        void request.abort('blockedbyclient');
        return;
      }

      const requestUrl = request.url();
      if (requestUrl.startsWith('data:') || requestUrl.startsWith('blob:')) {
        void request.continue();
        return;
      }

      try {
        validateTargetUrl(requestUrl);
        void request.continue();
      } catch {
        void request.abort('blockedbyclient');
      }
    });

    const response = await page.goto(url.toString(), {
      // Modern pages often keep analytics and streaming requests open forever.
      // DOMContentLoaded gives scripts a document without waiting for all
      // background traffic to finish.
      waitUntil: 'domcontentloaded',
      timeout: BROWSER_TIMEOUT_MS,
    });

    if (!response) {
      throw new ExtractionError(
        'upstream_error',
        'The source did not return an HTTP response.',
        502,
      );
    }

    if (!response.ok()) {
      const status = response.status();
      if (status === 404 || status === 410) {
        throw new ExtractionError('not_found', `The source was not found (HTTP ${status}).`, 404);
      }
      throw sourceResponseError(status);
    }

    const initialRoot = await page.evaluate(rootSnapshot, CLIENT_ROOT_SELECTORS).catch(() => ({ selector: 'body', text: '' }));

    try {
      // Give client-rendered content a short opportunity to settle. A timeout
      // here is intentionally non-fatal because the current DOM may be useful.
      await page.waitForNetworkIdle({
        concurrency: 2,
        idleTime: 500,
        timeout: NETWORK_SETTLE_TIMEOUT_MS,
      });
    } catch {
      // Long-lived requests are common; the loaded DOM is still useful.
    }

    let renderedRoot = await page.evaluate(rootSnapshot, CLIENT_ROOT_SELECTORS).catch(() => initialRoot);
    try {
      // React, Vue, Next, and Nuxt all hydrate a stable application root. A
      // body-level change is too broad: analytics banners can arrive before
      // the actual application data. Wait only for the selected root to gain
      // meaningful content, then sample it again to avoid serializing a
      // transient loading state.
      if (
        renderedRoot.selector === initialRoot.selector
        && renderedRoot.text === initialRoot.text
        && renderedRoot.selector !== 'body'
      ) {
        await page.waitForFunction(
          ({ selector, initialText }) => {
            const root = document.querySelector(selector);
            const current = (root as HTMLElement | null)?.innerText ?? root?.textContent ?? '';
            return current !== initialText && current.replace(/\s+/g, ' ').trim().length >= 80;
          },
          { timeout: CLIENT_RENDER_SETTLE_TIMEOUT_MS, polling: 250 },
          { selector: renderedRoot.selector, initialText: renderedRoot.text },
        );
        renderedRoot = await page.evaluate(rootSnapshot, CLIENT_ROOT_SELECTORS).catch(() => renderedRoot);
      }
      if (meaningfulText(renderedRoot.text)) {
        await new Promise((resolve) => setTimeout(resolve, CLIENT_RENDER_STABILITY_MS));
        const afterStability = await page.evaluate(rootSnapshot, CLIENT_ROOT_SELECTORS).catch(() => renderedRoot);
        if (afterStability.selector === renderedRoot.selector && afterStability.text !== renderedRoot.text) {
          // One additional quiet interval captures a final hydration update
          // without extending the bounded wait into an open-ended poll.
          await new Promise((resolve) => setTimeout(resolve, CLIENT_RENDER_STABILITY_MS));
        }
      }
    } catch {
      // The current DOM may already be complete or the application may be
      // static. Extraction below decides whether it is useful.
    }

    const html = await page.content();
    if (new TextEncoder().encode(html).byteLength > MAX_RENDERED_BYTES) {
      throw new ExtractionError('content_too_large', 'The processed page is larger than 5 MB.', 413);
    }
    assertNoAccessInterstitial(html);

    return html;
  } catch (error) {
    throw normalizeBrowserRunError(error, Boolean(browser));
  } finally {
    if (browser) await closeBrowserWithinDeadline(browser);
  }
}
