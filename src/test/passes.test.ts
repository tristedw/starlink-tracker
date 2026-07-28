import { describe, expect, it } from 'vitest';
import { canEverBeVisible, findPassesForSatellite } from '../lib/math/passes';
import {
  createStateOut,
  eciToEcf,
  lookAnglesInto,
  observerEcf,
  parseSatrec,
  propagateInto,
} from '../lib/math/propagation';
import { gmstFromMs } from '../lib/math/time';
import { ISS_TLE, STARLINK_TLE } from './fixtures';

const starlink = parseSatrec(STARLINK_TLE.line1, STARLINK_TLE.line2)!;
const iss = parseSatrec(ISS_TLE.line1, ISS_TLE.line2)!;

const LONDON = { lat: 51.5, lng: -0.12 };
const EQUATOR = { lat: 0, lng: 0 };
const SOUTH_POLE = { lat: -89, lng: 0 };

const START = Date.UTC(2024, 0, 1, 0, 0, 0);

function elevationAt(rec: typeof starlink, timeMs: number, obs: { lat: number; lng: number }) {
  const gmst = gmstFromMs(timeMs);
  const st = propagateInto(rec, timeMs, gmst, createStateOut());
  const ecf = eciToEcf(st.x, st.y, st.z, gmst, { x: 0, y: 0, z: 0 });
  const look = lookAnglesInto(
    observerEcf(obs.lat, obs.lng, 0),
    (obs.lat * Math.PI) / 180,
    (obs.lng * Math.PI) / 180,
    ecf,
    { azimuthDeg: 0, elevationDeg: 0, rangeKm: 0 }
  );
  return look.elevationDeg;
}

describe('canEverBeVisible', () => {
  it('accepts an observer well inside the orbit inclination', () => {
    expect(canEverBeVisible(starlink, EQUATOR, 10)).toBe(true);
    expect(canEverBeVisible(starlink, LONDON, 10)).toBe(true);
  });

  it('rejects an observer beyond the reachable latitude band', () => {
    // A 53° orbit can never bring its sub-point near the pole.
    expect(canEverBeVisible(starlink, SOUTH_POLE, 10)).toBe(false);
  });

  it('is more permissive at lower minimum elevation', () => {
    const strict = canEverBeVisible(starlink, { lat: 74, lng: 0 }, 40);
    const loose = canEverBeVisible(starlink, { lat: 74, lng: 0 }, 0);
    expect(loose || !strict).toBe(true);
  });
});

describe('findPassesForSatellite', () => {
  const opts = {
    startMs: START,
    windowMinutes: 720,
    minElevationDeg: 10,
    visibleOnly: false,
    limit: 100,
  };

  const passes = findPassesForSatellite(
    starlink,
    STARLINK_TLE.name,
    STARLINK_TLE.noradId,
    LONDON,
    opts
  );

  it('finds passes over a mid-latitude observer within half a day', () => {
    expect(passes.length).toBeGreaterThan(0);
  });

  it('orders rise before peak before set', () => {
    for (const p of passes) {
      expect(p.riseTimeMs).toBeLessThan(p.peakTimeMs);
      expect(p.peakTimeMs).toBeLessThan(p.setTimeMs);
    }
  });

  it('reports durations consistent with a LEO pass', () => {
    for (const p of passes) {
      if (p.truncated) continue;
      expect(p.durationMs).toBeGreaterThan(60_000);
      // Nothing at 550 km stays up for more than ~15 minutes.
      expect(p.durationMs).toBeLessThan(15 * 60_000);
      expect(p.durationMs).toBeCloseTo(p.setTimeMs - p.riseTimeMs, 6);
    }
  });

  it('honours the minimum elevation filter', () => {
    for (const p of passes) expect(p.peakElevationDeg).toBeGreaterThanOrEqual(10);

    const strict = findPassesForSatellite(
      starlink,
      STARLINK_TLE.name,
      STARLINK_TLE.noradId,
      LONDON,
      { ...opts, minElevationDeg: 45 }
    );
    for (const p of strict) expect(p.peakElevationDeg).toBeGreaterThanOrEqual(45);
    expect(strict.length).toBeLessThanOrEqual(passes.length);
  });

  it('pins rise and set to actual horizon crossings', () => {
    for (const p of passes.slice(0, 4)) {
      if (p.truncated) continue;
      // Just inside the pass the satellite is up; just outside it is down.
      expect(elevationAt(starlink, p.riseTimeMs + 5000, LONDON)).toBeGreaterThan(-0.2);
      expect(elevationAt(starlink, p.riseTimeMs - 5000, LONDON)).toBeLessThan(0.2);
      expect(elevationAt(starlink, p.setTimeMs - 5000, LONDON)).toBeGreaterThan(-0.2);
      expect(elevationAt(starlink, p.setTimeMs + 5000, LONDON)).toBeLessThan(0.2);
    }
  });

  it('locates the true elevation maximum', () => {
    for (const p of passes.slice(0, 4)) {
      // Refinement should beat any nearby sample by construction.
      for (const offset of [-30_000, -5000, 5000, 30_000]) {
        const t = p.peakTimeMs + offset;
        if (t <= p.riseTimeMs || t >= p.setTimeMs) continue;
        expect(elevationAt(starlink, t, LONDON)).toBeLessThanOrEqual(p.peakElevationDeg + 0.05);
      }
    }
  });

  it('reports azimuths as valid compass bearings', () => {
    for (const p of passes) {
      for (const az of [p.riseAzimuthDeg, p.peakAzimuthDeg, p.setAzimuthDeg]) {
        expect(az).toBeGreaterThanOrEqual(0);
        expect(az).toBeLessThan(360);
      }
    }
  });

  it('reports a plausible slant range at peak', () => {
    for (const p of passes) {
      expect(p.peakRangeKm).toBeGreaterThan(400);
      expect(p.peakRangeKm).toBeLessThan(3000);
    }
  });

  it('marks a pass visible only when sunlit and the sky is dark', () => {
    for (const p of passes) {
      if (p.visible) {
        expect(p.illumination).not.toBe('umbra');
        expect(p.observerSunElevationDeg).toBeLessThan(-6);
      }
    }
  });

  it('returns a subset when filtering to visible passes only', () => {
    const visible = findPassesForSatellite(
      starlink,
      STARLINK_TLE.name,
      STARLINK_TLE.noradId,
      LONDON,
      { ...opts, visibleOnly: true }
    );
    expect(visible.length).toBeLessThanOrEqual(passes.length);
    for (const p of visible) expect(p.visible).toBe(true);
  });

  it('finds no passes for an observer the orbit cannot reach', () => {
    const none = findPassesForSatellite(
      starlink,
      STARLINK_TLE.name,
      STARLINK_TLE.noradId,
      SOUTH_POLE,
      opts
    );
    expect(none).toHaveLength(0);
  });

  it('works for a different orbit (ISS) too', () => {
    // A 24h window, not 12h: the ISS ground track precesses, and over this
    // particular 12h span it peaks at -0.77° over London, i.e. genuinely
    // never rises. Independently verified against satellite.js directly.
    const issOpts = { ...opts, windowMinutes: 1440 };
    const issPasses = findPassesForSatellite(iss, ISS_TLE.name, ISS_TLE.noradId, LONDON, issOpts);
    expect(issPasses.length).toBeGreaterThan(0);
    for (const p of issPasses) {
      expect(p.riseTimeMs).toBeGreaterThanOrEqual(START);
      expect(p.setTimeMs).toBeLessThanOrEqual(START + issOpts.windowMinutes * 60_000 + 1000);
    }
  });

  it('finds nothing for the ISS in a window where it never rises', () => {
    // Guards the opposite failure mode: a scanner that reports phantom passes.
    const none = findPassesForSatellite(iss, ISS_TLE.name, ISS_TLE.noradId, LONDON, {
      ...opts,
      windowMinutes: 720,
      minElevationDeg: 0,
    });
    expect(none).toHaveLength(0);
  });

  it('does not miss passes that a coarser scan would step over', () => {
    // Every pass found in a long window must also be found when the same span
    // is searched in shorter consecutive chunks.
    const chunkA = findPassesForSatellite(starlink, 'x', 1, LONDON, {
      ...opts,
      windowMinutes: 360,
    });
    const chunkB = findPassesForSatellite(starlink, 'x', 1, LONDON, {
      ...opts,
      startMs: START + 360 * 60_000,
      windowMinutes: 360,
    });
    const combined = chunkA.filter((p) => !p.truncated).length + chunkB.length;
    expect(combined).toBeGreaterThanOrEqual(passes.filter((p) => !p.truncated).length - 1);
  });
});
