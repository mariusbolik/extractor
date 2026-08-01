import { handle } from '@astrojs/cloudflare/handler';
import { getSiteMarkdown } from './features/discovery/site-markdown';

const DISCOVERY_LINKS = [
  '</sitemap.xml>; rel="sitemap"; type="application/xml"',
  '</llms.txt>; rel="describedby"; type="text/markdown"',
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
].join(', ');

function acceptsMarkdown(header: string | null): boolean {
  if (!header) return false;

  return header.split(',').some((entry) => {
    const [mediaType, ...parameters] = entry.trim().split(';');
    const refused = parameters.some((parameter) => /^\s*q=0(?:\.0*)?\s*$/i.test(parameter));
    return mediaType.toLowerCase() === 'text/markdown' && !refused;
  });
}

function addVary(headers: Headers, value: string): void {
  const values = new Set((headers.get('Vary') ?? '').split(',').map((item) => item.trim()).filter(Boolean));
  values.add(value);
  headers.set('Vary', [...values].join(', '));
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const markdown = getSiteMarkdown(url.pathname);

    if ((request.method === 'GET' || request.method === 'HEAD') && markdown && acceptsMarkdown(request.headers.get('Accept'))) {
      return new Response(request.method === 'HEAD' ? null : markdown, {
        headers: {
          'Cache-Control': 'public, max-age=300',
          'Cloudflare-CDN-Cache-Control': 'public, max-age=3600',
          'Content-Language': 'en',
          'Content-Type': 'text/markdown; charset=utf-8',
          Link: DISCOVERY_LINKS,
          Vary: 'Accept',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    const response = await handle(request, env, context);
    const decorated = new Response(response.body, response);
    decorated.headers.set('Link', DISCOVERY_LINKS);
    if (markdown) addVary(decorated.headers, 'Accept');
    return decorated;
  },
} satisfies ExportedHandler<Env>;
