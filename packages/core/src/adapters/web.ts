import { ExtractionError } from '../errors';
import { assertNoAccessInterstitial } from '../access-interstitial';
import { fetchPublicPage } from '../fetch';
import { extractMarkdownFromHtml, markdownWordCount } from '../markdown';
import type { ExtractionDependencies, ExtractionResult } from '../types';
import { parseHTML } from 'linkedom';
import { extractBlogListingFromHtml } from './blog-listing';
import { extractDiscoveredAlternative, extractInferredFeedAlternative } from './discovery';
import { extractProductDetailFromHtml } from './product-detail';
import { extractProductListingFromHtml } from './product-listing';
import { extractShopifyStorefront } from './shopify';
import { extractWooCommerceStorefront } from './woocommerce';

const MIN_MARKDOWN_LENGTH = 40;
const MAX_TEMPLATE_EXPRESSION_LENGTH = 2_000;

function mediaType(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() || '';
}

function isHtmlType(type: string): boolean {
  return type === 'text/html' || type === 'application/xhtml+xml';
}

function isPlainTextType(type: string): boolean {
  return type === 'text/markdown' || type === 'text/x-markdown' || type === 'text/plain';
}

function looksLikeHtml(body: string): boolean {
  return /^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(body);
}

function hasClientRenderingSignals(body: string): boolean {
  // Browser Rendering is the expensive fallback. Only a JavaScript entrypoint
  // plus a recognizable application mount/custom element makes another load
  // likely to reveal content that is absent from the server response.
  return /<script\b/i.test(body)
    && /(?:<script\b[^>]*\bsrc\s*=|\bid\s*=\s*["'](?:app|root|__next|__nuxt)["']|\bdata-(?:reactroot|server-rendered)\b|<[^>]+-[^>]+>)/i.test(body);
}

function stripUnresolvedTemplateExpressions(html: string): string {
  return html.replace(new RegExp(`\\{\\{[^{}]{1,${MAX_TEMPLATE_EXPRESSION_LENGTH}}\\}\\}`, 'g'), '');
}

function unresolvedTemplatesDominate(markdown: string): boolean {
  const expression = new RegExp(`\\{\\{[^{}]{1,${MAX_TEMPLATE_EXPRESSION_LENGTH}}\\}\\}`, 'g');
  if (!expression.test(markdown)) return false;
  return markdownWordCount(markdown.replace(expression, '')) < 20;
}

function navigationShellDominates(html: string, markdown: string): boolean {
  const { document } = parseHTML(html);
  const links = document.querySelectorAll('a[href]').length;
  if (links < 15) return false;

  const primary = document.querySelector('main, article, [role="main"]');
  if (primary) {
    const clone = primary.cloneNode(true) as Element;
    clone.querySelectorAll('nav, header, footer, aside, form, button, script, style, template')
      .forEach((node) => node.remove());
    if (markdownWordCount(clone.textContent ?? '') < 30) return true;
  }

  // Client applications sometimes omit a main landmark entirely. A large
  // menu with no content headings is still an app shell even though generic
  // readability scores its many link labels as a substantial article.
  const headings = markdown.match(/^#{1,6}\s+/gm)?.length ?? 0;
  const withoutLinks = markdown.replace(/!?\[[^\]]*\]\([^\s)]+(?:\s+"[^"]*")?\)/g, '');
  return headings <= 1 && markdownWordCount(withoutLinks) < 160;
}

function titleFromMarkdown(markdown: string): string | null {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() || null;
}

export async function extractWebPage(
  url: URL,
  dependencies: ExtractionDependencies,
): Promise<ExtractionResult> {
  const fetcher = dependencies.fetcher ?? fetch;
  let fetchedUrl = url.toString();
  let directError: unknown;
  let shouldUseBrowser = false;
  let sourceHtml = '';
  let sourceLinkHeader: string | null = null;

  try {
    const page = await fetchPublicPage(url, fetcher);
    fetchedUrl = page.url;
    sourceHtml = page.body;
    sourceLinkHeader = page.linkHeader;
    const type = mediaType(page.contentType);

    if (isPlainTextType(type)) {
      const content = page.body.trim();
      // Rendering cannot add content to a text response, so short text fails
      // here without consuming Browser Rendering quota.
      if (content.length < MIN_MARKDOWN_LENGTH) {
        throw new ExtractionError(
          'extraction_failed',
          'The plain-text source did not contain enough useful content.',
          422,
        );
      }
      return {
        type: 'document',
        url: fetchedUrl,
        source: 'web',
        id: null,
        title: titleFromMarkdown(content),
        author: null,
        publishedAt: null,
        content,
        media: [],
        attributes: { wordCount: markdownWordCount(content) },
        method: 'native-markdown',
      };
    }

    if (type && !isHtmlType(type) && !looksLikeHtml(page.body)) {
      throw new ExtractionError(
        'unsupported_content_type',
        `The source returned ${type}, but only HTML, Markdown, and plain-text pages can be extracted.`,
        415,
      );
    }

    assertNoAccessInterstitial(page.body);

    // Set eligibility before parsing: a parser failure may be recoverable only
    // when the original HTML indicates that client-side rendering is expected.
    shouldUseBrowser = hasClientRenderingSignals(page.body);
    // Shopify storefront JSON is structured, public, and substantially cheaper
    // than rendering a theme. Only confirmed Shopify HTML activates this call.
    const shopify = await extractShopifyStorefront(page.body, new URL(fetchedUrl), dependencies);
    if (shopify) return shopify;
    // WooCommerce storefronts expose the same public product fields used by
    // their customer-facing blocks. Prefer that compact JSON to theme markup.
    const woocommerce = await extractWooCommerceStorefront(page.body, new URL(fetchedUrl), dependencies);
    if (woocommerce) return woocommerce;
    const productDetail = extractProductDetailFromHtml(page.body, new URL(fetchedUrl));
    if (productDetail) return productDetail;
    const productListing = extractProductListingFromHtml(page.body, new URL(fetchedUrl));
    if (productListing) return productListing;
    const blogListing = extractBlogListingFromHtml(page.body, new URL(fetchedUrl));
    if (blogListing) return blogListing;
    let extracted = extractMarkdownFromHtml(page.body, fetchedUrl, dependencies.focus);
    if (shouldUseBrowser && unresolvedTemplatesDominate(extracted.content)) {
      const cleaned = extractMarkdownFromHtml(
        stripUnresolvedTemplateExpressions(page.body),
        fetchedUrl,
        dependencies.focus,
      );
      if (!cleaned.metadataOnly && cleaned.wordCount > extracted.wordCount) {
        extracted = cleaned;
      } else {
        throw new ExtractionError(
          'extraction_failed',
          'The server response contained unresolved client templates.',
          422,
        );
      }
    }
    if (shouldUseBrowser && navigationShellDominates(page.body, extracted.content)) {
      throw new ExtractionError(
        'extraction_failed',
        'The server response contained only the client application shell.',
        422,
      );
    }
    if (extracted.metadataOnly) {
      const discovered = await extractDiscoveredAlternative(sourceHtml, fetchedUrl, dependencies, sourceLinkHeader);
      if (discovered) return discovered;
    }
    const { metadataOnly, description, language, modifiedAt, wordCount, ...article } = extracted;
    return {
      type: metadataOnly ? 'document' : 'article',
      url: fetchedUrl,
      source: 'web',
      id: null,
      ...article,
      attributes: {
        ...(description ? { description } : {}),
        ...(language ? { language } : {}),
        ...(modifiedAt ? { modifiedAt } : {}),
        wordCount,
      },
      method: metadataOnly ? 'metadata' : 'linkedom',
    };
  } catch (error) {
    if (error instanceof ExtractionError && ['invalid_url', 'unsafe_url', 'not_found', 'unsupported_content_type', 'content_too_large', 'timeout'].includes(error.code)) {
      throw error;
    }
    directError = error;
  }

  if (sourceHtml) {
    // Publisher-advertised structured endpoints can rescue an otherwise empty
    // page without paying for Browser Rendering. Normal readable HTML never
    // reaches this branch, so ordinary pages retain their single-request path.
    const discovered = await extractDiscoveredAlternative(sourceHtml, fetchedUrl, dependencies, sourceLinkHeader);
    if (discovered) return discovered;
  }

  const inferredFeed = await extractInferredFeedAlternative(fetchedUrl, dependencies);
  if (inferredFeed) return inferredFeed;

  if (!shouldUseBrowser) {
    // Network errors, HTTP blocks, static empty pages, and non-HTML responses
    // are not improved by opening a browser. Preserve their precise error and
    // avoid the most expensive extraction path.
    if (directError instanceof ExtractionError) throw directError;
    throw new ExtractionError('extraction_failed', 'The HTML source could not be parsed.', 422);
  }

  if (!dependencies.renderPageHtml) {
    throw new ExtractionError('extraction_failed', 'The page did not expose usable public content.', 422);
  }

  if (dependencies.allowBrowser && !(await dependencies.allowBrowser())) {
    throw new ExtractionError('rate_limited', 'High-cost extraction rate limit exceeded.', 429, 60);
  }

  try {
    const html = await dependencies.renderPageHtml(url);
    assertNoAccessInterstitial(html);
    // Rendering can reveal the same portable structured metadata and visible
    // listings handled on ordinary HTML pages. Reuse those parsers before the
    // generic Markdown fallback so prices, variants, and feed items retain
    // their semantic schema instead of being flattened into prose.
    const renderedUrl = new URL(fetchedUrl);
    const renderedProductDetail = extractProductDetailFromHtml(html, renderedUrl);
    if (renderedProductDetail) return renderedProductDetail;
    const renderedProductListing = extractProductListingFromHtml(html, renderedUrl);
    if (renderedProductListing) return renderedProductListing;
    const renderedBlogListing = extractBlogListingFromHtml(html, renderedUrl);
    if (renderedBlogListing) return renderedBlogListing;
    const extracted = extractMarkdownFromHtml(
      stripUnresolvedTemplateExpressions(html),
      fetchedUrl,
      dependencies.focus,
    );
    const { metadataOnly: _metadataOnly, description, language, modifiedAt, wordCount, ...article } = extracted;
    return {
      type: 'article',
      url: fetchedUrl,
      source: 'web',
      id: null,
      ...article,
      attributes: {
        ...(description ? { description } : {}),
        ...(language ? { language } : {}),
        ...(modifiedAt ? { modifiedAt } : {}),
        wordCount,
      },
      method: 'browser',
    };
  } catch (browserError) {
    // If the browser only reports a generic parsing failure, the direct request
    // may still contain a more useful status or connectivity explanation.
    if (
      browserError instanceof ExtractionError
      && browserError.code === 'extraction_failed'
      && directError instanceof ExtractionError
    ) {
      throw directError;
    }
    throw browserError;
  }
}
