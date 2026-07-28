import { describe, expect, it } from 'vitest';
import { ILLUM } from '../lib/math/constants';
import { haversineKm } from '../lib/math/geo';
import {
  createStateOut,
  inclinationDeg,
  parseSatrec,
  periodMinutes,
  propagateInto,
} from '../lib/math/propagation';
import { illuminationState, sunState } from '../lib/math/sun';
import { gmstFromMs } from '../lib/math/time';
import { parseTleText } from '../lib/math/tle';
import { STARLINK_TLE } from './fixtures';

/**
 * End-to-end checks over a synthetic constellation.
 *
 * Same path the propagation worker takes (parse, propagate, classify
 * illumination) but at a scale where aggregate properties mean something. A
 * per-satellite unit test won't catch "half the constellation ended up in the
 * wrong hemisphere". A population check will.
 */

/**
 * Append the standard mod-10 check digit to a 68-character TLE line, so
 * generated lines are as valid as downloaded ones.
 */
function withChecksum(line: string): string {
  const body = line.slice(0, 68);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c >= '0' && c <= '9') sum += c.charCodeAt(0) - 48;
    else if (c === '-') sum += 1;
  }
  return body + String(sum % 10);
}

/** Build a spread-out constellation by varying RAAN and mean anomaly. */
function syntheticConstellation(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const raan = ((i * 137.5) % 360).toFixed(4).padStart(8, ' ');
    const meanAnom = ((i * 97.3) % 360).toFixed(4).padStart(8, ' ');
    const id = String(40000 + i).padStart(5, '0');
    lines.push(
      `STARLINK-TEST-${i}`,
      `1 ${id}U 19074A   24001.50000000  .00002182  00000-0  16465-3 0  9995`,
      `2 ${id}  53.0546 ${raan} 0001367  91.2338 ${meanAnom} 15.06391320230194`
    );
  }
  return lines.join('\n');
}

describe('constellation-scale propagation', () => {
  const COUNT = 400;
  const records = parseTleText(syntheticConstellation(COUNT));
  const timeMs = Date.UTC(2024, 0, 1, 12, 0, 0);

  it('parses every generated record', () => {
    expect(records).toHaveLength(COUNT);
  });

  it('builds a valid satrec for every record', () => {
    const recs = records.map((r) => parseSatrec(r.line1, r.line2));
    expect(recs.every((r) => r !== null)).toBe(true);
  });

  const states = records.map((r) => {
    const rec = parseSatrec(r.line1, r.line2)!;
    return propagateInto(rec, timeMs, gmstFromMs(timeMs), createStateOut());
  });

  it('propagates every satellite successfully', () => {
    expect(states.every((s) => s.ok)).toBe(true);
  });

  it('produces finite coordinates everywhere', () => {
    for (const s of states) {
      expect(Number.isFinite(s.lat)).toBe(true);
      expect(Number.isFinite(s.lng)).toBe(true);
      expect(Number.isFinite(s.altKm)).toBe(true);
      expect(Number.isFinite(s.speedKmS)).toBe(true);
    }
  });

  it('keeps every satellite in the shell its elements describe', () => {
    // Every synthetic record here shares one mean motion (15.0639 rev/day),
    // so they must all land in that shell. This catches a propagation bug,
    // not a fact about the real constellation, which spans ~330 to 570 km.
    for (const s of states) {
      expect(s.altKm).toBeGreaterThan(500);
      expect(s.altKm).toBeLessThan(600);
      expect(s.speedKmS).toBeGreaterThan(7.4);
      expect(s.speedKmS).toBeLessThan(7.7);
    }
  });

  /**
   * The real fleet is not one shell. One element set per inclination/altitude
   * family Starlink actually flies, propagated and checked, so anything that
   * quietly assumes "53° at 550 km" breaks here instead of mislocating a third
   * of the constellation in production.
   */
  it('derives the right orbit for every real Starlink shell family', () => {
    const shells = [
      { label: 'DTC ~350 km', incl: 53.16, revsPerDay: 15.71, altRange: [320, 400] },
      { label: 'lowered broadband ~480 km', incl: 53.05, revsPerDay: 15.23, altRange: [440, 520] },
      { label: 'shell-1 550 km', incl: 53.05, revsPerDay: 15.06, altRange: [520, 580] },
      { label: 'gen2 43°', incl: 43.0, revsPerDay: 15.13, altRange: [480, 560] },
      { label: 'polar 70°', incl: 70.0, revsPerDay: 14.98, altRange: [540, 620] },
      { label: 'sun-synchronous 97.6°', incl: 97.6, revsPerDay: 15.06, altRange: [520, 580] },
    ];

    for (const shell of shells) {
      const inclField = shell.incl.toFixed(4).padStart(8, ' ');
      const mmField = shell.revsPerDay.toFixed(8).padStart(11, ' ');
      const line1 = '1 55555U 23001A   24001.50000000  .00002182  00000-0  16465-3 0  9990';
      const line2 = `2 55555 ${inclField} 175.4381 0001367  91.2338 268.8819 ${mmField}23019`;
      const rec = parseSatrec(line1, withChecksum(line2));
      expect(rec, shell.label).not.toBeNull();

      const st = propagateInto(rec!, timeMs, gmstFromMs(timeMs), createStateOut());
      expect(st.ok, shell.label).toBe(true);
      expect(inclinationDeg(rec!), shell.label).toBeCloseTo(shell.incl, 3);
      expect(st.altKm, shell.label).toBeGreaterThan(shell.altRange[0]!);
      expect(st.altKm, shell.label).toBeLessThan(shell.altRange[1]!);

      // Retrograde shells reach 180 - i; prograde ones reach i.
      const maxLat = shell.incl > 90 ? 180 - shell.incl : shell.incl;
      expect(Math.abs(st.lat), shell.label).toBeLessThanOrEqual(maxLat + 0.5);
    }
  });

  it('respects the inclination bound for every satellite', () => {
    const inc = inclinationDeg(parseSatrec(STARLINK_TLE.line1, STARLINK_TLE.line2)!);
    for (const s of states) {
      expect(Math.abs(s.lat)).toBeLessThanOrEqual(inc + 0.5);
    }
  });

  it('distributes the constellation across both hemispheres and all longitudes', () => {
    const north = states.filter((s) => s.lat > 0).length;
    const east = states.filter((s) => s.lng > 0).length;
    // A coordinate-conversion sign error would collapse one of these to ~0.
    expect(north).toBeGreaterThan(COUNT * 0.25);
    expect(north).toBeLessThan(COUNT * 0.75);
    expect(east).toBeGreaterThan(COUNT * 0.25);
    expect(east).toBeLessThan(COUNT * 0.75);
  });

  it('spreads satellites out rather than stacking them at one point', () => {
    const first = states[0]!;
    const far = states.filter(
      (s) => haversineKm({ lat: first.lat, lng: first.lng }, { lat: s.lat, lng: s.lng }) > 1000
    ).length;
    expect(far).toBeGreaterThan(COUNT * 0.5);
  });

  it('classifies illumination into a plausible day/night split', () => {
    const sun = sunState(timeMs);
    const counts = { sunlit: 0, penumbra: 0, umbra: 0 };
    for (const s of states) counts[illuminationState(s, sun)]++;

    // Earth's shadow only covers so much sky at LEO, so most of the
    // constellation is lit at any moment, but never all of it.
    expect(counts.sunlit).toBeGreaterThan(COUNT * 0.5);
    expect(counts.umbra).toBeGreaterThan(0);
    expect(counts.sunlit + counts.penumbra + counts.umbra).toBe(COUNT);
  });

  it('keeps positions continuous across a small timestep', () => {
    // The renderers lerp between ticks, which only holds if consecutive
    // samples are close together.
    const later = records.map((r) => {
      const rec = parseSatrec(r.line1, r.line2)!;
      const t = timeMs + 1000;
      return propagateInto(rec, t, gmstFromMs(t), createStateOut());
    });

    for (let i = 0; i < COUNT; i++) {
      const a = states[i]!;
      const b = later[i]!;
      const moved = haversineKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
      // ~7.6 km/s ground speed; one second cannot move it much further.
      expect(moved).toBeLessThan(12);
      expect(Math.abs(a.altKm - b.altKm)).toBeLessThan(5);
    }
  });

  it('returns near the starting point after a full orbital period', () => {
    const rec = parseSatrec(records[0]!.line1, records[0]!.line2)!;
    const period = periodMinutes(rec) * 60_000;
    const a = propagateInto(rec, timeMs, gmstFromMs(timeMs), createStateOut());
    const t2 = timeMs + period;
    const b = propagateInto(rec, t2, gmstFromMs(t2), createStateOut());
    expect(b.lat).toBeCloseTo(a.lat, 0);
    expect(Math.abs(b.altKm - a.altKm)).toBeLessThan(20);
  });
});

describe('illumination code packing', () => {
  it('uses distinct codes with a reserved invalid sentinel', () => {
    const codes = new Set([ILLUM.UMBRA, ILLUM.PENUMBRA, ILLUM.SUNLIT, ILLUM.INVALID]);
    expect(codes.size).toBe(4);
    // Must fit a Uint8Array.
    for (const c of codes) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(255);
    }
  });
});
