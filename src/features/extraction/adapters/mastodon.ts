import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { ExtractionDependencies, ExtractionResult } from '../types';
import { fetchOembed, oembedDocument, type OembedData } from './oembed';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function mastodonStatusResult(body: string, url: URL, oembed: OembedData): ExtractionResult | null {
  let status: UnknownRecord;
  try {
    status = JSON.parse(body) as UnknownRecord;
  } catch {
    return null;
  }
  const account = record(status.account);
  const rawHandle = text(account?.acct);
  const handle = rawHandle.includes('@') ? rawHandle : `${rawHandle}@${url.hostname}`;
  const displayName = text(account?.display_name) || text(oembed.author_name);
  const author = displayName ? `${displayName} (@${handle})` : `@${handle}`;
  const post = htmlFragmentToMarkdown(text(status.content), url.toString());
  if (!post) return null;
  const warning = text(status.spoiler_text);
  const media = Array.isArray(status.media_attachments) ? status.media_attachments : [];
  const descriptions = media
    .map((item) => text(record(item)?.description))
    .filter(Boolean);
  const published = Date.parse(text(status.created_at));

  return {
    url: text(status.url) || url.toString(),
    source: 'mastodon',
    kind: 'document',
    title: `Mastodon post by @${handle}`,
    author,
    publishedAt: Number.isNaN(published) ? null : new Date(published).toISOString(),
    content: [
      `# Mastodon post by ${escapeMarkdown(author)}`,
      warning ? `Content warning: ${escapeMarkdown(warning)}` : '',
      post,
      descriptions.length ? `Media descriptions:\n\n${descriptions.map((item) => `- ${escapeMarkdown(item)}`).join('\n')}` : '',
      `[View on Mastodon](${url.toString()})`,
    ].filter(Boolean).join('\n\n'),
    items: [],
    method: 'mastodon-oembed',
  };
}

export async function extractMastodon(
  url: URL,
  dependencies: ExtractionDependencies = {},
): Promise<ExtractionResult | null> {
  const fetcher = dependencies.fetcher ?? fetch;
  const statusId = url.pathname.match(/\/(\d+)\/?$/)?.[1];
  if (!statusId) return null;

  const oembedEndpoint = new URL('/api/oembed', url.origin);
  oembedEndpoint.searchParams.set('url', url.toString());
  let oembed: OembedData;
  try {
    oembed = await fetchOembed(oembedEndpoint, fetcher, 'Mastodon');
  } catch {
    // A status-shaped path can exist on a non-Mastodon site. In that case the
    // normal webpage extractor remains responsible for the URL.
    return null;
  }

  try {
    const statusEndpoint = new URL(`/api/v1/statuses/${statusId}`, url.origin);
    const response = await fetchPublicPage(statusEndpoint, fetcher, 'application/json');
    const result = mastodonStatusResult(response.body, url, oembed);
    if (result) return result;
  } catch (error) {
    if (error instanceof ExtractionError) {
      console.warn('Mastodon public status details unavailable; using oEmbed metadata', { code: error.code });
    }
  }

  return oembedDocument({ data: oembed, url, provider: 'Mastodon', source: 'mastodon', method: 'mastodon-oembed', fallbackTitle: `Mastodon post by ${text(oembed.author_name) || 'unknown author'}` });
}
