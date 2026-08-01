import { parse as parseDomain } from 'tldts';
import { ExtractionError } from './errors';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  'instance-data',
  'extractor.mcb-software.workers.dev',
  'extractor.sh',
  'www.extractor.sh',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.lan'];
const PUBLIC_EXAMPLE_DOMAINS = new Set(['example.com', 'example.net', 'example.org']);
const AMAZON_RETAIL_HOSTS = new Set([
  'amazon.ae', 'amazon.ca', 'amazon.cn', 'amazon.co.jp', 'amazon.co.uk', 'amazon.com',
  'amazon.com.au', 'amazon.com.be', 'amazon.com.br', 'amazon.com.mx', 'amazon.com.tr',
  'amazon.de', 'amazon.eg', 'amazon.es', 'amazon.fr', 'amazon.ie', 'amazon.in',
  'amazon.it', 'amazon.nl', 'amazon.pl', 'amazon.sa', 'amazon.se', 'amazon.sg',
]);

export function validateTargetUrl(value: string): URL {
  if (!value || value.length > 2_048) {
    throw new ExtractionError('invalid_url', 'Enter a URL no longer than 2,048 characters.', 400);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ExtractionError('invalid_url', 'Enter a complete, valid URL.', 400);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ExtractionError('unsafe_url', 'Only public HTTP and HTTPS URLs are supported.', 400);
  }

  if (url.username || url.password) {
    throw new ExtractionError('unsafe_url', 'URLs containing credentials are not supported.', 400);
  }

  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new ExtractionError('unsafe_url', 'Non-standard network ports are not supported.', 400);
  }

  // URL canonicalizes alternate IP forms (decimal, octal, and hexadecimal),
  // while tldts validates labels, detects IPs, and recognizes IANA special-use
  // suffixes. Strip a trailing DNS root dot before blocklist comparisons so it
  // cannot bypass an exact host rule.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const domain = parseDomain(hostname, {
    allowPrivateDomains: true,
    detectSpecialUse: true,
    extractHostname: true,
    validateHostname: true,
  });
  const validHostLabels = hostname.length <= 253 && hostname.split('.').every(
    (label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i.test(label),
  );
  const allowedExampleDomain = domain.domain ? PUBLIC_EXAMPLE_DOMAINS.has(domain.domain) : false;

  if (domain.isIp || hostname.includes(':')) {
    throw new ExtractionError('unsafe_url', 'Private, local, and direct-IP targets are not supported.', 400);
  }

  if (
    !hostname ||
    !validHostLabels ||
    domain.hostname === null ||
    !domain.domain
  ) {
    throw new ExtractionError('invalid_url', 'Enter a URL with a valid public domain name.', 400);
  }

  if (
    (domain.isSpecialUse && !allowedExampleDomain) ||
    BLOCKED_HOSTS.has(hostname) ||
    BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw new ExtractionError('unsafe_url', 'Private, local, and direct-IP targets are not supported.', 400);
  }

  url.hostname = hostname;
  url.hash = '';
  return url;
}

export function isXUrl(url: URL): boolean {
  return ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(
    url.hostname.toLowerCase(),
  );
}

export function isRedditUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return hostname === 'reddit.com' || hostname === 'www.reddit.com' || hostname.endsWith('.reddit.com');
}

export function isYouTubeUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(hostname);
}

export function isVimeoUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (!['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(hostname)) return false;
  return /^\/(?:\d+|video\/\d+|album\/\d+\/video\/\d+|channels\/[^/]+\/\d+|groups\/[^/]+\/videos\/\d+|ondemand\/[^/]+\/\d+)\/?$/i.test(url.pathname);
}

export function isSoundCloudUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (!['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com'].includes(hostname)) return false;
  const firstSegment = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  return Boolean(firstSegment && !['discover', 'search', 'stream', 'upload', 'you'].includes(firstSegment));
}

export function isSpotifyUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'spotify.link') return url.pathname !== '/';
  if (hostname !== 'open.spotify.com') return false;
  return /^\/(?:intl-[a-z]{2}\/)?(?:track|album|artist|episode|show|playlist)\/[A-Za-z0-9]+\/?$/i.test(url.pathname);
}

export function isPossibleMastodonStatusUrl(url: URL): boolean {
  return /^\/@[^/]+\/\d+\/?$/i.test(url.pathname);
}

export function isTikTokUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'vm.tiktok.com' || hostname === 'vt.tiktok.com') return true;
  if (!['tiktok.com', 'www.tiktok.com', 'm.tiktok.com'].includes(hostname)) return false;

  return /^\/@[^/]+(?:\/(?:video|photo)\/\d+)?\/?$/i.test(url.pathname)
    || /^\/t\/[^/]+\/?$/i.test(url.pathname);
}

const INSTAGRAM_RESERVED_PATHS = new Set([
  'about', 'accounts', 'api', 'developer', 'direct', 'directory', 'explore', 'legal',
  'nametag', 'reels', 'static', 'stories', 'tv',
]);

export function isInstagramUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (!['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(hostname)) return false;
  if (/^\/(?:p|reel)\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname)) return true;

  const profile = url.pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/)?.[1]?.toLowerCase();
  return Boolean(profile && !INSTAGRAM_RESERVED_PATHS.has(profile));
}

export function amazonProductAsin(url: URL): string | null {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!AMAZON_RETAIL_HOSTS.has(hostname)) return null;

  // Accept normal product URLs from users, including title-slug URLs. The
  // adapter rewrites these internally; callers never need to know the fetch path.
  const match = url.pathname.match(
    /\/(?:dp|gp\/product|gp\/aw\/d|gp\/offer-listing)\/([a-z0-9]{10})(?:\/|$)/i,
  );
  return match?.[1]?.toUpperCase() || null;
}

export function amazonSearchQuery(url: URL): string | null {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!AMAZON_RETAIL_HOSTS.has(hostname) || !/(?:^|\/)s\/?$/i.test(url.pathname)) return null;

  // Amazon search pages use the `k` parameter for the human-entered query.
  // Ignore tracking and presentation parameters so equivalent searches share
  // one stable canonical result and cache key.
  const query = url.searchParams.get('k')?.replace(/\s+/g, ' ').trim() ?? '';
  return query && query.length <= 200 ? query : null;
}

export function isBlueskyProfileUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (hostname === 'bsky.app' || hostname === 'www.bsky.app')
    && /^\/profile\/[^/]+\/?$/i.test(url.pathname);
}

export function isBlueskyPostUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (hostname === 'bsky.app' || hostname === 'www.bsky.app')
    && /^\/profile\/[^/]+\/post\/[^/]+\/?$/i.test(url.pathname);
}
