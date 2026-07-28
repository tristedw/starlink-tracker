/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import type { TleRecord } from '../../types';

/**
 * Parse Celestrak 3LE text (name / line1 / line2 triplets).
 *
 * Same job as the parser in scripts/fetch-tle.mjs, but browser side. The site
 * ships raw TLE text because it's ~18% smaller than the JSON equivalent and
 * gzips better, and every visitor downloads it.
 */
export function parseTleText(raw: string): TleRecord[] {
  const lines = raw.split('\n');
  const records: TleRecord[] = [];
  const seen = new Set<number>();

  for (let i = 0; i + 2 < lines.length; i++) {
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (!l1 || !l2) continue;
    if (l1.charCodeAt(0) !== 49 /* '1' */ || l1.charCodeAt(1) !== 32) continue;
    if (l2.charCodeAt(0) !== 50 /* '2' */ || l2.charCodeAt(1) !== 32) continue;

    const line1 = l1.trimEnd();
    const line2 = l2.trimEnd();
    if (line1.length < 68 || line2.length < 68) continue;

    const noradId = Number.parseInt(line1.substring(2, 7), 10);
    if (!Number.isFinite(noradId) || seen.has(noradId)) continue;
    // Both lines have to describe the same object. A mismatch means the file
    // is misaligned, and pairing them gives you an orbit that looks fine and
    // is completely wrong.
    if (Number.parseInt(line2.substring(2, 7), 10) !== noradId) continue;

    seen.add(noradId);
    records.push({
      name: (lines[i] ?? '').trim() || `NORAD ${noradId}`,
      noradId,
      line1,
      line2,
    });
    i += 2;
  }

  return records;
}

/**
 * Starlink names carry some structure, e.g. "STARLINK-1007" or "STARLINK-30123".
 * Grouping by the leading block is a rough proxy for launch batch, which is how
 * you spot the trains.
 */
export function starlinkBlock(name: string): string | null {
  const m = /^STARLINK[- ](\d+)/i.exec(name.trim());
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  if (!Number.isFinite(n)) return null;
  return String(Math.floor(n / 100) * 100);
}

/**
 * Direct-to-Cell satellites, which Celestrak names `STARLINK-11095 [DTC]`.
 *
 * DTC is a payload variant, not a launch status. They carry an eNodeB that
 * talks to unmodified phones and fly a much lower shell (~330 to 360 km) than
 * the broadband ones, so they move faster, pass quicker and cover less ground.
 * Never assume a Starlink is at 550 km.
 */
export function isDirectToCell(name: string): boolean {
  return /\bDTC\b/i.test(name);
}
