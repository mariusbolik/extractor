import { mkdir } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { Defuddle } from 'defuddle/node';
import { parseHTML } from 'linkedom';
import { fetchPublicPage } from '@extractor/core/fetch';
import { extractMarkdownFromHtml } from '@extractor/core/markdown';

const REPORT_DIRECTORY = '.benchmark-reports';
const MIN_USEFUL_CONTENT = 80;
const CONCURRENCY = 5;
const TARGET_COUNT = 220;
const TRANCO_URL = 'https://tranco-list.eu/top-1m.csv.zip';

function unzipFirstEntry(archive) {
  const endSignature = 0x06054b50;
  let endOffset = -1;
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (archive.readUInt32LE(offset) === endSignature) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('Tranco response is not a supported ZIP archive.');
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  const method = archive.readUInt16LE(centralOffset + 10);
  const compressedSize = archive.readUInt32LE(centralOffset + 20);
  const localOffset = archive.readUInt32LE(centralOffset + 42);
  const nameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const dataOffset = localOffset + 30 + nameLength + extraLength;
  const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
  if (method === 0) return compressed;
  if (method === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method ${method}.`);
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function words(content) {
  return content.trim().split(/\s+/).filter(Boolean);
}

function noisePerThousandWords(content) {
  const matches = content.match(/\b(?:accept all cookies|advertisement|all rights reserved|cookie settings|log in|navigation|privacy policy|sign in|subscribe|terms of (?:service|use))\b/gi)?.length || 0;
  return Number(((matches / Math.max(1, words(content).length)) * 1_000).toFixed(2));
}

function resultMetrics(result, durationMs) {
  const content = result.content.trim();
  return {
    success: content.length >= MIN_USEFUL_CONTENT,
    durationMs: Number(durationMs.toFixed(2)),
    contentLength: content.length,
    wordCount: words(content).length,
    noisePerThousandWords: noisePerThousandWords(content),
    title: result.title?.trim() || null,
    author: result.author?.trim() || null,
    publishedAt: result.publishedAt?.trim() || null,
    preview: content.slice(0, 240),
  };
}

function failedMetrics(error, durationMs) {
  return {
    success: false,
    durationMs: Number(durationMs.toFixed(2)),
    contentLength: 0,
    wordCount: 0,
    noisePerThousandWords: 0,
    title: null,
    author: null,
    publishedAt: null,
    preview: '',
    error: error instanceof Error ? error.message : String(error),
  };
}

function runCurrent(html, url) {
  const started = performance.now();
  try {
    const result = extractMarkdownFromHtml(html, url);
    return resultMetrics({ ...result, publishedAt: null }, performance.now() - started);
  } catch (error) {
    return failedMetrics(error, performance.now() - started);
  }
}

async function runDefuddle(html, url) {
  const started = performance.now();
  try {
    const { document } = parseHTML(html);
    const result = await Defuddle(document, url, { markdown: true });
    let content = result.content?.trim() || '';
    const title = result.title?.trim() || null;
    if (title && content && !content.startsWith('# ')) content = `# ${title}\n\n${content}`;
    return resultMetrics({
      content,
      title,
      author: result.author || null,
      publishedAt: result.published || null,
    }, performance.now() - started);
  } catch (error) {
    return failedMetrics(error, performance.now() - started);
  }
}

async function loadTargets() {
  const urls = new Set();
  const reports = new Bun.Glob('**/production-*.json');
  for await (const path of reports.scan('.smoke-reports')) {
    const report = await Bun.file(`.smoke-reports/${path}`).json();
    for (const result of report.results || []) {
      if (typeof result.url === 'string') urls.add(result.url);
    }
  }
  if (urls.size < 100) throw new Error(`The smoke reports contain only ${urls.size} distinct public URLs.`);

  // The saved production corpus is the stable baseline. Supplement it from
  // the current Tranco list so at least 100 actual HTML responses remain after
  // blocked, timed-out, and non-HTML origins are excluded.
  if (urls.size < TARGET_COUNT) {
    const response = await fetch(TRANCO_URL, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Tranco returned HTTP ${response.status}.`);
    const csv = unzipFirstEntry(Buffer.from(await response.arrayBuffer())).toString('utf8');
    const rows = csv.trim().split(/\r?\n/);
    const stride = Math.max(1, Math.floor(rows.length / (TARGET_COUNT * 4)));
    for (let index = Math.floor(stride / 2); index < rows.length && urls.size < TARGET_COUNT; index += stride) {
      const domain = rows[index]?.slice(rows[index].indexOf(',') + 1).trim();
      if (domain && /^[a-z0-9.-]+$/i.test(domain) && domain.includes('.')) urls.add(`https://${domain}/`);
    }
  }

  if (urls.size < TARGET_COUNT) throw new Error(`Could only assemble ${urls.size} benchmark targets.`);
  return [...urls].sort().slice(0, TARGET_COUNT);
}

async function compareUrl(url) {
  const started = Date.now();
  try {
    // One source response is intentionally shared by both extractors. Request
    // HTML explicitly so content negotiation cannot bypass the comparison.
    const page = await fetchPublicPage(
      new URL(url),
      fetch,
      'text/html, application/xhtml+xml;q=0.9, */*;q=0.1',
    );
    const contentType = page.contentType.split(';', 1)[0];
    if (!['text/html', 'application/xhtml+xml'].includes(contentType) && !/^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(page.body)) {
      throw new Error(`Source returned ${contentType || 'an unknown content type'} instead of HTML.`);
    }
    const [current, defuddle] = await Promise.all([
      Promise.resolve(runCurrent(page.body, page.url)),
      runDefuddle(page.body, page.url),
    ]);
    return { url, fetchedUrl: page.url, fetchMs: Date.now() - started, current, defuddle };
  } catch (error) {
    return {
      url,
      fetchedUrl: null,
      fetchMs: Date.now() - started,
      fetchError: error instanceof Error ? error.message : String(error),
      current: null,
      defuddle: null,
    };
  }
}

async function mapConcurrent(values, concurrency, mapper) {
  const output = new Array(values.length);
  let next = 0;
  async function worker() {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await mapper(values[index]);
      const result = output[index];
      const status = result.fetchError
        ? 'fetch-error'
        : `${result.current.success ? 'R' : '-'}${result.defuddle.success ? 'D' : '-'}`;
      process.stdout.write(`[${index + 1}/${values.length}] ${status.padEnd(11)} ${values[index]}\n`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return output;
}

function summarizeImplementation(rows, key) {
  const results = rows.map((row) => row[key]);
  const successful = results.filter((result) => result.success);
  const fieldRate = (field) => successful.length
    ? Number((successful.filter((result) => result[field]).length / successful.length).toFixed(4))
    : 0;
  return {
    successes: successful.length,
    successRateOfFetchedHtml: Number((successful.length / Math.max(1, results.length)).toFixed(4)),
    titleRate: fieldRate('title'),
    authorRate: fieldRate('author'),
    publishedAtRate: fieldRate('publishedAt'),
    averageNoisePerThousandWords: Number((successful.reduce((sum, result) => sum + result.noisePerThousandWords, 0) / Math.max(1, successful.length)).toFixed(2)),
    medianWords: percentile(successful.map((result) => result.wordCount), 0.5),
    runtimeMs: {
      p50: percentile(results.map((result) => result.durationMs), 0.5),
      p95: percentile(results.map((result) => result.durationMs), 0.95),
      total: Number(results.reduce((sum, result) => sum + result.durationMs, 0).toFixed(2)),
    },
  };
}

function score(summary, fastestP50) {
  const relativeSpeed = fastestP50 / Math.max(fastestP50, summary.runtimeMs.p50 || fastestP50);
  return Number((
    summary.successRateOfFetchedHtml * 60
    + Math.max(0, 15 - summary.averageNoisePerThousandWords)
    + summary.titleRate * 8
    + summary.authorRate * 5
    + summary.publishedAtRate * 7
    + relativeSpeed * 5
  ).toFixed(2));
}

function markdownReport(report) {
  const { current, defuddle } = report.summary;
  const disagreements = report.results.filter((row) => row.current && row.current.success !== row.defuddle.success);
  return `# Extractor shadow benchmark\n\n` +
    `Generated ${report.generatedAt}. Both implementations received identical HTML for every compared URL.\n\n` +
    `- Public URLs attempted: ${report.summary.attempted}\n` +
    `- HTML responses compared: ${report.summary.compared}\n` +
    `- Fetch failures/non-HTML responses: ${report.summary.fetchFailures}\n\n` +
    `| Metric | Current Readability/Turndown | Defuddle |\n|---|---:|---:|\n` +
    `| Composite score | ${current.score} | ${defuddle.score} |\n` +
    `| Successful extractions | ${current.successes} | ${defuddle.successes} |\n` +
    `| Success rate | ${(current.successRateOfFetchedHtml * 100).toFixed(1)}% | ${(defuddle.successRateOfFetchedHtml * 100).toFixed(1)}% |\n` +
    `| Title recovery | ${(current.titleRate * 100).toFixed(1)}% | ${(defuddle.titleRate * 100).toFixed(1)}% |\n` +
    `| Author recovery | ${(current.authorRate * 100).toFixed(1)}% | ${(defuddle.authorRate * 100).toFixed(1)}% |\n` +
    `| Publication-date recovery | ${(current.publishedAtRate * 100).toFixed(1)}% | ${(defuddle.publishedAtRate * 100).toFixed(1)}% |\n` +
    `| Noise / 1,000 words | ${current.averageNoisePerThousandWords} | ${defuddle.averageNoisePerThousandWords} |\n` +
    `| Median words | ${current.medianWords} | ${defuddle.medianWords} |\n` +
    `| Parser p50 | ${current.runtimeMs.p50} ms | ${defuddle.runtimeMs.p50} ms |\n` +
    `| Parser p95 | ${current.runtimeMs.p95} ms | ${defuddle.runtimeMs.p95} ms |\n\n` +
    `## Coverage disagreements\n\n` +
    disagreements.map((row) => `- ${row.url}: current=${row.current.success}, defuddle=${row.defuddle.success}`).join('\n') + '\n';
}

const targets = await loadTargets();
process.stdout.write(`Comparing ${targets.length} distinct public URLs with concurrency ${CONCURRENCY}.\n`);
const results = await mapConcurrent(targets, CONCURRENCY, compareUrl);
const compared = results.filter((result) => result.current && result.defuddle);
const current = summarizeImplementation(compared, 'current');
const defuddle = summarizeImplementation(compared, 'defuddle');
const fastestP50 = Math.max(0.01, Math.min(current.runtimeMs.p50 || Infinity, defuddle.runtimeMs.p50 || Infinity));
current.score = score(current, fastestP50);
defuddle.score = score(defuddle, fastestP50);

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  methodology: 'One direct HTML fetch per URL; identical response parsed by current Readability/Turndown and Defuddle.',
  summary: {
    attempted: targets.length,
    compared: compared.length,
    fetchFailures: results.length - compared.length,
    current,
    defuddle,
    winner: defuddle.score > current.score ? 'defuddle' : 'current',
  },
  results,
};

await mkdir(REPORT_DIRECTORY, { recursive: true });
const stamp = report.generatedAt.replace(/[:.]/g, '-');
const json = `${JSON.stringify(report, null, 2)}\n`;
const markdown = markdownReport(report);
await Promise.all([
  Bun.write(`${REPORT_DIRECTORY}/extractors-${stamp}.json`, json),
  Bun.write(`${REPORT_DIRECTORY}/extractors-${stamp}.md`, markdown),
  Bun.write(`${REPORT_DIRECTORY}/latest.json`, json),
  Bun.write(`${REPORT_DIRECTORY}/latest.md`, markdown),
]);

process.stdout.write(markdown);
process.stdout.write(`\nWinner: ${report.summary.winner}\n`);
