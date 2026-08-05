const GOOGLE_NEWS_HOST = 'news.google.com';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_HEADER_BYTES = 32 * 1024;

interface SocketLike {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close(): void;
}

type OpenSocket = () => SocketLike | Promise<SocketLike>;

function headerBoundary(bytes: Uint8Array): number {
  for (let index = 0; index <= bytes.length - 4; index += 1) {
    if (
      bytes[index] === 13
      && bytes[index + 1] === 10
      && bytes[index + 2] === 13
      && bytes[index + 3] === 10
    ) return index;
  }
  return -1;
}

function concatenate(chunks: Uint8Array[], total: number): Uint8Array {
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function readBounded(socket: SocketLike, signal: AbortSignal): Promise<Uint8Array> {
  const reader = socket.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const closeOnAbort = () => socket.close();
  signal.addEventListener('abort', closeOnAbort, { once: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES + MAX_HEADER_BYTES) {
        throw new Error('Google News returned more than 5 MB.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error;
  } finally {
    signal.removeEventListener('abort', closeOnAbort);
    reader.releaseLock();
  }
  return concatenate(chunks, total);
}

function decodeChunked(body: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let offset = 0;
  while (offset < body.length) {
    let lineEnd = -1;
    for (let index = offset; index < body.length - 1; index += 1) {
      if (body[index] === 13 && body[index + 1] === 10) {
        lineEnd = index;
        break;
      }
    }
    if (lineEnd < 0) throw new Error('Google News returned malformed chunked data.');
    const sizeLine = new TextDecoder().decode(body.slice(offset, lineEnd)).split(';', 1)[0] ?? '';
    const size = Number.parseInt(sizeLine, 16);
    if (!Number.isFinite(size) || size < 0) throw new Error('Google News returned an invalid chunk size.');
    if (size === 0) break;
    const start = lineEnd + 2;
    const end = start + size;
    if (end + 2 > body.length || body[end] !== 13 || body[end + 1] !== 10) {
      throw new Error('Google News returned truncated chunked data.');
    }
    total += size;
    if (total > MAX_RESPONSE_BYTES) throw new Error('Google News returned more than 5 MB.');
    chunks.push(body.slice(start, end));
    offset = end + 2;
  }
  return concatenate(chunks, total);
}

function socketResponse(bytes: Uint8Array): Response {
  const boundary = headerBoundary(bytes);
  if (boundary < 0 || boundary > MAX_HEADER_BYTES) {
    throw new Error('Google News returned invalid HTTP headers.');
  }
  const headerText = new TextDecoder().decode(bytes.slice(0, boundary));
  const lines = headerText.split('\r\n');
  const statusMatch = lines.shift()?.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/);
  if (!statusMatch) throw new Error('Google News returned an invalid HTTP status.');
  const headers = new Headers();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator > 0) headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }
  if (headers.has('content-encoding') && headers.get('content-encoding') !== 'identity') {
    throw new Error('Google News ignored the uncompressed-response request.');
  }
  const encodedBody = bytes.slice(boundary + 4);
  const body = /(?:^|,)\s*chunked\s*(?:,|$)/i.test(headers.get('transfer-encoding') ?? '')
    ? decodeChunked(encodedBody)
    : encodedBody;
  if (body.byteLength > MAX_RESPONSE_BYTES) throw new Error('Google News returned more than 5 MB.');

  // These describe the wire representation, not the decoded Response body.
  headers.delete('connection');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  // Copy into an ArrayBuffer so both Workers and the Node-based type checker
  // agree on the BodyInit shape (Uint8Array may be backed by SharedArrayBuffer).
  const responseBody = Uint8Array.from(body).buffer;
  return new Response(responseBody, {
    status: Number(statusMatch[1]),
    statusText: statusMatch[2] ?? '',
    headers,
  });
}

async function defaultSocket(): Promise<SocketLike> {
  // `cloudflare:sockets` belongs to the hosting integration, not the portable
  // core package. A dynamic import also keeps Bun/Vitest fixture runs portable.
  const { connect } = await import('cloudflare:sockets');
  return connect(
    { hostname: GOOGLE_NEWS_HOST, port: 443 },
    { secureTransport: 'on', allowHalfOpen: true },
  );
}

/**
 * Fetch one hard-coded Google News feed over TLS without the Workers `fetch`
 * egress path. The ordinary fetch pool is intermittently throttled by this
 * source; a bounded socket request proved both faster and reliable in edge
 * benchmarks. This is intentionally not a generic socket fetcher: accepting an
 * arbitrary host here would bypass the core package's SSRF and redirect guards.
 */
export async function fetchGoogleNewsRssWithSocket(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  openSocket: OpenSocket,
): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (
    request.method !== 'GET'
    || url.protocol !== 'https:'
    || url.hostname !== GOOGLE_NEWS_HOST
    || !url.pathname.startsWith('/rss')
  ) throw new TypeError('The socket transport accepts only Google News RSS GET requests.');

  const timeoutSignal = AbortSignal.timeout(2_500);
  const signal = request.signal.aborted
    ? request.signal
    : AbortSignal.any([request.signal, timeoutSignal]);
  const socket = await openSocket();
  try {
    if (signal.aborted) throw signal.reason;
    const writer = socket.writable.getWriter();
    try {
      const path = `${url.pathname}${url.search}`;
      const source = [
        `GET ${path} HTTP/1.1`,
        `Host: ${GOOGLE_NEWS_HOST}`,
        `Accept: ${request.headers.get('accept') ?? 'application/rss+xml, application/xml, text/xml;q=0.9'}`,
        'Accept-Encoding: identity',
        `User-Agent: ${request.headers.get('user-agent') ?? 'extractor.sh/1.0 (+https://extractor.sh)'}`,
        'Connection: close',
        '',
        '',
      ].join('\r\n');
      await writer.write(new TextEncoder().encode(source));
    } finally {
      writer.releaseLock();
    }
    return socketResponse(await readBounded(socket, signal));
  } finally {
    socket.close();
  }
}

export function fetchGoogleNewsRss(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetchGoogleNewsRssWithSocket(input, init, defaultSocket);
}
