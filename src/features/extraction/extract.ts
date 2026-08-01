import { extractAmazonProduct } from './adapters/amazon';
import { extractBlueskyPost, extractBlueskyProfile } from './adapters/bluesky';
import { extractInstagram } from './adapters/instagram';
import { extractMastodon } from './adapters/mastodon';
import { extractReddit } from './adapters/reddit';
import { extractSoundCloud } from './adapters/soundcloud';
import { extractSpotify } from './adapters/spotify';
import { extractTikTok } from './adapters/tiktok';
import { extractVimeo } from './adapters/vimeo';
import { extractWebPage } from './adapters/web';
import { extractTweet } from './adapters/x';
import { extractYouTube } from './adapters/youtube';
import { ExtractionError } from './errors';
import type { ExtractionDependencies, ExtractionResult } from './types';
import { amazonProductAsin, isBlueskyPostUrl, isBlueskyProfileUrl, isInstagramUrl, isPossibleMastodonStatusUrl, isRedditUrl, isSoundCloudUrl, isSpotifyUrl, isTikTokUrl, isVimeoUrl, isXUrl, isYouTubeUrl, validateTargetUrl } from './url';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export async function extractUrl(
  rawUrl: string,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult> {
  const url = validateTargetUrl(rawUrl);
  let result: ExtractionResult;

  if (amazonProductAsin(url)) result = await extractAmazonProduct(url, dependencies);
  else if (isBlueskyPostUrl(url)) result = await extractBlueskyPost(url, dependencies);
  else if (isBlueskyProfileUrl(url)) result = await extractBlueskyProfile(url, dependencies);
  else if (isInstagramUrl(url)) result = await extractInstagram(url, dependencies);
  else if (isVimeoUrl(url)) result = await extractVimeo(url, dependencies);
  else if (isSoundCloudUrl(url)) result = await extractSoundCloud(url, dependencies);
  else if (isSpotifyUrl(url)) result = await extractSpotify(url, dependencies);
  else if (isTikTokUrl(url)) result = await extractTikTok(url, dependencies);
  else if (isXUrl(url)) result = await extractTweet(url, dependencies);
  else if (isRedditUrl(url)) result = await extractReddit(url, dependencies);
  else if (isYouTubeUrl(url)) result = await extractYouTube(url, dependencies);
  else if (isPossibleMastodonStatusUrl(url)) result = await extractMastodon(url, dependencies) ?? await extractWebPage(url, dependencies);
  else result = await extractWebPage(url, dependencies);

  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_OUTPUT_BYTES) {
    throw new ExtractionError('content_too_large', 'The extracted result is larger than 2 MB.', 413);
  }

  return result;
}
