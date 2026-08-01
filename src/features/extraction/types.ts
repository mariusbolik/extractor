export type ExtractionSource = 'web' | 'amazon' | 'bluesky' | 'instagram' | 'reddit' | 'shopify' | 'tiktok' | 'x' | 'youtube';
export type ExtractionKind = 'document' | 'feed';
export type ExtractionMethod =
  | 'native-markdown'
  | 'linkedom'
  | 'browser'
  | 'amazon-html'
  | 'bluesky-api'
  | 'bluesky-rss'
  | 'discovered-feed'
  | 'instagram-embed'
  | 'instagram-profile'
  | 'oembed'
  | 'wordpress-json'
  | 'reddit-rss'
  | 'shopify-json'
  | 'tiktok-hydration'
  | 'tiktok-oembed'
  | 'x-oembed'
  | 'react-tweet'
  | 'youtube-atom'
  | 'youtube-oembed';

export interface ExtractedItem {
  url: string;
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  content: string;
}

export interface ExtractionResult extends ExtractedItem {
  source: ExtractionSource;
  kind: ExtractionKind;
  items: ExtractedItem[];
  method: ExtractionMethod;
}

export type PublicExtractionResult = Omit<ExtractionResult, 'method'>;

export function toPublicExtractionResult(result: ExtractionResult): PublicExtractionResult {
  return {
    url: result.url,
    source: result.source,
    kind: result.kind,
    title: result.title,
    author: result.author,
    publishedAt: result.publishedAt,
    content: result.content,
    items: result.items,
  };
}

export interface ExtractionDependencies {
  fetcher?: typeof fetch;
  browser?: BrowserRun;
  allowBrowser?: () => Promise<boolean>;
}

export type OutputFormat = 'json' | 'markdown';
