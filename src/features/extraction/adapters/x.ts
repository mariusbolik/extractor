import { fetchTweet } from 'react-tweet/api';
import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractionDependencies, ExtractionResult } from '../types';

function tweetIdFromUrl(url: URL): string {
  const match = url.pathname.match(/^\/[^/]+\/status\/(\d+)/i);
  if (!match) {
    throw new ExtractionError('invalid_url', 'Enter a public X status URL.', 400);
  }
  return match[1];
}

async function extractOfficialOembed(
  url: URL,
  id: string,
  fetcher: typeof fetch,
): Promise<ExtractionResult> {
  const endpoint = new URL('https://publish.x.com/oembed');
  endpoint.searchParams.set('url', url.toString());
  endpoint.searchParams.set('omit_script', 'true');
  endpoint.searchParams.set('dnt', 'true');
  const response = await fetchPublicPage(endpoint, fetcher, 'application/json');

  const data = JSON.parse(response.body) as Record<string, unknown>;
  const html = typeof data.html === 'string' ? data.html : '';
  const authorName = typeof data.author_name === 'string' ? data.author_name.trim() : '';
  const authorUrl = typeof data.author_url === 'string' ? data.author_url : '';
  const screenName = authorUrl.match(/(?:x|twitter)\.com\/([^/?#]+)/i)?.[1]
    || url.pathname.match(/^\/([^/]+)\/status\//i)?.[1]
    || 'user';
  const postMarkdown = htmlFragmentToMarkdown(html, url.toString());
  if (!postMarkdown) throw new Error('X oEmbed returned no post content.');

  // oEmbed is the cheapest and most stable source for the post itself, but it
  // does not include the author's avatar. Enrich it from X's public syndication
  // response without making that optional request a reason to fail extraction.
  let authorImageUrl: string | undefined;
  try {
    const syndication = await fetchTweet(id, {
      signal: AbortSignal.timeout(5_000),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; extractor.sh/1.0; +https://extractor.mcb-software.workers.dev)',
      },
    });
    authorImageUrl = syndication.data?.user.profile_image_url_https;
  } catch {
    // The post data from oEmbed is still useful when avatar enrichment fails.
  }

  const canonicalUrl = `https://x.com/${screenName}/status/${id}`;
  const author = authorName ? `${authorName} (@${screenName})` : `@${screenName}`;
  return {
    type: 'post',
    url: canonicalUrl,
    source: 'x',
    id,
    title: `Post by @${screenName}`,
    author,
    // X oEmbed exposes a human-readable date, not a stable machine timestamp.
    publishedAt: null,
    content: [`# Post by ${escapeMarkdown(author)}`, postMarkdown, `[View on X](${canonicalUrl})`].join('\n\n'),
    media: [],
    attributes: {
      handle: `@${screenName}`,
      ...(authorImageUrl ? { authorImageUrl } : {}),
    },
    method: 'x-oembed',
  };
}

export async function extractTweet(
  url: URL,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const id = tweetIdFromUrl(url);
  const canonicalUrl = `https://x.com/i/status/${id}`;

  // X's public oEmbed endpoint is the cheapest official representation. The
  // existing server-side adapter remains a fallback when oEmbed is unavailable.
  try {
    return await extractOfficialOembed(url, id, dependencies.fetcher ?? fetch);
  } catch (error) {
    console.warn('X oEmbed unavailable; trying fallback', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
  }

  try {
    const result = await fetchTweet(id, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; extractor.sh/1.0; +https://extractor.mcb-software.workers.dev)',
      },
    });
    if (result.notFound || result.tombstone || !result.data) {
      throw new ExtractionError('not_found', 'The tweet is unavailable, private, or deleted.', 404);
    }

    const tweet = result.data;
    const author = `${tweet.user.name} (@${tweet.user.screen_name})`;
    const sections = [
      `# Post by ${escapeMarkdown(author)}`,
      escapeMarkdown(tweet.text),
    ];

    for (const media of tweet.mediaDetails ?? []) {
      if (media.type === 'photo') {
        sections.push(`![${escapeMarkdown(media.ext_alt_text || 'Tweet image')}](${media.media_url_https})`);
      } else {
        sections.push(`[View attached ${media.type === 'video' ? 'video' : 'animation'}](${media.expanded_url})`);
      }
    }

    sections.push(`[View on X](${canonicalUrl})`);

    const media = (tweet.mediaDetails ?? []).flatMap((item) => item.type === 'photo'
      ? [{ type: 'image' as const, url: item.media_url_https, alt: item.ext_alt_text || 'Post image' }]
      : []);
    const mediaTypes = new Set((tweet.mediaDetails ?? []).map((item) => item.type));

    return {
      type: 'post',
      url: canonicalUrl,
      source: 'x',
      id,
      title: `Post by @${tweet.user.screen_name}`,
      author,
      publishedAt: new Date(tweet.created_at).toISOString(),
      content: sections.join('\n\n'),
      media,
      attributes: {
        handle: `@${tweet.user.screen_name}`,
        ...(tweet.user.profile_image_url_https ? { authorImageUrl: tweet.user.profile_image_url_https } : {}),
        ...(mediaTypes.size > 1 ? { mediaType: 'mixed' as const }
          : mediaTypes.has('photo') ? { mediaType: 'image' as const }
            : mediaTypes.has('video') || mediaTypes.has('animated_gif') ? { mediaType: 'video' as const } : {}),
      },
      method: 'react-tweet',
    };
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ExtractionError('timeout', 'X took too long to respond.', 504);
    }
    console.error('X extraction failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : 'Unknown error',
      status: typeof error === 'object' && error && 'status' in error ? error.status : undefined,
    });
    throw new ExtractionError('upstream_error', 'X could not return that public post.', 502);
  }
}
