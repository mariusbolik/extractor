import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { ExtractionError } from './errors';

const MIN_USEFUL_CONTENT = 80;

function createTurndown(): TurndownService {
  return new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
  });
}

interface LinkNode {
  hasAttribute(name: string): boolean;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

interface QueryRoot {
  querySelectorAll(selectors: string): { forEach(callback: (node: LinkNode) => void): void };
}

function absolutizeLinks(root: QueryRoot, baseUrl: string): void {
  root.querySelectorAll('a[href], img[src]').forEach((node) => {
    const attribute = node.hasAttribute('href') ? 'href' : 'src';
    const value = node.getAttribute(attribute);
    if (!value) return;
    try {
      node.setAttribute(attribute, new URL(value, baseUrl).toString());
    } catch {
      node.removeAttribute(attribute);
    }
  });
}

export function htmlFragmentToMarkdown(html: string, baseUrl: string): string {
  const { document } = parseHTML(`<html><body><main>${html}</main></body></html>`);
  const main = document.querySelector('main');
  if (!main) return '';
  main.querySelectorAll('script, style, noscript, template, iframe').forEach((node) => node.remove());
  absolutizeLinks(main as unknown as QueryRoot, baseUrl);
  return createTurndown().turndown(main.innerHTML).trim();
}

export function extractMarkdownFromHtml(
  html: string,
  pageUrl: string,
  focus?: string,
): { title: string | null; author: string | null; content: string } {
  const { document } = parseHTML(html);
  document.querySelectorAll('script, style, noscript, template, iframe').forEach((node) => node.remove());
  absolutizeLinks(document as unknown as QueryRoot, pageUrl);

  const pageTitle = document.querySelector('title')?.textContent?.trim() || null;
  const focused = focus ? focusedMarkdown(document, focus) : '';
  if (focused.length >= MIN_USEFUL_CONTENT) {
    const content = pageTitle && !focused.startsWith('# ')
      ? `# ${pageTitle}\n\n${focused}`
      : focused;
    return { title: pageTitle, author: null, content };
  }

  const parsed = new Readability(document as unknown as Document, {
    charThreshold: MIN_USEFUL_CONTENT,
  }).parse();

  let content = '';
  let title: string | null = null;
  let author: string | null = null;

  if (parsed?.content) {
    content = createTurndown().turndown(parsed.content).trim();
    title = parsed.title?.trim() || null;
    author = parsed.byline?.trim() || null;
  }

  if (content.length < MIN_USEFUL_CONTENT) {
    const fallback = document.querySelector('article, main, [role="main"], body');
    if (fallback) {
      fallback.querySelectorAll('nav, header, footer, aside, form, button').forEach((node) => node.remove());
      content = createTurndown().turndown(fallback.innerHTML).trim();
      title ||= document.querySelector('title')?.textContent?.trim() || null;
    }
  }

  if (content.length < MIN_USEFUL_CONTENT) {
    throw new ExtractionError('extraction_failed', 'No useful page content was found.', 422);
  }

  if (title && !content.startsWith('# ')) content = `# ${title}\n\n${content}`;
  return { title, author, content };
}

function normalizedText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function focusedMarkdown(document: Document, focus: string): string {
  const terms = normalizedText(focus).split(' ').filter((term) => term.length >= 3);
  if (terms.length === 0) return '';

  const matches = (value: string | null | undefined) => {
    const normalized = normalizedText(value ?? '');
    return terms.some((term) => normalized.includes(term));
  };

  // IDs such as `pricing`, `features`, or `faq` are the strongest signal on
  // landing pages. Heading text is the fallback when authors omit section IDs.
  const idMatch = [...document.querySelectorAll('[id]')]
    .find((element) => matches(element.getAttribute('id')) && element.id !== '__next');
  const headingMatch = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .find((element) => matches(element.textContent));
  const root = idMatch
    ?? headingMatch?.closest('[id]:not(#__next), section, article, main')
    ?? headingMatch?.parentElement;
  if (!root) return '';

  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll('script, style, noscript, template, iframe, svg, nav, header, footer, aside, form, button')
    .forEach((node) => node.remove());
  return createTurndown().turndown(clone.innerHTML).trim();
}

export function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, '\\$1').trim();
}
