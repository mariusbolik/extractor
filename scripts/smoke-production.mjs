import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const DEFAULT_BASE_URL = 'https://extractor.sh';
const TRANCO_URL = 'https://tranco-list.eu/top-1m.csv.zip';
const DEFAULT_COUNT = 100;
const DEFAULT_DELAY_MS = 2_200;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MINIMUM_SUCCESS_RATE = 0.6;
const apiKey = process.env.EXTRACTOR_API_KEY?.trim() || null;
const serviceSubject = process.env.EXTRACTOR_SERVICE_SUBJECT?.trim() || null;

const TWO_LEVEL_PUBLIC_SUFFIXES = new Set([
  'ac.uk', 'co.jp', 'co.kr', 'co.nz', 'co.uk', 'com.ar', 'com.au', 'com.br',
  'com.cn', 'com.mx', 'com.sg', 'com.tr', 'com.tw', 'com.ua', 'gov.uk',
  'net.au', 'ne.jp', 'org.au', 'org.uk',
]);

function usage() {
  return `Production smoke test for extractor.sh

Usage:
  bun run test:smoke:prod -- [options]

Options:
  --base-url <url>             API origin (default: ${DEFAULT_BASE_URL})
  --count <number>             Distinct websites to test (default: ${DEFAULT_COUNT})
  --delay-ms <number>          Delay between request starts (default: ${DEFAULT_DELAY_MS})
  --concurrency <number>       Maximum requests in flight (default: ${DEFAULT_CONCURRENCY})
  --timeout-ms <number>        Per-request timeout (default: ${DEFAULT_TIMEOUT_MS})
  --minimum-success-rate <n>   Required 0..1 success rate (default: ${DEFAULT_MINIMUM_SUCCESS_RATE})
  --url-file <path>            Use newline-delimited URLs instead of Tranco
  --report-dir <path>          Report directory (default: .smoke-reports)
  --help                       Show this help
`;
}

function parseNumber(value, name, { min, max }) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${name} must be between ${min} and ${max}.`);
  }
  return number;
}

function parseOptions(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    count: DEFAULT_COUNT,
    delayMs: DEFAULT_DELAY_MS,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    minimumSuccessRate: DEFAULT_MINIMUM_SUCCESS_RATE,
    reportDir: '.smoke-reports',
    urlFile: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      console.log(usage());
      process.exit(0);
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}.`);
    index += 1;

    if (argument === '--base-url') options.baseUrl = new URL(value).origin;
    else if (argument === '--count') options.count = parseNumber(value, argument, { min: 1, max: 1_000 });
    else if (argument === '--delay-ms') options.delayMs = parseNumber(value, argument, { min: 0, max: 60_000 });
    else if (argument === '--concurrency') options.concurrency = parseNumber(value, argument, { min: 1, max: 20 });
    else if (argument === '--timeout-ms') options.timeoutMs = parseNumber(value, argument, { min: 1_000, max: 180_000 });
    else if (argument === '--minimum-success-rate') options.minimumSuccessRate = parseNumber(value, argument, { min: 0, max: 1 });
    else if (argument === '--url-file') options.urlFile = value;
    else if (argument === '--report-dir') options.reportDir = value;
    else throw new Error(`Unknown option: ${argument}`);
  }

  return options;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
  if (archive.readUInt32LE(centralOffset) !== 0x02014b50) {
    throw new Error('Tranco ZIP central directory is invalid.');
  }

  const method = archive.readUInt16LE(centralOffset + 10);
  const compressedSize = archive.readUInt32LE(centralOffset + 20);
  const localOffset = archive.readUInt32LE(centralOffset + 42);
  if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error('Tranco ZIP local file header is invalid.');
  }

  const nameLength = archive.readUInt16LE(localOffset + 26);
  const extraLength = archive.readUInt16LE(localOffset + 28);
  const dataOffset = localOffset + 30 + nameLength + extraLength;
  const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
  if (method === 0) return compressed;
  if (method === 8) return inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method ${method}.`);
}

function siteKey(hostname) {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const suffix = labels.slice(-2).join('.');
  return TWO_LEVEL_PUBLIC_SUFFIXES.has(suffix)
    ? labels.slice(-3).join('.')
    : suffix;
}

function validDomain(domain) {
  return domain.length <= 253
    && domain.includes('.')
    && !domain.includes('..')
    && /^[a-z0-9.-]+$/i.test(domain)
    && domain.split('.').every((label) => label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-'));
}

function sampleTranco(rows, count) {
  const allocations = [
    { start: 1, end: 1_000, weight: 0.4 },
    { start: 1_001, end: 10_000, weight: 0.3 },
    { start: 10_001, end: 100_000, weight: 0.2 },
    { start: 100_001, end: 1_000_000, weight: 0.1 },
  ];
  const selected = [];
  const seenSites = new Set();

  for (let bandIndex = 0; bandIndex < allocations.length; bandIndex += 1) {
    const band = allocations[bandIndex];
    const remaining = count - selected.length;
    const wanted = bandIndex === allocations.length - 1
      ? remaining
      : Math.round(count * band.weight);
    if (wanted <= 0) continue;
    const stride = Math.max(1, Math.floor((band.end - band.start + 1) / wanted));

    for (let step = 0; step < wanted; step += 1) {
      const preferredRank = band.start + Math.floor(stride / 2) + step * stride;
      for (let offset = 0; offset < stride && selected.length < count; offset += 1) {
        const row = rows[preferredRank - 1 + offset];
        if (!row || !validDomain(row.domain)) continue;
        const key = siteKey(row.domain);
        if (seenSites.has(key)) continue;
        seenSites.add(key);
        selected.push({ url: `https://${row.domain}/`, rank: row.rank, source: 'tranco' });
        break;
      }
    }
  }

  if (selected.length < count) throw new Error(`Only found ${selected.length} distinct Tranco websites.`);
  return selected;
}

async function targetsFromTranco(count) {
  console.log(`Downloading current Tranco list from ${TRANCO_URL}`);
  const response = await fetch(TRANCO_URL, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Tranco returned HTTP ${response.status}.`);
  const archive = Buffer.from(await response.arrayBuffer());
  const csv = unzipFirstEntry(archive).toString('utf8');
  const rows = csv.trim().split(/\r?\n/).map((line) => {
    const separator = line.indexOf(',');
    return { rank: Number(line.slice(0, separator)), domain: line.slice(separator + 1).trim() };
  });

  return {
    metadata: {
      name: 'Tranco top one million',
      url: TRANCO_URL,
      lastModified: response.headers.get('last-modified'),
      etag: response.headers.get('etag'),
      retrievedAt: new Date().toISOString(),
    },
    targets: sampleTranco(rows, count),
  };
}

async function targetsFromFile(path, count) {
  const contents = await readFile(path, 'utf8');
  const targets = [];
  const seenSites = new Set();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const url = new URL(line);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`Unsupported URL in ${path}: ${line}`);
    const key = siteKey(url.hostname);
    if (seenSites.has(key)) continue;
    seenSites.add(key);
    targets.push({ url: url.toString(), rank: null, source: 'file' });
    if (targets.length === count) break;
  }
  if (targets.length < count) throw new Error(`${path} contains only ${targets.length} distinct websites; ${count} requested.`);
  return {
    metadata: { name: 'URL file', path, retrievedAt: new Date().toISOString() },
    targets,
  };
}

const extractionSources = new Set([
  'web', 'web-search', 'image-search', 'video-search', 'place-search', 'finance', 'amazon', 'app-store', 'bluesky', 'google-news', 'google-play',
  'instagram', 'mastodon', 'reddit', 'shopify', 'woocommerce', 'soundcloud', 'spotify', 'tiktok', 'vimeo', 'x', 'yahoo-finance', 'youtube',
]);
const entityTypes = new Set(['document', 'article', 'product', 'post', 'profile', 'video', 'audio', 'feed']);

function validPrice(value) {
  return value === undefined || (Number.isInteger(value) && value >= 0);
}

function validEntity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!entityTypes.has(value.type) || !extractionSources.has(value.source)) return false;
  if (Object.hasOwn(value, 'kind') || Object.hasOwn(value, 'method')) return false;
  if (!(value.id === null || typeof value.id === 'string')) return false;
  if (typeof value.url !== 'string') return false;
  if (!(value.title === null || typeof value.title === 'string')) return false;
  if (!(value.author === null || typeof value.author === 'string')) return false;
  if (!(value.publishedAt === null || typeof value.publishedAt === 'string')) return false;
  if (typeof value.content !== 'string' || !Array.isArray(value.media)) return false;
  if (!value.attributes || typeof value.attributes !== 'object' || Array.isArray(value.attributes)) return false;
  if (!validPrice(value.attributes.price)) return false;
  if (!validPrice(value.attributes.compareAtPrice)) return false;
  if (value.attributes.variants !== undefined) {
    if (!Array.isArray(value.attributes.variants)) return false;
    if (value.attributes.variants.some((variant) => !variant || typeof variant !== 'object' || !validPrice(variant.price) || !validPrice(variant.compareAtPrice))) return false;
  }
  if (value.type === 'feed' || value.type === 'profile') {
    return Array.isArray(value.items) && value.items.every(validEntity);
  }
  return !Object.hasOwn(value, 'items');
}

function validSuccessBody(value) {
  return value?.schemaVersion === 1 && validEntity(value);
}

function validErrorBody(value) {
  return value
    && typeof value === 'object'
    && typeof value.error?.code === 'string'
    && typeof value.error?.message === 'string';
}

async function testTarget(target, options) {
  const requestUrl = new URL('/api/extract', options.baseUrl);
  requestUrl.searchParams.set('url', target.url);
  requestUrl.searchParams.set('format', 'json');
  const startedAt = Date.now();

  try {
    const response = await fetch(requestUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'extractor.sh-production-smoke/1.0',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(serviceSubject ? { 'X-Extractr-Service-Subject': serviceSubject } : {}),
      },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }

    const result = {
      ...target,
      status: response.status,
      durationMs: Date.now() - startedAt,
      cacheStatus: response.headers.get('x-extractor-cache') || response.headers.get('cf-cache-status'),
      cfRay: response.headers.get('cf-ray'),
      contentLength: text.length,
      outcome: 'source_error',
      errorCode: null,
      errorMessage: null,
    };

    if (response.ok && validSuccessBody(body)) {
      result.outcome = 'success';
      result.contentLength = body.content.length;
      result.extractedSource = body.source;
      result.extractedType = body.type;
    } else if (response.ok) {
      result.outcome = 'invalid_response';
      result.errorMessage = 'Successful response did not match the public API schema.';
    } else if (validErrorBody(body)) {
      result.errorCode = body.error.code;
      result.errorMessage = body.error.message;
      result.outcome = body.error.code === 'rate_limited' ? 'rate_limited' : 'source_error';
    } else {
      result.outcome = 'invalid_response';
      result.errorMessage = `HTTP ${response.status} did not return the public error schema.`;
    }
    return result;
  } catch (error) {
    return {
      ...target,
      status: null,
      durationMs: Date.now() - startedAt,
      cacheStatus: null,
      cfRay: null,
      contentLength: 0,
      outcome: 'transport_error',
      errorCode: error?.name || 'Error',
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function progress(result, completed, total, retry = false) {
  const rank = result.rank ? ` rank=${result.rank}` : '';
  const status = result.status ?? '-';
  const suffix = result.errorCode ? ` ${result.errorCode}` : '';
  console.log(`[${completed}/${total}]${retry ? ' retry' : ''} ${result.outcome.padEnd(16)} HTTP ${status} ${result.durationMs}ms${rank} ${result.url}${suffix}`);
}

async function runPaced(targets, options) {
  const results = new Array(targets.length);
  const inFlight = new Set();
  let completed = 0;

  for (let index = 0; index < targets.length; index += 1) {
    while (inFlight.size >= options.concurrency) await Promise.race(inFlight);
    const promise = testTarget(targets[index], options).then((result) => {
      results[index] = result;
      completed += 1;
      progress(result, completed, targets.length);
    });
    inFlight.add(promise);
    promise.finally(() => inFlight.delete(promise));
    if (index < targets.length - 1) await sleep(options.delayMs);
  }
  await Promise.all(inFlight);
  return results;
}

async function retryBrowserRateLimits(results, options) {
  const retryIndexes = results
    .map((result, index) => ({ result, index }))
    .filter(({ result }) => result.outcome === 'rate_limited' && result.errorMessage?.includes('Browser fallback'));
  if (retryIndexes.length === 0) return results;

  console.log(`\nWaiting 65 seconds before retrying ${retryIndexes.length} browser-rate-limited targets at 5 requests/minute...`);
  await sleep(65_000);
  for (let position = 0; position < retryIndexes.length; position += 1) {
    const { result, index } = retryIndexes[position];
    const retried = await testTarget(result, options);
    retried.retriedAfterBrowserRateLimit = true;
    results[index] = retried;
    progress(retried, position + 1, retryIndexes.length, true);
    if (position < retryIndexes.length - 1) await sleep(12_500);
  }
  return results;
}

async function requestProbe(targetUrl, format, options) {
  const requestUrl = new URL('/api/extract', options.baseUrl);
  requestUrl.searchParams.set('url', targetUrl);
  requestUrl.searchParams.set('format', format);
  const startedAt = Date.now();
  try {
    const response = await fetch(requestUrl, {
      headers: {
        Accept: format === 'markdown' ? 'text/markdown' : 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...(serviceSubject ? { 'X-Extractr-Service-Subject': serviceSubject } : {}),
      },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const body = await response.text();
    return {
      status: response.status,
      durationMs: Date.now() - startedAt,
      contentType: response.headers.get('content-type'),
      cacheStatus: response.headers.get('x-extractor-cache') || response.headers.get('cf-cache-status'),
      contentLength: body.length,
    };
  } catch (error) {
    return {
      status: null,
      durationMs: Date.now() - startedAt,
      contentType: null,
      cacheStatus: null,
      contentLength: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runContractProbes(results, options) {
  const successful = results
    .filter((result) => result.outcome === 'success')
    .sort((left, right) => left.durationMs - right.durationMs);
  if (successful.length === 0) {
    return {
      target: null,
      jsonCache: null,
      markdownInitial: null,
      markdownRepeat: null,
      checks: { jsonCacheHit: false, markdownResponse: false, markdownCacheHit: false },
    };
  }

  const target = successful[0].url;
  console.log(`\nProbing JSON cache and Markdown contract with ${target}`);
  const jsonCache = await requestProbe(target, 'json', options);
  await sleep(options.delayMs);
  const markdownInitial = await requestProbe(target, 'markdown', options);
  await sleep(options.delayMs);
  const markdownRepeat = await requestProbe(target, 'markdown', options);
  const checks = {
    jsonCacheHit: jsonCache.status === 200 && jsonCache.cacheStatus === 'HIT',
    markdownResponse: markdownInitial.status === 200
      && markdownInitial.contentType?.toLowerCase().includes('text/markdown')
      && markdownInitial.contentLength > 0,
    markdownCacheHit: markdownRepeat.status === 200 && markdownRepeat.cacheStatus === 'HIT',
  };
  console.log(`Contract probes: ${JSON.stringify(checks)}`);
  return { target, jsonCache, markdownInitial, markdownRepeat, checks };
}

function summarize(results, options) {
  const outcomes = {};
  const errors = {};
  const durations = [];
  for (const result of results) {
    outcomes[result.outcome] = (outcomes[result.outcome] || 0) + 1;
    if (result.errorCode) {
      const key = `${result.errorCode}: ${result.errorMessage}`;
      errors[key] = (errors[key] || 0) + 1;
    }
    durations.push(result.durationMs);
  }
  durations.sort((a, b) => a - b);
  const percentile = (ratio) => durations[Math.min(durations.length - 1, Math.floor(durations.length * ratio))] || 0;
  const successes = outcomes.success || 0;
  const successRate = successes / results.length;
  const checks = {
    attemptedMinimum: results.length >= options.count,
    successRate: successRate >= options.minimumSuccessRate,
    noInvalidResponses: !outcomes.invalid_response,
    noTransportErrors: !outcomes.transport_error,
    noFinalRateLimits: !outcomes.rate_limited,
  };
  return {
    attempted: results.length,
    distinctSites: new Set(results.map((result) => siteKey(new URL(result.url).hostname))).size,
    successes,
    successRate,
    outcomes,
    errors: Object.entries(errors)
      .map(([message, count]) => ({ message, count }))
      .sort((a, b) => b.count - a.count),
    latencyMs: { p50: percentile(0.5), p95: percentile(0.95), maximum: durations.at(-1) || 0 },
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function markdownReport(report) {
  const errorRows = report.summary.errors.length
    ? report.summary.errors.map((error) => `| ${error.count} | ${error.message.replaceAll('|', '\\|')} |`).join('\n')
    : '| 0 | None |';
  const failedRows = report.results
    .filter((result) => result.outcome !== 'success')
    .map((result) => `| ${result.rank ?? '–'} | ${result.status ?? '–'} | ${result.outcome} | ${result.url} | ${(result.errorMessage || '').replaceAll('|', '\\|')} |`)
    .join('\n') || '| – | – | – | None | – |';

  return `# extractor.sh production smoke report

- Started: ${report.startedAt}
- Finished: ${report.finishedAt}
- API: ${report.configuration.baseUrl}
- Source: ${report.source.name}
- Source last modified: ${report.source.lastModified || 'not provided'}
- Distinct sites: ${report.summary.distinctSites}
- Successful extractions: ${report.summary.successes}/${report.summary.attempted} (${(report.summary.successRate * 100).toFixed(1)}%)
- Result: ${report.summary.passed ? 'PASS' : 'FAIL'}
- Latency: p50 ${report.summary.latencyMs.p50} ms; p95 ${report.summary.latencyMs.p95} ms; max ${report.summary.latencyMs.maximum} ms
- JSON cache probe: ${report.contract.checks.jsonCacheHit ? 'PASS' : 'FAIL'}
- Markdown response probe: ${report.contract.checks.markdownResponse ? 'PASS' : 'FAIL'}
- Markdown cache probe: ${report.contract.checks.markdownCacheHit ? 'PASS' : 'FAIL'}

## Error groups

| Count | Error |
| ---: | --- |
${errorRows}

## Non-successful targets

| Rank | HTTP | Outcome | URL | Detail |
| ---: | ---: | --- | --- | --- |
${failedRows}
`;
}

async function saveReport(report, reportDir) {
  await mkdir(reportDir, { recursive: true });
  const stamp = report.startedAt.replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
  const basePath = `${reportDir}/production-${stamp}`;
  await Promise.all([
    writeFile(`${basePath}.json`, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(`${basePath}.md`, markdownReport(report)),
    writeFile(`${reportDir}/latest.json`, `${JSON.stringify(report, null, 2)}\n`),
    writeFile(`${reportDir}/latest.md`, markdownReport(report)),
  ]);
  return { json: `${basePath}.json`, markdown: `${basePath}.md` };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const startedAt = new Date().toISOString();
  const selection = options.urlFile
    ? await targetsFromFile(options.urlFile, options.count)
    : await targetsFromTranco(options.count);

  console.log(`Testing ${selection.targets.length} distinct websites against ${options.baseUrl}`);
  console.log(`Request starts are paced at ${options.delayMs}ms with concurrency ${options.concurrency}.\n`);
  let results = await runPaced(selection.targets, options);
  results = await retryBrowserRateLimits(results, options);
  const summary = summarize(results, options);
  const contract = await runContractProbes(results, options);
  Object.assign(summary.checks, contract.checks);
  summary.passed = Object.values(summary.checks).every(Boolean);
  const report = {
    schemaVersion: 1,
    startedAt,
    finishedAt: new Date().toISOString(),
    configuration: {
      baseUrl: options.baseUrl,
      count: options.count,
      delayMs: options.delayMs,
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
      minimumSuccessRate: options.minimumSuccessRate,
    },
    source: selection.metadata,
    summary,
    contract,
    results,
  };
  const paths = await saveReport(report, options.reportDir);

  console.log(`\n${summary.passed ? 'PASS' : 'FAIL'}: ${summary.successes}/${summary.attempted} successful (${(summary.successRate * 100).toFixed(1)}%)`);
  console.log(`Outcomes: ${JSON.stringify(summary.outcomes)}`);
  console.log(`Latency: p50=${summary.latencyMs.p50}ms p95=${summary.latencyMs.p95}ms max=${summary.latencyMs.maximum}ms`);
  console.log(`Reports: ${paths.markdown} and ${paths.json}`);
  if (!summary.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
