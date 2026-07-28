/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
/**
 * Pulls the current Starlink element set from Celestrak into public/data/ so
 * the built site can serve it as a plain static file.
 *
 * Celestrak asks for one download per update window, sends no CORS headers, and
 * 403s repeat hits on the big groups. Doing it once per build in CI stays
 * inside all three, and visitors only ever touch GitHub's CDN.
 *
 * If the download fails we fall back to whatever copy we already have: locally
 * that's public/data, in CI it's whatever the last deploy published. A Celestrak
 * hiccup shouldn't take the site down.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CELESTRAK_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle';

const UA = 'starlink-tracker (https://github.com/tristedw/starlink-tracker)';

// The group sits around 10,000 objects and has only ever grown. An order of
// magnitude below that means a truncated transfer or an error page.
const MIN_PLAUSIBLE_COUNT = 1000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/data');
const tleFile = resolve(outDir, 'starlink.txt');
const metaFile = resolve(outDir, 'meta.json');

/** Standard mod-10 checksum on the last character of a TLE line. */
function checksumValid(line) {
  if (line.length < 69) return false;
  let sum = 0;
  for (let i = 0; i < 68; i++) {
    const c = line[i];
    if (c >= '0' && c <= '9') sum += c.charCodeAt(0) - 48;
    else if (c === '-') sum += 1;
  }
  return sum % 10 === Number(line[68]);
}

/**
 * Parse 3LE text, dropping anything malformed. Resyncs on the next line that
 * looks like a line 1 instead of stepping blindly in threes, so one bad triplet
 * doesn't take the rest of the file with it.
 */
function parse(raw) {
  const lines = raw.split(/\r?\n/);
  const out = [];
  const seen = new Set();

  for (let i = 0; i + 2 < lines.length; i++) {
    const l1 = (lines[i + 1] ?? '').trimEnd();
    const l2 = (lines[i + 2] ?? '').trimEnd();
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    if (l1.length < 68 || l2.length < 68) continue;
    if (!checksumValid(l1) || !checksumValid(l2)) continue;

    const id = Number.parseInt(l1.slice(2, 7), 10);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    if (Number.parseInt(l2.slice(2, 7), 10) !== id) continue;

    seen.add(id);
    out.push([(lines[i] ?? '').trim() || `NORAD ${id}`, l1, l2]);
    i += 2;
  }
  return out;
}

/** FNV-1a. Only used to tell "same file" from "new file", not for security. */
function hash(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Celestrak wouldn't give us anything usable.
 *
 * Locally there's usually an older download in public/data. CI starts from an
 * empty checkout, so it pulls back whatever the last successful deploy
 * published. Missing one refresh is annoying. Failing the build over it is
 * worse.
 */
async function keepExisting(reason) {
  if (existsSync(tleFile)) {
    const count = parse(readFileSync(tleFile, 'utf8')).length;
    console.warn(`[fetch-tle] ${reason}. Keeping existing set (${count} satellites).`);
    process.exit(0);
  }

  const fallback = (process.env.FALLBACK_DATA_URL ?? '').trim();
  if (fallback) {
    console.warn(`[fetch-tle] ${reason}. Trying the deployed copy at ${fallback}`);
    try {
      const [tleRes, metaRes] = await Promise.all([
        fetch(`${fallback}/starlink.txt`),
        fetch(`${fallback}/meta.json`),
      ]);
      if (tleRes.ok && metaRes.ok) {
        const prevText = await tleRes.text();
        const prevMeta = await metaRes.json();
        const count = parse(prevText).length;
        if (count >= MIN_PLAUSIBLE_COUNT) {
          mkdirSync(outDir, { recursive: true });
          writeFileSync(tleFile, prevText);
          writeFileSync(metaFile, JSON.stringify(prevMeta, null, 2) + '\n');
          console.warn(`[fetch-tle] Reused the deployed set (${count} satellites).`);
          process.exit(0);
        }
      }
    } catch (err) {
      console.warn(`[fetch-tle] Deployed copy unavailable: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.error(`[fetch-tle] ${reason}, and there is no previous copy to fall back on.`);
  process.exit(1);
}

// Celestrak republishes roughly every 2 hours. Pulling more often than that is
// wasted bandwidth and the quickest way to get an IP firewalled, so leave a
// local copy alone if it's younger than the window. CI always starts empty.
// `--force` overrides.
const FRESH_MS = 100 * 60 * 1000;

if (!process.argv.includes('--force') && existsSync(metaFile) && existsSync(tleFile)) {
  try {
    const prev = JSON.parse(readFileSync(metaFile, 'utf8'));
    const age = Date.now() - prev.fetchedAt;
    if (age >= 0 && age < FRESH_MS) {
      const mins = Math.round(age / 60000);
      console.log(`[fetch-tle] Existing set is ${mins} min old, skipping download.`);
      process.exit(0);
    }
  } catch {
    /* unreadable meta, just refetch */
  }
}

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30_000);

let body;
try {
  const res = await fetch(CELESTRAK_URL, {
    headers: { 'User-Agent': UA, Accept: 'text/plain' },
    signal: controller.signal,
  });
  if (!res.ok) {
    await keepExisting(
      res.status === 403
        ? 'Celestrak rate limited us (one download per update window)'
        : `Celestrak returned HTTP ${res.status}`
    );
  }
  body = await res.text();
} catch (err) {
  await keepExisting(`Celestrak request failed: ${err instanceof Error ? err.message : err}`);
} finally {
  clearTimeout(timeout);
}

// Celestrak reports errors with a 200 and a plain text body.
if (/^\s*(no gp data|invalid query|error)/i.test(body)) {
  await keepExisting(`Celestrak error response: ${body.slice(0, 120).trim()}`);
}

const records = parse(body);
if (records.length < MIN_PLAUSIBLE_COUNT) {
  await keepExisting(`Only ${records.length} valid satellites in the download`);
}

const text = records.map((r) => r.join('\n')).join('\n') + '\n';
const fetchedAt = Date.now();

mkdirSync(outDir, { recursive: true });
writeFileSync(tleFile, text);
writeFileSync(
  metaFile,
  JSON.stringify(
    {
      ok: true,
      satelliteCount: records.length,
      fetchedAt,
      hash: hash(text),
      source: 'celestrak.org GP (Starlink group)',
    },
    null,
    2
  ) + '\n'
);

const kb = Math.round(text.length / 1024);
console.log(
  `[fetch-tle] ${records.length} satellites, ${kb} KB, fetched ${new Date(fetchedAt).toISOString()}`
);
