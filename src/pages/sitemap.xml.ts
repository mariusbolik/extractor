import type { APIRoute } from 'astro';
import { alternativePages, platformArticles } from '../features/marketing/content';

export const prerender = true;

const STATIC_PATHS = [
  '/', '/amazon/', '/app-store/', '/bluesky/', '/google-news/', '/google-play/', '/instagram/', '/mastodon/', '/reddit/', '/shopify/', '/soundcloud/', '/spotify/', '/tiktok/', '/vimeo/', '/x/', '/youtube/',
  '/docs/', '/docs/quickstart/', '/docs/mcp/', '/docs/api/', '/docs/schema/', '/docs/sources/', '/docs/limits/', '/docs/limitations/',
  '/pricing/', '/contact/', '/alternatives/', '/blog/',
];

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  })[character] ?? character);
}

export const GET: APIRoute = ({ site }) => {
  const origin = site ?? new URL('https://extractor.mcb-software.workers.dev');
  const paths = [
    ...STATIC_PATHS,
    ...alternativePages.map((page) => `/alternatives/${page.slug}/`),
    ...platformArticles.map((article) => `/blog/${article.slug}/`),
  ];
  const urls = paths.map((path) => `  <url><loc>${escapeXml(new URL(path, origin).toString())}</loc></url>`).join('\n');

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
