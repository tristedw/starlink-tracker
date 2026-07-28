import { describe, expect, it } from 'vitest';
import { illuminationState, isIlluminated, subsolarPoint, sunElevationDeg, sunState } from '../lib/math/sun';
import { AU_KM, EARTH_RADIUS_MEAN_KM } from '../lib/math/constants';

describe('sunState', () => {
  it('places the Sun at roughly one astronomical unit', () => {
    for (const iso of ['2024-01-01T00:00:00Z', '2024-07-01T00:00:00Z']) {
      const s = sunState(Date.parse(iso));
      // Earth's orbital eccentricity swings this by about ±1.7%.
      expect(s.distanceKm).toBeGreaterThan(AU_KM * 0.98);
      expect(s.distanceKm).toBeLessThan(AU_KM * 1.02);
    }
  });

  it('is closest to the Sun in early January (perihelion)', () => {
    const jan = sunState(Date.parse('2024-01-04T00:00:00Z')).distanceKm;
    const jul = sunState(Date.parse('2024-07-04T00:00:00Z')).distanceKm;
    expect(jan).toBeLessThan(jul);
  });

  it('tracks declination through the seasons', () => {
    // Solstices and equinoxes are the strongest available check on the
    // ecliptic-to-equatorial conversion.
    const decDeg = (iso: string) => (sunState(Date.parse(iso)).decRad * 180) / Math.PI;
    expect(decDeg('2024-06-20T12:00:00Z')).toBeCloseTo(23.44, 0);
    expect(decDeg('2024-12-21T12:00:00Z')).toBeCloseTo(-23.44, 0);
    expect(Math.abs(decDeg('2024-03-20T03:06:00Z'))).toBeLessThan(0.5);
    expect(Math.abs(decDeg('2024-09-22T12:44:00Z'))).toBeLessThan(0.5);
  });
});

describe('subsolarPoint', () => {
  it('sits near the Tropic of Cancer at the June solstice', () => {
    const p = subsolarPoint(sunState(Date.parse('2024-06-20T12:00:00Z')));
    expect(p.lat).toBeCloseTo(23.4, 0);
  });

  it('is near the prime meridian at solar noon UTC', () => {
    const p = subsolarPoint(sunState(Date.parse('2024-03-20T12:00:00Z')));
    // The equation of time keeps this within a few degrees, not exact.
    expect(Math.abs(p.lng)).toBeLessThan(6);
  });

  it('stays within the tropics all year', () => {
    for (let d = 0; d < 365; d += 11) {
      const p = subsolarPoint(sunState(Date.UTC(2024, 0, 1) + d * 86_400_000));
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(23.5);
      expect(p.lng).toBeGreaterThanOrEqual(-180);
      expect(p.lng).toBeLessThan(180);
    }
  });
});

describe('sunElevationDeg', () => {
  it('is high at local noon on the equator at equinox', () => {
    const s = sunState(Date.parse('2024-03-20T12:00:00Z'));
    const el = sunElevationDeg({ lat: 0, lng: 0 }, s);
    expect(el).toBeGreaterThan(80);
  });

  it('is well below the horizon at local midnight', () => {
    const s = sunState(Date.parse('2024-03-20T00:00:00Z'));
    const el = sunElevationDeg({ lat: 0, lng: 0 }, s);
    expect(el).toBeLessThan(-80);
  });

  it('shows midnight sun above the Arctic circle at the June solstice', () => {
    const s = sunState(Date.parse('2024-06-20T00:00:00Z'));
    expect(sunElevationDeg({ lat: 78, lng: 15 }, s)).toBeGreaterThan(0);
  });

  it('shows polar night above the Arctic circle at the December solstice', () => {
    const s = sunState(Date.parse('2024-12-21T12:00:00Z'));
    expect(sunElevationDeg({ lat: 78, lng: 15 }, s)).toBeLessThan(0);
  });

  it('stays within [-90, 90]', () => {
    for (let h = 0; h < 48; h += 3) {
      const s = sunState(Date.UTC(2024, 5, 1) + h * 3_600_000);
      const el = sunElevationDeg({ lat: 45, lng: -75 }, s);
      expect(el).toBeGreaterThanOrEqual(-90);
      expect(el).toBeLessThanOrEqual(90);
    }
  });
});

describe('illuminationState', () => {
  const sun = sunState(Date.parse('2024-03-20T12:00:00Z'));
  const sunDir = {
    x: sun.eci.x / sun.distanceKm,
    y: sun.eci.y / sun.distanceKm,
    z: sun.eci.z / sun.distanceKm,
  };
  const R = EARTH_RADIUS_MEAN_KM + 550;

  it('reports sunlit on the sunward side', () => {
    const sat = { x: sunDir.x * R, y: sunDir.y * R, z: sunDir.z * R };
    expect(illuminationState(sat, sun)).toBe('sunlit');
  });

  it('reports umbra directly behind Earth', () => {
    const sat = { x: -sunDir.x * R, y: -sunDir.y * R, z: -sunDir.z * R };
    expect(illuminationState(sat, sun)).toBe('umbra');
  });

  it('reports sunlit on the anti-sun side once clear of the shadow cone', () => {
    // Pick a perpendicular direction and step far off the shadow axis.
    const perp = normalise(cross(sunDir, { x: 0, y: 0, z: 1 }));
    const offset = EARTH_RADIUS_MEAN_KM * 1.6;
    const sat = {
      x: -sunDir.x * R + perp.x * offset,
      y: -sunDir.y * R + perp.y * offset,
      z: -sunDir.z * R + perp.z * offset,
    };
    expect(illuminationState(sat, sun)).toBe('sunlit');
  });

  it('passes through penumbra between the two extremes', () => {
    const perp = normalise(cross(sunDir, { x: 0, y: 0, z: 1 }));
    const states = new Set<string>();
    for (let f = 0; f <= 1.8; f += 0.02) {
      const offset = EARTH_RADIUS_MEAN_KM * f;
      states.add(
        illuminationState(
          {
            x: -sunDir.x * R + perp.x * offset,
            y: -sunDir.y * R + perp.y * offset,
            z: -sunDir.z * R + perp.z * offset,
          },
          sun
        )
      );
    }
    // A real conical shadow model must produce all three regimes; a naive
    // cylindrical test would only ever produce two.
    expect(states.has('umbra')).toBe(true);
    expect(states.has('penumbra')).toBe(true);
    expect(states.has('sunlit')).toBe(true);
  });

  it('treats only the umbra as unlit', () => {
    expect(isIlluminated('sunlit')).toBe(true);
    expect(isIlluminated('penumbra')).toBe(true);
    expect(isIlluminated('umbra')).toBe(false);
  });
});

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalise(v: { x: number; y: number; z: number }) {
  const m = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}
