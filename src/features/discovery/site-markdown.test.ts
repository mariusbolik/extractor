import { describe, expect, it } from 'vitest';
import { alternativePages, platformArticles } from '../marketing/content';
import { getSiteMarkdown } from './site-markdown';

describe('agent-readable site Markdown', () => {
  it('returns concise Markdown for every public page', () => {
    for (const path of [
      '/',
      '/amazon/',
      '/bluesky/',
      '/google-news/',
      '/instagram/',
      '/mastodon/',
      '/reddit/',
      '/shopify/',
      '/soundcloud/',
      '/spotify/',
      '/tiktok/',
      '/vimeo/',
      '/x/',
      '/youtube/',
      '/docs/',
      '/docs/quickstart/',
      '/docs/mcp/',
      '/docs/api/',
      '/docs/schema/',
      '/docs/sources/',
      '/docs/limits/',
      '/docs/limitations/',
      '/pricing/',
      '/alternatives/',
      '/blog/',
      ...alternativePages.map((page) => `/alternatives/${page.slug}/`),
      ...platformArticles.map((article) => `/blog/${article.slug}/`),
    ]) {
      const markdown = getSiteMarkdown(path);
      expect(markdown).toMatch(/^# /);
      expect(markdown).toContain('/api/extract');
    }
  });

  it('normalizes missing trailing slashes', () => {
    expect(getSiteMarkdown('/reddit')).toBe(getSiteMarkdown('/reddit/'));
  });

  it('does not claim Markdown representations for unknown paths', () => {
    expect(getSiteMarkdown('/missing')).toBeNull();
  });
});
