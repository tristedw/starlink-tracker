/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import {
  DEG2RAD,
  EARTH_RADIUS_EQ_KM,
  EARTH_RADIUS_MEAN_KM,
  RAD2DEG,
} from './constants';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Great-circle distance in km between two points on the mean-radius sphere. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLng = (b.lng - a.lng) * DEG2RAD;
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MEAN_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing in degrees (0 = north, clockwise) from `a` to `b`. */
export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const dLng = (b.lng - a.lng) * DEG2RAD;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * RAD2DEG + 360) % 360;
}

/** Wrap a longitude into [-180, 180). */
export function normaliseLng(lng: number): number {
  let l = ((lng + 180) % 360 + 360) % 360 - 180;
  if (Object.is(l, -0)) l = 0;
  return l;
}

/**
 * Angular radius of a satellite's coverage footprint, in degrees of arc on
 * the Earth's surface, for a given minimum elevation at the ground station.
 *
 * Derived from the plane triangle Earth-centre / observer / satellite:
 *   sin(rho) = R cos(el) / (R + h)   -> nadir angle
 *   lambda   = 90 - el - rho          -> Earth-central angle (the footprint)
 */
export function footprintRadiusDeg(altKm: number, minElevationDeg = 0): number {
  const el = minElevationDeg * DEG2RAD;
  const ratio = (EARTH_RADIUS_MEAN_KM * Math.cos(el)) / (EARTH_RADIUS_MEAN_KM + altKm);
  const rho = Math.asin(Math.min(1, Math.max(-1, ratio)));
  return Math.max(0, 90 - minElevationDeg - rho * RAD2DEG);
}

/**
 * Points along a circle of given angular radius around a centre, used to
 * draw the coverage footprint on the map and globe.
 */
export function circlePoints(centre: GeoPoint, radiusDeg: number, steps = 128): GeoPoint[] {
  const lat1 = centre.lat * DEG2RAD;
  const lng1 = centre.lng * DEG2RAD;
  const d = radiusDeg * DEG2RAD;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinD = Math.sin(d);
  const cosD = Math.cos(d);

  const out: GeoPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (i / steps) * Math.PI * 2;
    const lat2 = Math.asin(sinLat1 * cosD + cosLat1 * sinD * Math.cos(brng));
    const lng2 =
      lng1 +
      Math.atan2(Math.sin(brng) * sinD * cosLat1, cosD - sinLat1 * Math.sin(lat2));
    out.push({ lat: lat2 * RAD2DEG, lng: normaliseLng(lng2 * RAD2DEG) });
  }
  return out;
}

/**
 * Split a polyline where it crosses the antimeridian, otherwise the map draws a
 * streak straight across the world. Interpolates the crossing latitude instead
 * of just cutting, so the ends meet the edge cleanly.
 */
export function splitAtAntimeridian(points: GeoPoint[]): GeoPoint[][] {
  if (points.length < 2) return points.length ? [points] : [];
  const segments: GeoPoint[][] = [];
  let current: GeoPoint[] = [points[0]!];

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    const dLng = cur.lng - prev.lng;

    if (Math.abs(dLng) > 180) {
      // Fraction of the segment travelled before hitting ±180.
      const goingEast = dLng < 0; // wrapped from +180 to -180
      const edgePrev = goingEast ? 180 : -180;
      const edgeCur = goingEast ? -180 : 180;
      const span = goingEast ? 360 - Math.abs(dLng) : Math.abs(dLng) - 360;
      const t = span === 0 ? 0.5 : Math.abs(edgePrev - prev.lng) / Math.abs(span || 1);
      const lat = prev.lat + (cur.lat - prev.lat) * Math.min(1, Math.max(0, t));

      current.push({ lat, lng: edgePrev });
      segments.push(current);
      current = [{ lat, lng: edgeCur }, cur];
    } else {
      current.push(cur);
    }
  }
  segments.push(current);
  return segments.filter((s) => s.length > 1);
}

/**
 * three-globe's polar to cartesian conversion, inlined so the render loop can
 * write straight into a typed array instead of allocating an object per point
 * via `globe.getCoords()`. `GLOBE_RADIUS` is three-globe's fixed 100-unit
 * sphere.
 */
export const GLOBE_RADIUS = 100;

export function polar2CartesianInto(
  out: Float32Array,
  offset: number,
  lat: number,
  lng: number,
  relAltitude: number
): void {
  const phi = (90 - lat) * DEG2RAD;
  const theta = (90 - lng) * DEG2RAD;
  const r = GLOBE_RADIUS * (1 + relAltitude);
  const sinPhi = Math.sin(phi);
  out[offset] = r * sinPhi * Math.cos(theta);
  out[offset + 1] = r * Math.cos(phi);
  out[offset + 2] = r * sinPhi * Math.sin(theta);
}

export function polar2Cartesian(lat: number, lng: number, relAltitude: number): Vec3 {
  const buf = new Float32Array(3);
  polar2CartesianInto(buf, 0, lat, lng, relAltitude);
  return { x: buf[0]!, y: buf[1]!, z: buf[2]! };
}

/** Altitude in km -> three-globe's "relative to Earth radius" altitude units. */
export function altKmToRelative(altKm: number): number {
  return altKm / EARTH_RADIUS_EQ_KM;
}

/**
 * Web-Mercator normalised coordinates in [0,1], matching MapLibre's
 * `MercatorCoordinate`. Latitude is clamped to the Mercator limit.
 */
export function lngLatToMercator(lng: number, lat: number): { x: number; y: number } {
  const clamped = Math.max(-85.051129, Math.min(85.051129, lat));
  const x = (180 + lng) / 360;
  const y =
    (180 -
      (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))) /
    360;
  // The latitude clamp sits just inside the true Mercator limit, so floating
  // point can still land y a few nanometres outside [0,1]. Clamp it.
  return { x, y: Math.min(1, Math.max(0, y)) };
}
