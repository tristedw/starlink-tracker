import { describe, expect, it } from 'vitest';
import * as satellite from 'satellite.js';
import {
  createStateOut,
  eciToEcf,
  eciToGeodeticInto,
  inclinationDeg,
  lookAnglesInto,
  observerEcf,
  parseSatrec,
  periodMinutes,
  propagateInto,
  satrecEpochMs,
} from '../lib/math/propagation';
import { gmstFromMs, minutesSinceEpoch, msToJulian } from '../lib/math/time';
import { ISS_TLE, STARLINK_TLE } from './fixtures';

const iss = parseSatrec(ISS_TLE.line1, ISS_TLE.line2)!;
const starlink = parseSatrec(STARLINK_TLE.line1, STARLINK_TLE.line2)!;

describe('parseSatrec', () => {
  it('parses valid element sets', () => {
    expect(iss).not.toBeNull();
    expect(starlink).not.toBeNull();
  });

  it('rejects garbage instead of throwing', () => {
    expect(parseSatrec('nonsense', 'also nonsense')).toBeNull();
  });
});

describe('orbital element accessors', () => {
  it('reads ISS inclination as ~51.64°', () => {
    expect(inclinationDeg(iss)).toBeCloseTo(51.6416, 2);
  });

  it('reads Starlink inclination as ~53.05°', () => {
    expect(inclinationDeg(starlink)).toBeCloseTo(53.0546, 2);
  });

  it('derives a ~93 minute ISS period', () => {
    expect(periodMinutes(iss)).toBeGreaterThan(90);
    expect(periodMinutes(iss)).toBeLessThan(95);
  });

  it('derives a ~95 minute Starlink period', () => {
    expect(periodMinutes(starlink)).toBeGreaterThan(93);
    expect(periodMinutes(starlink)).toBeLessThan(98);
  });

  it('recovers the element-set epoch', () => {
    const epoch = new Date(satrecEpochMs(iss));
    expect(epoch.getUTCFullYear()).toBe(2024);
    expect(epoch.getUTCMonth()).toBe(0);
    expect(epoch.getUTCDate()).toBe(1);
  });
});

describe('gmstFromMs', () => {
  it('agrees with satellite.js gstime to sub-microradian precision', () => {
    // Every transform depends on GMST, so check ours against the reference.
    for (const iso of [
      '2024-01-01T00:00:00Z',
      '2024-06-21T12:34:56Z',
      '2025-12-31T23:59:59Z',
      '2000-01-01T12:00:00Z',
    ]) {
      const ms = Date.parse(iso);
      expect(gmstFromMs(ms)).toBeCloseTo(satellite.gstime(new Date(ms)), 8);
    }
  });

  it('stays inside [0, 2pi)', () => {
    for (let i = 0; i < 50; i++) {
      const g = gmstFromMs(Date.UTC(2024, 0, 1) + i * 3_600_000 * 7);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThan(Math.PI * 2);
    }
  });
});

describe('minutesSinceEpoch', () => {
  it('is zero at the element-set epoch', () => {
    expect(minutesSinceEpoch(iss.jdsatepoch, satrecEpochMs(iss))).toBeCloseTo(0, 6);
  });

  it('advances one minute per 60000 ms', () => {
    const base = satrecEpochMs(iss);
    expect(minutesSinceEpoch(iss.jdsatepoch, base + 600_000)).toBeCloseTo(10, 6);
  });
});

describe('msToJulian', () => {
  it('matches the known Julian date of J2000.0', () => {
    expect(msToJulian(Date.UTC(2000, 0, 1, 12, 0, 0))).toBeCloseTo(2451545.0, 6);
  });
});

describe('propagateInto', () => {
  it('agrees with satellite.js propagate to well under a metre', () => {
    const t = Date.UTC(2024, 0, 1, 6, 0, 0);
    const gmst = gmstFromMs(t);
    const out = propagateInto(iss, t, gmst, createStateOut());
    expect(out.ok).toBe(true);

    const reference = satellite.propagate(iss, new Date(t));
    const p = reference.position as satellite.EciVec3<number>;
    expect(out.x).toBeCloseTo(p.x, 6);
    expect(out.y).toBeCloseTo(p.y, 6);
    expect(out.z).toBeCloseTo(p.z, 6);
  });

  it('produces a geodetic position matching satellite.js eciToGeodetic', () => {
    const t = Date.UTC(2024, 0, 1, 6, 0, 0);
    const gmst = gmstFromMs(t);
    const out = propagateInto(iss, t, gmst, createStateOut());

    const reference = satellite.propagate(iss, new Date(t));
    const geo = satellite.eciToGeodetic(
      reference.position as satellite.EciVec3<number>,
      satellite.gstime(new Date(t))
    );
    expect(out.lat).toBeCloseTo(satellite.degreesLat(geo.latitude), 6);
    expect(out.lng).toBeCloseTo(satellite.degreesLong(geo.longitude), 6);
    expect(out.altKm).toBeCloseTo(geo.height, 6);
  });

  it('puts the ISS at a plausible altitude and speed', () => {
    const t = Date.UTC(2024, 0, 1, 3, 0, 0);
    const out = propagateInto(iss, t, gmstFromMs(t), createStateOut());
    // ISS orbits at ~400-420 km doing ~7.66 km/s.
    expect(out.altKm).toBeGreaterThan(380);
    expect(out.altKm).toBeLessThan(440);
    expect(out.speedKmS).toBeGreaterThan(7.5);
    expect(out.speedKmS).toBeLessThan(7.8);
  });

  it('puts Starlink at its shell altitude and speed', () => {
    const t = Date.UTC(2024, 0, 1, 12, 0, 0);
    const out = propagateInto(starlink, t, gmstFromMs(t), createStateOut());
    expect(out.altKm).toBeGreaterThan(500);
    expect(out.altKm).toBeLessThan(600);
    expect(out.speedKmS).toBeGreaterThan(7.4);
    expect(out.speedKmS).toBeLessThan(7.7);
  });

  it('never exceeds the orbit inclination in latitude', () => {
    const inc = inclinationDeg(starlink);
    const base = Date.UTC(2024, 0, 1);
    const out = createStateOut();
    for (let m = 0; m < 100; m += 2) {
      const t = base + m * 60_000;
      propagateInto(starlink, t, gmstFromMs(t), out);
      // Small margin: the sub-point is geodetic, the inclination geocentric.
      expect(Math.abs(out.lat)).toBeLessThanOrEqual(inc + 0.5);
    }
  });

  it('returns to nearly the same latitude after one full period', () => {
    const period = periodMinutes(starlink);
    const t0 = Date.UTC(2024, 0, 1, 12, 0, 0);
    const t1 = t0 + period * 60_000;
    const a = propagateInto(starlink, t0, gmstFromMs(t0), createStateOut());
    const b = propagateInto(starlink, t1, gmstFromMs(t1), createStateOut());
    expect(b.lat).toBeCloseTo(a.lat, 0);
  });
});

describe('eciToGeodeticInto', () => {
  it('resolves a point on the equatorial x-axis at zero GMST', () => {
    const out = { lat: 0, lng: 0, altKm: 0 };
    eciToGeodeticInto(6378.137 + 500, 0, 0, 0, out);
    expect(out.lat).toBeCloseTo(0, 6);
    expect(out.lng).toBeCloseTo(0, 6);
    expect(out.altKm).toBeCloseTo(500, 3);
  });

  it('rotates longitude with GMST', () => {
    const out = { lat: 0, lng: 0, altKm: 0 };
    eciToGeodeticInto(6878.137, 0, 0, Math.PI / 2, out);
    expect(out.lng).toBeCloseTo(-90, 4);
  });
});

describe('lookAnglesInto', () => {
  const observer = { lat: 51.5, lng: -0.12 };
  const obsEcf = observerEcf(observer.lat, observer.lng, 0);
  const latRad = (observer.lat * Math.PI) / 180;
  const lngRad = (observer.lng * Math.PI) / 180;

  it('agrees with satellite.js ecfToLookAngles', () => {
    const t = Date.UTC(2024, 0, 1, 6, 0, 0);
    const gmst = gmstFromMs(t);
    const st = propagateInto(iss, t, gmst, createStateOut());
    const ecf = eciToEcf(st.x, st.y, st.z, gmst, { x: 0, y: 0, z: 0 });
    const out = lookAnglesInto(obsEcf, latRad, lngRad, ecf, {
      azimuthDeg: 0,
      elevationDeg: 0,
      rangeKm: 0,
    });

    const reference = satellite.ecfToLookAngles(
      {
        latitude: latRad,
        longitude: lngRad,
        height: 0,
      },
      ecf
    );
    expect(out.elevationDeg).toBeCloseTo((reference.elevation * 180) / Math.PI, 5);
    expect(out.azimuthDeg).toBeCloseTo((reference.azimuth * 180) / Math.PI, 5);
    expect(out.rangeKm).toBeCloseTo(reference.rangeSat, 5);
  });

  it('reports 90° elevation for a satellite directly overhead', () => {
    // Place a target straight up from the observer in ECF.
    const scale = 1 + 500 / Math.hypot(obsEcf.x, obsEcf.y, obsEcf.z);
    const overhead = { x: obsEcf.x * scale, y: obsEcf.y * scale, z: obsEcf.z * scale };
    const out = lookAnglesInto(obsEcf, latRad, lngRad, overhead, {
      azimuthDeg: 0,
      elevationDeg: 0,
      rangeKm: 0,
    });
    expect(out.elevationDeg).toBeGreaterThan(89.5);
  });

  it('keeps azimuth inside [0, 360)', () => {
    const base = Date.UTC(2024, 0, 1);
    for (let m = 0; m < 200; m += 7) {
      const t = base + m * 60_000;
      const gmst = gmstFromMs(t);
      const st = propagateInto(iss, t, gmst, createStateOut());
      const ecf = eciToEcf(st.x, st.y, st.z, gmst, { x: 0, y: 0, z: 0 });
      const out = lookAnglesInto(obsEcf, latRad, lngRad, ecf, {
        azimuthDeg: 0,
        elevationDeg: 0,
        rangeKm: 0,
      });
      expect(out.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(out.azimuthDeg).toBeLessThan(360);
      expect(out.elevationDeg).toBeGreaterThanOrEqual(-90);
      expect(out.elevationDeg).toBeLessThanOrEqual(90);
    }
  });
});

describe('observerEcf', () => {
  it('gives the equatorial radius at 0,0', () => {
    const p = observerEcf(0, 0, 0);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(6378.137, 3);
  });

  it('gives the polar radius at the north pole', () => {
    const p = observerEcf(90, 0, 0);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(6356.7523142, 3);
  });

  it('adds observer height', () => {
    const p = observerEcf(0, 0, 2);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(6380.137, 3);
  });
});
