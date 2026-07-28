/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { JD_UNIX_EPOCH, MS_PER_DAY } from './constants';

/** Convert epoch milliseconds to a Julian date. */
export function msToJulian(ms: number): number {
  return ms / MS_PER_DAY + JD_UNIX_EPOCH;
}

/** Convert a Julian date to epoch milliseconds. */
export function julianToMs(jd: number): number {
  return (jd - JD_UNIX_EPOCH) * MS_PER_DAY;
}

/** Julian centuries since J2000.0, the argument most astronomy series take. */
export function julianCenturiesJ2000(ms: number): number {
  return (msToJulian(ms) - 2451545.0) / 36525;
}

/**
 * Greenwich Mean Sidereal Time in radians, IAU 1982.
 *
 * satellite.js has an equivalent `gstime`, but ours takes a plain number, so
 * the hot loop can compute GMST once per timestep instead of allocating a Date
 * per satellite. At thousands of objects that allocation dominates.
 */
export function gmstFromMs(ms: number): number {
  const jd = msToJulian(ms);
  const t = (jd - 2451545.0) / 36525;
  let gmst =
    67310.54841 +
    (876600.0 * 3600 + 8640184.812866) * t +
    0.093104 * t * t -
    6.2e-6 * t * t * t;
  // seconds -> radians, normalised to [0, 2pi)
  gmst = ((gmst % 86400) * (Math.PI / 43200)) % (Math.PI * 2);
  return gmst < 0 ? gmst + Math.PI * 2 : gmst;
}

/** Minutes elapsed between a satrec's TLE epoch and a target time. */
export function minutesSinceEpoch(jdSatEpoch: number, targetMs: number): number {
  return (msToJulian(targetMs) - jdSatEpoch) * 1440;
}
