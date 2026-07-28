/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import * as satellite from 'satellite.js';
import {
  DEG2RAD,
  EARTH_RADIUS_EQ_KM,
  EARTH_RADIUS_POLAR_KM,
  RAD2DEG,
  TWO_PI,
} from './constants';
import type { GeoPoint, Vec3 } from './geo';
import { gmstFromMs, minutesSinceEpoch } from './time';

/**
 * Allocation-free orbital mechanics.
 *
 * satellite.js is the reference SGP4 implementation and its propagator is used
 * verbatim here. The problem is the API around it: every coordinate helper
 * allocates a fresh object and `propagate()` wants a `Date`. At 11,000
 * satellites a second that's ~30,000 short-lived objects a second, and you can
 * watch the GC sawtooth in the frame graph. So these take and fill plain
 * numbers, and call `sgp4()` with minutes-since-epoch directly.
 */

const F = (EARTH_RADIUS_EQ_KM - EARTH_RADIUS_POLAR_KM) / EARTH_RADIUS_EQ_KM;
const E2 = 2 * F - F * F;

export interface Satrec extends satellite.SatRec {}

/** Reusable scratch record so hot loops never allocate. */
export interface GeodeticOut {
  lat: number;
  lng: number;
  altKm: number;
}

export interface StateOut extends GeodeticOut {
  /** ECI position (km), needed for the shadow test. */
  x: number;
  y: number;
  z: number;
  speedKmS: number;
  ok: boolean;
}

export function createStateOut(): StateOut {
  return { lat: 0, lng: 0, altKm: 0, x: 0, y: 0, z: 0, speedKmS: 0, ok: false };
}

/**
 * Build a satrec, returning null for anything unusable.
 *
 * Don't trust `twoline2satrec`'s error flag. Feed it junk and it'll hand back a
 * record with `error === 0` and NaN elements, which turns into NaN positions
 * and poisons the render buffers. Check the elements ourselves.
 */
export function parseSatrec(line1: string, line2: string): Satrec | null {
  try {
    const rec = satellite.twoline2satrec(line1, line2);
    if (!rec || rec.error !== 0) return null;
    if (!Number.isFinite(rec.no) || rec.no <= 0) return null;
    if (!Number.isFinite(rec.inclo) || !Number.isFinite(rec.nodeo)) return null;
    if (!Number.isFinite(rec.ecco) || rec.ecco < 0 || rec.ecco >= 1) return null;
    if (!Number.isFinite(rec.argpo) || !Number.isFinite(rec.mo)) return null;
    if (!Number.isFinite(rec.jdsatepoch)) return null;
    return rec;
  } catch {
    return null;
  }
}

/** Orbital period in minutes, from mean motion (radians/minute). */
export function periodMinutes(rec: Satrec): number {
  return rec.no > 0 ? TWO_PI / rec.no : 0;
}

/** Inclination in degrees. */
export function inclinationDeg(rec: Satrec): number {
  return rec.inclo * RAD2DEG;
}

/** Epoch of the element set, as epoch millis. */
export function satrecEpochMs(rec: Satrec): number {
  return (rec.jdsatepoch - 2440587.5) * 86_400_000;
}

/**
 * Propagate one satellite to `timeMs`, writing geodetic and ECI state into
 * `out`. Sets `out.ok === false` if propagation fails, e.g. a decayed object or
 * an element set way past its validity window.
 *
 * `gmst` comes in as an argument because it's the same for every satellite at a
 * given instant. Computing it once per timestep rather than once per satellite
 * is the biggest single win in this loop.
 */
export function propagateInto(
  rec: Satrec,
  timeMs: number,
  gmst: number,
  out: StateOut
): StateOut {
  const pv = satellite.sgp4(rec, minutesSinceEpoch(rec.jdsatepoch, timeMs));
  const p = pv.position;
  const v = pv.velocity;
  if (typeof p === 'boolean' || typeof v === 'boolean' || !p || !v) {
    out.ok = false;
    return out;
  }

  out.x = p.x;
  out.y = p.y;
  out.z = p.z;
  out.speedKmS = Math.hypot(v.x, v.y, v.z);

  eciToGeodeticInto(p.x, p.y, p.z, gmst, out);
  out.ok = Number.isFinite(out.lat) && Number.isFinite(out.lng) && Number.isFinite(out.altKm);
  return out;
}

/**
 * ECI -> geodetic (WGS-84), iterative. Converges in 3 or 4 passes for LEO;
 * the loop is capped so a pathological input can never hang the worker.
 */
export function eciToGeodeticInto(
  x: number,
  y: number,
  z: number,
  gmst: number,
  out: GeodeticOut
): void {
  const r = Math.hypot(x, y);
  let lng = Math.atan2(y, x) - gmst;
  // Wrap to [-pi, pi).
  lng = ((lng + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI;

  let lat = Math.atan2(z, r);
  let c = 1;
  for (let i = 0; i < 20; i++) {
    const sinLat = Math.sin(lat);
    c = 1 / Math.sqrt(1 - E2 * sinLat * sinLat);
    const next = Math.atan2(z + EARTH_RADIUS_EQ_KM * c * E2 * sinLat, r);
    if (Math.abs(next - lat) < 1e-12) {
      lat = next;
      break;
    }
    lat = next;
  }

  out.lat = lat * RAD2DEG;
  out.lng = lng * RAD2DEG;
  out.altKm = r / Math.cos(lat) - EARTH_RADIUS_EQ_KM * c;
}

/** Rotate an ECI vector into the Earth-fixed frame. */
export function eciToEcf(x: number, y: number, z: number, gmst: number, out: Vec3): Vec3 {
  const cos = Math.cos(gmst);
  const sin = Math.sin(gmst);
  out.x = x * cos + y * sin;
  out.y = -x * sin + y * cos;
  out.z = z;
  return out;
}

/** Observer geodetic position -> ECF, km. `heightKm` defaults to sea level. */
export function observerEcf(lat: number, lng: number, heightKm = 0): Vec3 {
  const latRad = lat * DEG2RAD;
  const lngRad = lng * DEG2RAD;
  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const n = EARTH_RADIUS_EQ_KM / Math.sqrt(1 - E2 * sinLat * sinLat);
  return {
    x: (n + heightKm) * cosLat * Math.cos(lngRad),
    y: (n + heightKm) * cosLat * Math.sin(lngRad),
    z: (n * (1 - E2) + heightKm) * sinLat,
  };
}

export interface LookOut {
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
}

/**
 * Topocentric look angles from an observer to a satellite, both in ECF.
 * `obsLatRad`/`obsLngRad` arrive pre-converted because pass evaluation calls
 * this thousands of times for one fixed observer.
 */
export function lookAnglesInto(
  obsEcf: Vec3,
  obsLatRad: number,
  obsLngRad: number,
  satEcf: Vec3,
  out: LookOut
): LookOut {
  const rx = satEcf.x - obsEcf.x;
  const ry = satEcf.y - obsEcf.y;
  const rz = satEcf.z - obsEcf.z;

  const sinLat = Math.sin(obsLatRad);
  const cosLat = Math.cos(obsLatRad);
  const sinLng = Math.sin(obsLngRad);
  const cosLng = Math.cos(obsLngRad);

  const topS = sinLat * cosLng * rx + sinLat * sinLng * ry - cosLat * rz;
  const topE = -sinLng * rx + cosLng * ry;
  const topZ = cosLat * cosLng * rx + cosLat * sinLng * ry + sinLat * rz;

  const range = Math.hypot(topS, topE, topZ);
  out.rangeKm = range;
  out.elevationDeg = range === 0 ? 0 : Math.asin(topZ / range) * RAD2DEG;
  let az = Math.atan2(-topE, topS) + Math.PI;
  if (az < 0) az += TWO_PI;
  out.azimuthDeg = (az * RAD2DEG) % 360;
  return out;
}

/** Convenience wrapper: elevation only, for pass scanning. */
export function elevationAt(
  rec: Satrec,
  timeMs: number,
  obsEcf: Vec3,
  obsLatRad: number,
  obsLngRad: number,
  scratch: { state: StateOut; ecf: Vec3; look: LookOut }
): number {
  const gmst = gmstFromMs(timeMs);
  const st = propagateInto(rec, timeMs, gmst, scratch.state);
  if (!st.ok) return Number.NEGATIVE_INFINITY;
  eciToEcf(st.x, st.y, st.z, gmst, scratch.ecf);
  lookAnglesInto(obsEcf, obsLatRad, obsLngRad, scratch.ecf, scratch.look);
  return scratch.look.elevationDeg;
}

export function makeScratch(): { state: StateOut; ecf: Vec3; look: LookOut } {
  return {
    state: createStateOut(),
    ecf: { x: 0, y: 0, z: 0 },
    look: { azimuthDeg: 0, elevationDeg: 0, rangeKm: 0 },
  };
}

/**
 * Ground track: the sub-satellite point sampled over a time span.
 * Used to draw the trailing/leading path on the 2D map.
 */
export function groundTrack(
  rec: Satrec,
  startMs: number,
  endMs: number,
  steps: number
): GeoPoint[] {
  const out: GeoPoint[] = [];
  const scratch = createStateOut();
  const dt = (endMs - startMs) / Math.max(1, steps);
  for (let i = 0; i <= steps; i++) {
    const t = startMs + i * dt;
    const st = propagateInto(rec, t, gmstFromMs(t), scratch);
    if (!st.ok) continue;
    out.push({ lat: st.lat, lng: st.lng });
  }
  return out;
}

/** Full 3D orbit path in ECI-derived lat/lng/alt triples, for the globe. */
export function orbitPath(
  rec: Satrec,
  startMs: number,
  endMs: number,
  steps: number
): Float32Array {
  const out = new Float32Array((steps + 1) * 3);
  const scratch = createStateOut();
  const dt = (endMs - startMs) / Math.max(1, steps);
  let n = 0;
  for (let i = 0; i <= steps; i++) {
    const t = startMs + i * dt;
    const st = propagateInto(rec, t, gmstFromMs(t), scratch);
    if (!st.ok) continue;
    out[n * 3] = st.lat;
    out[n * 3 + 1] = st.lng;
    out[n * 3 + 2] = st.altKm;
    n++;
  }
  return out.subarray(0, n * 3);
}
