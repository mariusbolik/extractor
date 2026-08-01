import { ExtractionError } from '../errors';
import { fetchPublicPage } from '../fetch';
import { escapeMarkdown, htmlFragmentToMarkdown } from '../markdown';
import type { EntityAttributes, EntityType, ExtractionMethod, ExtractionResult, ExtractionSource } from '../types';

export type OembedData = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function date(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

export async function fetchOembed(
  endpoint: URL,
  fetcher: typeof fetch,
  provider: string,
): Promise<OembedData> {
  const response = await fetchPublicPage(endpoint, fetcher, 'application/json');
  try {
    const data = JSON.parse(response.body) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Unexpected payload');
    return data as OembedData;
  } catch {
    throw new ExtractionError('upstream_error', `${provider} returned invalid public metadata.`, 502);
  }
}

interface OembedDocumentOptions {
  data: OembedData;
  url: URL;
  provider: string;
  source: ExtractionSource;
  method: ExtractionMethod;
  fallbackTitle: string;
  type: EntityType;
  id: string | null;
  attributes?: EntityAttributes;
}

export function oembedDocument(options: OembedDocumentOptions): ExtractionResult {
  const { data, url, provider, source, method, fallbackTitle, type, id, attributes = {} } = options;
  const title = text(data.title) || fallbackTitle;
  const author = text(data.author_name) || null;
  const description = htmlFragmentToMarkdown(text(data.description), url.toString());
  const embedText = htmlFragmentToMarkdown(text(data.html), url.toString());
  const thumbnail = text(data.thumbnail_url);
  const duration = Number(data.duration);
  const publishedAt = date(data.upload_date);
  const details = [
    author ? `Author: ${escapeMarkdown(author)}` : '',
    publishedAt ? `Published: ${publishedAt}` : '',
    Number.isFinite(duration) && duration > 0 ? `Duration: ${duration} seconds` : '',
    text(data.type) ? `Type: ${escapeMarkdown(text(data.type))}` : '',
  ].filter(Boolean).join(' · ');

  // oEmbed HTML is designed for browsers and may contain active iframes or
  // scripts. Only its inert readable text is retained in the public result.
  const content = [
    `# ${escapeMarkdown(title)}`,
    description,
    embedText,
    details,
    thumbnail ? `![${escapeMarkdown(title)}](${thumbnail})` : '',
    `[View on ${provider}](${url.toString()})`,
  ].filter(Boolean).join('\n\n');

  return {
    type,
    url: url.toString(),
    source,
    id,
    title,
    author,
    publishedAt,
    content,
    media: thumbnail ? [{ type: 'image', url: thumbnail, alt: `${title} thumbnail` }] : [],
    attributes: Number.isFinite(duration) && duration > 0 && ['video', 'audio', 'post'].includes(type)
      ? { ...attributes, durationSeconds: Math.round(duration) }
      : attributes,
    ...(type === 'profile' ? { items: [] } : {}),
    method,
  };
}
