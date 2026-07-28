/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { DATA_BASE, MAX_CACHE_AGE_MS } from '../config';
import { readCachedTle, writeCachedTle } from '../cache/tleCache';
import { parseTleText } from '../math/tle';
import type { DataMeta, TleRecord } from '../../types';

export interface TleLoadResult {
  records: TleRecord[];
  fetchedAt: number;
  source: 'network' | 'cache';
  /** Present when we fell back to cache because the network failed. */
  warning?: string;
}

const RETRY_DELAYS_MS = [400, 1200, 3000];

/** An abort is the caller cancelling, not a broken network. Never retry it. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === 'AbortError'
    : err instanceof Error && err.name === 'AbortError';
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url, init);
      // 5xx and 429 are worth another go; 4xx are not.
      if (res.status >= 500 || res.status === 429) {
        lastError = new Error(`Server returned ${res.status}`);
      } else {
        return res;
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
    }
    if (init.signal?.aborted) break;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) break;
    await sleep(delay);
  }
  throw lastError instanceof Error ? lastError : new Error('Network request failed');
}

/**
 * Load the constellation.
 *
 * In order: conditional network request (cheap 304 if nothing changed), then
 * the IndexedDB copy, then give up. A slightly stale set beats an empty globe,
 * but only so far. Past MAX_CACHE_AGE_MS the SGP4 error is big enough that
 * showing it would be lying.
 */
export async function loadTle(signal?: AbortSignal): Promise<TleLoadResult> {
  const cached = await readCachedTle().catch(() => null);
  const cacheUsable = cached && Date.now() - cached.fetchedAt < MAX_CACHE_AGE_MS;

  try {
    const headers: Record<string, string> = {};
    if (cached?.etag) headers['If-None-Match'] = cached.etag;

    const res = await fetchWithRetry(`${DATA_BASE}/starlink.txt`, { headers, signal });

    if (res.status === 304 && cached) {
      return {
        records: parseTleText(cached.text),
        fetchedAt: cached.fetchedAt,
        source: 'cache',
      };
    }

    if (!res.ok) throw new Error(`Element file returned ${res.status}`);

    // A host with SPA rewrites answers a missing file with index.html and a
    // 200. Parsing that gives "no satellites" and sends you debugging the wrong
    // half of the app, so say what actually happened.
    const contentType = res.headers.get('Content-Type') ?? '';
    if (contentType.includes('text/html')) {
      throw new Error(
        `Expected element data at ${DATA_BASE}/starlink.txt but got a web page. ` +
          'The data file is missing from this deployment.'
      );
    }

    const text = await res.text();
    const records = parseTleText(text);
    if (records.length === 0) throw new Error('Element file contained no satellites');

    // The element file has no timestamp in it, so ask meta.json when it was
    // pulled. Last-Modified if meta.json has gone missing.
    const fetchedAt = (await fetchMeta(signal))?.fetchedAt ?? lastModified(res) ?? Date.now();
    void writeCachedTle({ text, fetchedAt, etag: res.headers.get('ETag') });

    return { records, fetchedAt, source: 'network' };
  } catch (err) {
    // A cancelled load says nothing about the network. Rethrow so the caller
    // drops the run instead of showing a bogus staleness warning.
    if (isAbortError(err)) throw err;
    if (cacheUsable && cached) {
      return {
        records: parseTleText(cached.text),
        fetchedAt: cached.fetchedAt,
        source: 'cache',
        warning:
          err instanceof Error
            ? `Using cached elements. ${err.message}`
            : 'Using cached elements. Network unavailable.',
      };
    }
    throw err;
  }
}

/** Small freshness probe used to decide whether to re-download the full set. */
export async function fetchMeta(signal?: AbortSignal): Promise<DataMeta | null> {
  try {
    const res = await fetch(`${DATA_BASE}/meta.json`, { signal });
    if (!res.ok) return null;
    const meta = (await res.json()) as DataMeta;
    return typeof meta?.fetchedAt === 'number' ? meta : null;
  } catch {
    return null;
  }
}

function lastModified(res: Response): number | null {
  const raw = res.headers.get('Last-Modified');
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
