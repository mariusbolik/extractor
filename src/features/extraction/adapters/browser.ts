import puppeteer from '@cloudflare/puppeteer';
import { ExtractionError, sourceResponseError } from '../errors';
import { validateTargetUrl } from '../url';

const BROWSER_TIMEOUT_MS = 12_000;
const NETWORK_SETTLE_TIMEOUT_MS = 2_000;
const BROWSER_CLOSE_TIMEOUT_MS = 1_000;
const MAX_RENDERED_BYTES = 5 * 1024 * 1024;

const UNNEEDED_RESOURCE_TYPES = new Set(['font', 'image', 'media']);

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
        'Browser navigation did not receive an HTTP response from the source.',
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

    const html = await page.content();
    if (new TextEncoder().encode(html).byteLength > MAX_RENDERED_BYTES) {
      throw new ExtractionError('content_too_large', 'The rendered page is larger than 5 MB.', 413);
    }

    return html;
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    if (error instanceof Error && /timeout/i.test(error.message)) {
      throw new ExtractionError('timeout', 'The source did not finish loading within 12 seconds.', 504);
    }
    if (error instanceof Error && /ERR_NAME_NOT_RESOLVED/i.test(error.message)) {
      throw new ExtractionError('upstream_error', 'The source hostname could not be resolved.', 502);
    }
    if (error instanceof Error && /ERR_CONNECTION_REFUSED/i.test(error.message)) {
      throw new ExtractionError('upstream_error', 'The source refused the browser connection.', 502);
    }
    if (error instanceof Error && /ERR_CONNECTION_(?:TIMED_OUT|CLOSED|RESET)|ERR_TIMED_OUT/i.test(error.message)) {
      throw new ExtractionError('timeout', 'The browser connection to the source timed out.', 504);
    }
    if (error instanceof Error && /ERR_TOO_MANY_REDIRECTS/i.test(error.message)) {
      throw new ExtractionError('upstream_error', 'The source redirected the browser too many times.', 502);
    }
    if (error instanceof Error && /ERR_CERT_/i.test(error.message)) {
      throw new ExtractionError('upstream_error', 'The source has an invalid or unsupported TLS certificate.', 502);
    }
    if (!browser) {
      throw new ExtractionError('upstream_error', 'Browser rendering is temporarily unavailable.', 502);
    }
    throw new ExtractionError('extraction_failed', 'The source loaded, but its content could not be extracted.', 422);
  } finally {
    if (browser) await closeBrowserWithinDeadline(browser);
  }
}
