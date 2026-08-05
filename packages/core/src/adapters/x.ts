import { fetchTweet } from 'react-tweet/api';
import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractedMedia, ExtractionDependencies, ExtractionResult } from '../types';

function tweetIdFromUrl(url: URL): string {
  const match = url.pathname.match(/^\/[^/]+\/status\/(\d+)/i);
  if (!match) {
    throw new ExtractionError('invalid_url', 'Enter a public X status URL.', 400);
  }
  return match[1];
}

function engagementCount(value: unknown): number | undefined {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) && (number as number) >= 0 ? number as number : undefined;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function tweetMedia(value: unknown): ExtractedMedia[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const media = object(entry);
    if (!media || typeof media.media_url_https !== 'string') return [];
    const original = object(media.original_info);
    const width = engagementCount(original?.width);
    const height = engagementCount(original?.height);
    return [{
      type: 'image' as const,
      url: media.media_url_https,
      ...(typeof media.ext_alt_text === 'string' && media.ext_alt_text.trim() ? { alt: media.ext_alt_text.trim() } : {}),
      ...(width && width > 0 ? { width } : {}),
      ...(height && height > 0 ? { height } : {}),
    }];
  }).slice(0, 20);
}

function optionalTweetCounts(tweet: Record<string, unknown>) {
  const views = object(tweet.views);
  const repostCount = engagementCount(tweet.retweet_count);
  const quoteCount = engagementCount(tweet.quote_count);
  const viewCount = engagementCount(tweet.view_count ?? views?.count);
  return {
    ...(repostCount !== undefined ? { repostCount } : {}),
    ...(quoteCount !== undefined ? { quoteCount } : {}),
    ...(viewCount !== undefined ? { viewCount } : {}),
  };
}

function tweetHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => {
    const text = item && typeof item === 'object' && 'text' in item && typeof item.text === 'string'
      ? item.text.trim().replace(/^#/, '')
      : '';
    return text ? [text] : [];
  }))].slice(0, 50);
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
  let hashtags: string[] = [];
  let likeCount: number | undefined;
  let replyCount: number | undefined;
  let media: ExtractedMedia[] = [];
  let language: string | undefined;
  let verified: boolean | undefined;
  let edited: boolean | undefined;
  let sensitive: boolean | undefined;
  let inReplyToUrl: string | undefined;
  let quotedPostUrl: string | undefined;
  let quotedText = '';
  let additionalCounts: ReturnType<typeof optionalTweetCounts> = {};
  try {
    const syndication = await fetchTweet(id, {
      signal: AbortSignal.timeout(5_000),
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; extractor.sh/1.0; +https://extractor.sh)',
      },
    });
    const tweet = syndication.data;
    authorImageUrl = tweet?.user.profile_image_url_https;
    hashtags = tweetHashtags(tweet?.entities?.hashtags);
    likeCount = engagementCount(tweet?.favorite_count);
    replyCount = engagementCount(tweet?.conversation_count);
    media = tweetMedia(tweet?.mediaDetails);
    language = tweet?.lang?.trim() || undefined;
    verified = tweet ? Boolean(tweet.user.verified || tweet.user.is_blue_verified) : undefined;
    edited = typeof tweet?.isEdited === 'boolean' ? tweet.isEdited : undefined;
    sensitive = typeof tweet?.possibly_sensitive === 'boolean' ? tweet.possibly_sensitive : undefined;
    inReplyToUrl = tweet?.in_reply_to_status_id_str
      ? `https://x.com/${tweet.in_reply_to_screen_name || 'i'}/status/${tweet.in_reply_to_status_id_str}`
      : undefined;
    quotedPostUrl = tweet?.quoted_tweet
      ? `https://x.com/${tweet.quoted_tweet.user.screen_name}/status/${tweet.quoted_tweet.id_str}`
      : undefined;
    quotedText = tweet?.quoted_tweet?.text?.trim() || '';
    additionalCounts = tweet ? optionalTweetCounts(tweet as unknown as Record<string, unknown>) : {};
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
    content: [
      `# Post by ${escapeMarkdown(author)}`,
      postMarkdown,
      quotedText && quotedPostUrl ? `## Quoted post\n\n${escapeMarkdown(quotedText)}\n\n[View quoted post](${quotedPostUrl})` : '',
      `[View on X](${canonicalUrl})`,
    ].filter(Boolean).join('\n\n'),
    media,
    attributes: {
      handle: `@${screenName}`,
      ...(authorImageUrl ? { authorImageUrl } : {}),
      ...(language ? { language } : {}),
      ...(verified !== undefined ? { verified } : {}),
      ...(edited !== undefined ? { edited } : {}),
      ...(sensitive !== undefined ? { sensitive } : {}),
      ...(inReplyToUrl ? { inReplyToUrl } : {}),
      ...(quotedPostUrl ? { quotedPostUrl } : {}),
      ...(hashtags.length ? { hashtags } : {}),
      ...(likeCount !== undefined ? { likeCount } : {}),
      ...(replyCount !== undefined ? { replyCount } : {}),
      ...additionalCounts,
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
        'User-Agent': 'Mozilla/5.0 (compatible; extractor.sh/1.0; +https://extractor.sh)',
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

    const media = tweetMedia(tweet.mediaDetails).map((item) => ({ ...item, alt: item.alt || 'Post image' }));
    const mediaTypes = new Set((tweet.mediaDetails ?? []).map((item) => item.type));
    const hashtags = tweetHashtags(tweet.entities?.hashtags);
    const likeCount = engagementCount(tweet.favorite_count);
    const replyCount = engagementCount(tweet.conversation_count);
    const tweetRecord = tweet as unknown as Record<string, unknown>;
    const quotedPostUrl = tweet.quoted_tweet
      ? `https://x.com/${tweet.quoted_tweet.user.screen_name}/status/${tweet.quoted_tweet.id_str}`
      : undefined;
    const inReplyToUrl = tweet.in_reply_to_status_id_str
      ? `https://x.com/${tweet.in_reply_to_screen_name || 'i'}/status/${tweet.in_reply_to_status_id_str}`
      : undefined;

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
        ...(tweet.lang ? { language: tweet.lang } : {}),
        verified: Boolean(tweet.user.verified || tweet.user.is_blue_verified),
        edited: Boolean(tweet.isEdited),
        ...(typeof tweet.possibly_sensitive === 'boolean' ? { sensitive: tweet.possibly_sensitive } : {}),
        ...(inReplyToUrl ? { inReplyToUrl } : {}),
        ...(quotedPostUrl ? { quotedPostUrl } : {}),
        ...(hashtags.length ? { hashtags } : {}),
        ...(likeCount !== undefined ? { likeCount } : {}),
        ...(replyCount !== undefined ? { replyCount } : {}),
        ...optionalTweetCounts(tweetRecord),
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
