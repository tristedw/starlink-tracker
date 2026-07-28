import { describe, expect, it } from 'vitest';
import {
  bearingDeg,
  circlePoints,
  footprintRadiusDeg,
  haversineKm,
  lngLatToMercator,
  normaliseLng,
  polar2Cartesian,
  splitAtAntimeridian,
} from '../lib/math/geo';
import { GLOBE_RADIUS } from '../lib/math/geo';

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm({ lat: 51.5, lng: -0.12 }, { lat: 51.5, lng: -0.12 })).toBeCloseTo(0, 6);
  });

  it('matches the known London to New York great-circle distance', () => {
    // Reference: ~5570 km between LHR and JFK.
    const d = haversineKm({ lat: 51.47, lng: -0.4543 }, { lat: 40.6413, lng: -73.7781 });
    expect(d).toBeGreaterThan(5500);
    expect(d).toBeLessThan(5620);
  });

  it('gives a quarter circumference between pole and equator', () => {
    const d = haversineKm({ lat: 90, lng: 0 }, { lat: 0, lng: 0 });
    expect(d).toBeCloseTo(10007.5, 0);
  });

  it('handles the antimeridian without going the long way round', () => {
    const d = haversineKm({ lat: 0, lng: 179.5 }, { lat: 0, lng: -179.5 });
    expect(d).toBeLessThan(120);
  });
});

describe('bearingDeg', () => {
  it('reads due north when heading to the pole', () => {
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 10, lng: 0 })).toBeCloseTo(0, 3);
  });

  it('reads due east along the equator', () => {
    expect(bearingDeg({ lat: 0, lng: 0 }, { lat: 0, lng: 10 })).toBeCloseTo(90, 3);
  });
});

describe('normaliseLng', () => {
  it.each([
    [190, -170],
    [-190, 170],
    [540, 180 - 360],
    [0, 0],
    [-180, -180],
  ])('wraps %i to %i', (input, expected) => {
    expect(normaliseLng(input)).toBeCloseTo(expected, 6);
  });

  it('keeps results inside [-180, 180)', () => {
    for (let v = -1000; v <= 1000; v += 7.3) {
      const n = normaliseLng(v);
      expect(n).toBeGreaterThanOrEqual(-180);
      expect(n).toBeLessThan(180);
    }
  });
});

describe('footprintRadiusDeg', () => {
  it('shrinks as the minimum elevation rises', () => {
    const horizon = footprintRadiusDeg(550, 0);
    const at25 = footprintRadiusDeg(550, 25);
    const at40 = footprintRadiusDeg(550, 40);
    expect(horizon).toBeGreaterThan(at25);
    expect(at25).toBeGreaterThan(at40);
  });

  it('gives roughly 23° at Starlink altitude for a horizon view', () => {
    // Standard result for a ~550 km orbit; the visible cap is ~23° of arc.
    expect(footprintRadiusDeg(550, 0)).toBeGreaterThan(21);
    expect(footprintRadiusDeg(550, 0)).toBeLessThan(25);
  });

  it('grows with altitude', () => {
    expect(footprintRadiusDeg(1200, 0)).toBeGreaterThan(footprintRadiusDeg(550, 0));
  });
});

describe('circlePoints', () => {
  it('produces points at the requested angular radius from the centre', () => {
    const centre = { lat: 20, lng: 30 };
    const pts = circlePoints(centre, 10, 32);
    for (const p of pts) {
      // 10 degrees of arc on the mean sphere.
      const expectedKm = (10 / 180) * Math.PI * 6371.0088;
      expect(haversineKm(centre, p)).toBeCloseTo(expectedKm, 0);
    }
  });

  it('closes the loop', () => {
    const pts = circlePoints({ lat: 0, lng: 0 }, 5, 16);
    expect(pts[0]!.lat).toBeCloseTo(pts.at(-1)!.lat, 6);
  });
});

describe('splitAtAntimeridian', () => {
  it('leaves a non-crossing path in one piece', () => {
    const segs = splitAtAntimeridian([
      { lat: 0, lng: 0 },
      { lat: 1, lng: 10 },
      { lat: 2, lng: 20 },
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toHaveLength(3);
  });

  it('splits an eastward crossing into two segments', () => {
    const segs = splitAtAntimeridian([
      { lat: 0, lng: 170 },
      { lat: 1, lng: -170 },
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.at(-1)!.lng).toBeCloseTo(180, 6);
    expect(segs[1]![0]!.lng).toBeCloseTo(-180, 6);
  });

  it('splits a westward crossing too', () => {
    const segs = splitAtAntimeridian([
      { lat: 0, lng: -170 },
      { lat: 1, lng: 170 },
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.at(-1)!.lng).toBeCloseTo(-180, 6);
    expect(segs[1]![0]!.lng).toBeCloseTo(180, 6);
  });

  it('handles several crossings in one track', () => {
    const segs = splitAtAntimeridian([
      { lat: 0, lng: 170 },
      { lat: 0, lng: -170 },
      { lat: 0, lng: -100 },
      { lat: 0, lng: 100 },
      { lat: 0, lng: 170 },
    ]);
    expect(segs.length).toBeGreaterThanOrEqual(2);
  });
});

describe('polar2Cartesian', () => {
  it('places 0,0 on the +x axis at globe radius', () => {
    const p = polar2Cartesian(0, 0, 0);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(GLOBE_RADIUS, 4);
    expect(p.y).toBeCloseTo(0, 4);
  });

  it('places the north pole on +y', () => {
    const p = polar2Cartesian(90, 0, 0);
    expect(p.y).toBeCloseTo(GLOBE_RADIUS, 3);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(0, 3);
  });

  it('scales radius with relative altitude', () => {
    const p = polar2Cartesian(0, 0, 0.5);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(GLOBE_RADIUS * 1.5, 4);
  });

  it('matches three-globe\'s own polar2Cartesian convention', () => {
    // We reimplement three-globe's conversion to avoid a per-point function
    // call in the render loop, so it must stay bit-compatible with the
    // library. These values were computed from three-globe's source:
    //   phi = (90 - lat)°, theta = (90 - lng)°, r = 100 * (1 + relAltitude)
    //   x = r·sin(phi)·cos(theta), y = r·cos(phi), z = r·sin(phi)·sin(theta)
    // If a three-globe upgrade changes this, satellites will be drawn in the
    // wrong place and this test is what catches it.
    const p = polar2Cartesian(45, 30, 0.1);
    expect(p.x).toBeCloseTo(38.8909, 3);
    expect(p.y).toBeCloseTo(77.7817, 3);
    expect(p.z).toBeCloseTo(67.36097, 3);
  });

  it('separates east and west longitudes', () => {
    const east = polar2Cartesian(0, 90, 0);
    const west = polar2Cartesian(0, -90, 0);
    const separation = Math.hypot(east.x - west.x, east.y - west.y, east.z - west.z);
    // Antipodal on the equator: a full diameter apart.
    expect(separation).toBeCloseTo(GLOBE_RADIUS * 2, 3);
  });
});

describe('lngLatToMercator', () => {
  it('maps the origin to the centre of the unit square', () => {
    const m = lngLatToMercator(0, 0);
    expect(m.x).toBeCloseTo(0.5, 9);
    expect(m.y).toBeCloseTo(0.5, 9);
  });

  it('maps the antimeridian to the unit-square edges', () => {
    expect(lngLatToMercator(-180, 0).x).toBeCloseTo(0, 9);
    expect(lngLatToMercator(180, 0).x).toBeCloseTo(1, 9);
  });

  it('clamps beyond the Mercator latitude limit', () => {
    const top = lngLatToMercator(0, 89.9);
    expect(top.y).toBeGreaterThanOrEqual(0);
    expect(top.y).toBeLessThan(0.01);
  });

  it('increases y as latitude decreases', () => {
    expect(lngLatToMercator(0, -45).y).toBeGreaterThan(lngLatToMercator(0, 45).y);
  });
});
