import { mkdir } from 'node:fs/promises';
import { parseHTML as parseLinkMetadata } from 'linkpeek';
import { fetchPublicPage } from '@extractor/core/fetch';
import { extractMarkdownFromHtml } from '@extractor/core/markdown';

const REPORT_DIRECTORY = '.benchmark-reports';
const TARGET_COUNT = 220;
const CONCURRENCY = 5;
const HACKER_NEWS_TOP_STORIES = 'https://hacker-news.firebaseio.com/v0/topstories.json';

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function usefulText(value) {
  return typeof value === 'string' && value.trim().length >= 2 ? value.trim() : null;
}

function usefulDate(value) {
  const text = usefulText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function usefulUrl(value) {
  const text = usefulText(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalize(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function comparable(value) {
  const normalized = normalize(value);
  return normalized.length >= 3 ? normalized : '';
}

function fields(result) {
  return ['title', 'author', 'publishedAt', 'image', 'description', 'siteName']
    .filter((field) => result[field]);
}

function runCurrent(html, url) {
  const started = performance.now();
  try {
    const result = extractMarkdownFromHtml(html, url);
    return {
      success: true,
      durationMs: Number((performance.now() - started).toFixed(2)),
      title: usefulText(result.title),
      author: usefulText(result.author),
      publishedAt: usefulDate(result.publishedAt),
      image: usefulUrl(result.media[0]?.url),
      description: usefulText(result.description),
      siteName: null,
      metadataOnly: result.metadataOnly,
    };
  } catch (error) {
    return {
      success: false,
      durationMs: Number((performance.now() - started).toFixed(2)),
      title: null,
      author: null,
      publishedAt: null,
      image: null,
      description: null,
      siteName: null,
      metadataOnly: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runLinkpeek(html, url) {
  const started = performance.now();
  try {
    const result = parseLinkMetadata(html, url, { includeBodyContent: true });
    return {
      success: fields(result).length > 0,
      durationMs: Number((performance.now() - started).toFixed(2)),
      title: usefulText(result.title),
      author: usefulText(result.author),
      publishedAt: usefulDate(result.publishedDate),
      image: usefulUrl(result.image),
      description: usefulText(result.description),
      siteName: usefulText(result.siteName),
      metadataOnly: false,
    };
  } catch (error) {
    return {
      success: false,
      durationMs: Number((performance.now() - started).toFixed(2)),
      title: null,
      author: null,
      publishedAt: null,
      image: null,
      description: null,
      siteName: null,
      metadataOnly: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function mergeMetadata(current, linkpeek) {
  return {
    success: current.success || linkpeek.success,
    durationMs: Number((current.durationMs + linkpeek.durationMs).toFixed(2)),
    title: current.title || linkpeek.title,
    author: current.author || linkpeek.author,
    publishedAt: linkpeek.publishedAt,
    image: current.image || linkpeek.image,
    description: linkpeek.description,
    siteName: linkpeek.siteName,
    metadataOnly: current.metadataOnly,
  };
}

async function loadTargets() {
  const roots = new Set();
  const reports = new Bun.Glob('**/production-*.json');
  for await (const path of reports.scan('.smoke-reports')) {
    const report = await Bun.file(`.smoke-reports/${path}`).json();
    for (const result of report.results || []) {
      if (typeof result.url === 'string') roots.add(result.url);
    }
  }
  if (roots.size < 100) throw new Error(`The smoke reports contain only ${roots.size} distinct public URLs.`);

  // Root pages are useful for broad host coverage, but article metadata such as
  // dates and authors must also be judged on deep content URLs. Hacker News's
  // public API supplies a fresh, diverse article set without maintaining one.
  const response = await fetch(HACKER_NEWS_TOP_STORIES, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Hacker News returned HTTP ${response.status}.`);
  const ids = (await response.json()).slice(0, TARGET_COUNT);
  const deepUrls = new Set();
  for (let offset = 0; offset < ids.length && deepUrls.size < TARGET_COUNT / 2; offset += 20) {
    const items = await Promise.all(ids.slice(offset, offset + 20).map(async (id) => {
      try {
        const itemResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
          signal: AbortSignal.timeout(5_000),
        });
        return itemResponse.ok ? itemResponse.json() : null;
      } catch {
        return null;
      }
    }));
    for (const item of items) {
      if (item?.type !== 'story' || typeof item.url !== 'string') continue;
      try {
        const parsed = new URL(item.url);
        if (parsed.pathname && parsed.pathname !== '/') deepUrls.add(parsed.toString());
      } catch {
        // Invalid aggregator entries are irrelevant to the benchmark corpus.
      }
    }
  }

  const rootCount = Math.floor(TARGET_COUNT / 2);
  return [
    ...[...roots].sort().slice(0, rootCount),
    ...[...deepUrls].sort().slice(0, TARGET_COUNT - rootCount),
  ];
}

async function compareUrl(url) {
  const started = Date.now();
  try {
    const page = await fetchPublicPage(
      new URL(url),
      fetch,
      'text/html, application/xhtml+xml;q=0.9, */*;q=0.1',
    );
    const type = page.contentType.split(';', 1)[0];
    if (!['text/html', 'application/xhtml+xml'].includes(type) && !/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(page.body)) {
      throw new Error(`Source returned ${type || 'an unknown content type'} instead of HTML.`);
    }
    const current = runCurrent(page.body, page.url);
    const linkpeek = runLinkpeek(page.body, page.url);
    return {
      url,
      fetchedUrl: page.url,
      fetchMs: Date.now() - started,
      current,
      linkpeek,
      merged: mergeMetadata(current, linkpeek),
    };
  } catch (error) {
    return {
      url,
      fetchedUrl: null,
      fetchMs: Date.now() - started,
      fetchError: error instanceof Error ? error.message : String(error),
      current: null,
      linkpeek: null,
      merged: null,
    };
  }
}

async function mapConcurrent(values, mapper) {
  const output = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next++;
      output[index] = await mapper(values[index]);
      const result = output[index];
      const status = result.fetchError ? 'fetch-error' : `C${fields(result.current).length}/L${fields(result.linkpeek).length}/M${fields(result.merged).length}`;
      process.stdout.write(`[${index + 1}/${values.length}] ${status.padEnd(12)} ${values[index]}\n`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return output;
}

function summarize(rows, key) {
  const results = rows.map((row) => row[key]);
  const coverage = (field) => Number((results.filter((result) => result[field]).length / Math.max(1, results.length)).toFixed(4));
  return {
    successes: results.filter((result) => result.success).length,
    titleRate: coverage('title'),
    authorRate: coverage('author'),
    publishedAtRate: coverage('publishedAt'),
    imageRate: coverage('image'),
    descriptionRate: coverage('description'),
    siteNameRate: coverage('siteName'),
    metadataOnlyRescues: results.filter((result) => result.metadataOnly).length,
    runtimeMs: {
      p50: percentile(results.map((result) => result.durationMs), 0.5),
      p95: percentile(results.map((result) => result.durationMs), 0.95),
      total: Number(results.reduce((sum, result) => sum + result.durationMs, 0).toFixed(2)),
    },
  };
}

function agreement(rows, field) {
  const comparableRows = rows.filter((row) => row.current[field] && row.linkpeek[field]);
  const agreed = comparableRows.filter((row) => {
    const current = comparable(row.current[field]);
    const linkpeek = comparable(row.linkpeek[field]);
    return current && linkpeek && (current === linkpeek || current.includes(linkpeek) || linkpeek.includes(current));
  });
  return {
    compared: comparableRows.length,
    rate: Number((agreed.length / Math.max(1, comparableRows.length)).toFixed(4)),
  };
}

function reportMarkdown(report) {
  const { current, linkpeek, merged } = report.summary;
  const percentage = (value) => `${(value * 100).toFixed(1)}%`;
  return `# Metadata shadow benchmark\n\n` +
    `Generated ${report.generatedAt}. Every implementation received the same fetched HTML.\n\n` +
    `- Public URLs attempted: ${report.summary.attempted}\n` +
    `- HTML responses compared: ${report.summary.compared}\n` +
    `- Fetch failures/non-HTML responses: ${report.summary.fetchFailures}\n\n` +
    `| Metric | Current | linkpeek | Safe merge |\n|---|---:|---:|---:|\n` +
    `| Any useful metadata | ${current.successes} | ${linkpeek.successes} | ${merged.successes} |\n` +
    `| Title coverage | ${percentage(current.titleRate)} | ${percentage(linkpeek.titleRate)} | ${percentage(merged.titleRate)} |\n` +
    `| Author coverage | ${percentage(current.authorRate)} | ${percentage(linkpeek.authorRate)} | ${percentage(merged.authorRate)} |\n` +
    `| Published date coverage | ${percentage(current.publishedAtRate)} | ${percentage(linkpeek.publishedAtRate)} | ${percentage(merged.publishedAtRate)} |\n` +
    `| Image coverage | ${percentage(current.imageRate)} | ${percentage(linkpeek.imageRate)} | ${percentage(merged.imageRate)} |\n` +
    `| Description coverage | ${percentage(current.descriptionRate)} | ${percentage(linkpeek.descriptionRate)} | ${percentage(merged.descriptionRate)} |\n` +
    `| Site name coverage | ${percentage(current.siteNameRate)} | ${percentage(linkpeek.siteNameRate)} | ${percentage(merged.siteNameRate)} |\n` +
    `| Metadata-only rescues | ${current.metadataOnlyRescues} | ${linkpeek.metadataOnlyRescues} | ${merged.metadataOnlyRescues} |\n` +
    `| Parser p50 | ${current.runtimeMs.p50} ms | ${linkpeek.runtimeMs.p50} ms | ${merged.runtimeMs.p50} ms |\n` +
    `| Parser p95 | ${current.runtimeMs.p95} ms | ${linkpeek.runtimeMs.p95} ms | ${merged.runtimeMs.p95} ms |\n\n` +
    `- Title agreement when both exist: ${percentage(report.summary.agreement.title.rate)} (${report.summary.agreement.title.compared} pages)\n` +
    `- Author agreement when both exist: ${percentage(report.summary.agreement.author.rate)} (${report.summary.agreement.author.compared} pages)\n` +
    `- Image agreement when both exist: ${percentage(report.summary.agreement.image.rate)} (${report.summary.agreement.image.compared} pages)\n`;
}

const targets = await loadTargets();
process.stdout.write(`Comparing metadata on ${targets.length} distinct public URLs with concurrency ${CONCURRENCY}.\n`);
const results = await mapConcurrent(targets, compareUrl);
const compared = results.filter((result) => result.current && result.linkpeek && result.merged);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  methodology: 'One direct HTML fetch per URL; identical response parsed by the current pipeline and linkpeek, then safely merged with current fields taking precedence.',
  summary: {
    attempted: targets.length,
    compared: compared.length,
    fetchFailures: results.length - compared.length,
    current: summarize(compared, 'current'),
    linkpeek: summarize(compared, 'linkpeek'),
    merged: summarize(compared, 'merged'),
    agreement: {
      title: agreement(compared, 'title'),
      author: agreement(compared, 'author'),
      image: agreement(compared, 'image'),
    },
  },
  results,
};

await mkdir(REPORT_DIRECTORY, { recursive: true });
const stamp = report.generatedAt.replace(/[:.]/g, '-');
const json = `${JSON.stringify(report, null, 2)}\n`;
const markdown = reportMarkdown(report);
await Promise.all([
  Bun.write(`${REPORT_DIRECTORY}/metadata-${stamp}.json`, json),
  Bun.write(`${REPORT_DIRECTORY}/metadata-${stamp}.md`, markdown),
  Bun.write(`${REPORT_DIRECTORY}/metadata-latest.json`, json),
  Bun.write(`${REPORT_DIRECTORY}/metadata-latest.md`, markdown),
]);
process.stdout.write(markdown);
