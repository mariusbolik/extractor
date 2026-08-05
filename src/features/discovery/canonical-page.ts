import { getSiteMarkdown } from './site-markdown';

const NON_DISCOVERABLE_HTML_PATHS = new Set([
  '/dashboard/',
  '/legal/',
  '/login/',
  '/privacy/',
  '/terms/',
]);

/**
 * Return the permanent canonical URL for an HTML page requested without its
 * trailing slash. API, MCP, discovery, asset, unknown, and non-GET routes are
 * deliberately left alone.
 */
export function canonicalPageRedirectUrl(request: Request): URL | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname.endsWith('/')) return null;

  const canonicalPath = `${url.pathname}/`;
  if (!getSiteMarkdown(canonicalPath) && !NON_DISCOVERABLE_HTML_PATHS.has(canonicalPath)) return null;

  url.pathname = canonicalPath;
  return url;
}
