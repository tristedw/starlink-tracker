/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import type { PassPrediction } from '../../types';
import { DEG2RAD, TWILIGHT_SUN_ELEVATION_DEG } from './constants';
import { footprintRadiusDeg } from './geo';
import type { GeoPoint } from './geo';
import {
  eciToEcf,
  inclinationDeg,
  lookAnglesInto,
  makeScratch,
  observerEcf,
  propagateInto,
  type Satrec,
} from './propagation';
import { illuminationState, sunElevationDeg, sunState } from './sun';
import { gmstFromMs } from './time';

export interface PassOptions {
  /** Start of the search window, epoch ms. */
  startMs: number;
  /** How far ahead to look, minutes. */
  windowMinutes: number;
  /** Passes peaking below this are discarded. */
  minElevationDeg: number;
  /** Only return passes visible to the naked eye (sunlit sat, dark sky). */
  visibleOnly: boolean;
  /** Cap on returned passes, applied after sorting by rise time. */
  limit: number;
}

export const DEFAULT_PASS_OPTIONS: Omit<PassOptions, 'startMs'> = {
  windowMinutes: 180,
  minElevationDeg: 10,
  visibleOnly: false,
  limit: 60,
};

/**
 * Coarse scan step. Starlink runs from ~330 km (Direct-to-Cell) to ~570 km, so
 * horizon-to-horizon passes last roughly 4 to 10 minutes. A 60-second step
 * can't skip even the fastest of those, and it's 60x cheaper than sweeping at
 * one second.
 */
const COARSE_STEP_MS = 60_000;
/** Bisection target for rise/set times. */
const EDGE_TOLERANCE_MS = 500;
/** Ternary-search target for the peak. */
const PEAK_TOLERANCE_MS = 1000;

/**
 * Can this satellite's ground track ever get close enough to the observer?
 *
 * An orbit of inclination i never puts its sub-point above latitude i (or below
 * -i). Add the footprint radius and that's a hard bound, which throws out whole
 * shells for high-latitude observers before propagating anything.
 *
 * `assumedAltKm` defaults to the top of the constellation (~550 km), not a
 * mean. Footprint radius grows with altitude, so the highest shell gives the
 * most permissive filter. Guess lower and you reject satellites that really
 * are visible.
 */
export function canEverBeVisible(
  rec: Satrec,
  observer: GeoPoint,
  minElevationDeg: number,
  assumedAltKm = 550
): boolean {
  const inc = inclinationDeg(rec);
  // Retrograde orbits (e.g. 97.6° sun-synchronous) reach latitude 180 - i.
  const maxLat = inc > 90 ? 180 - inc : inc;
  const reach = footprintRadiusDeg(assumedAltKm, minElevationDeg);
  return Math.abs(observer.lat) <= maxLat + reach;
}

interface Ctx {
  obsEcf: ReturnType<typeof observerEcf>;
  latRad: number;
  lngRad: number;
  scratch: ReturnType<typeof makeScratch>;
}

function makeCtx(observer: GeoPoint, heightKm: number): Ctx {
  return {
    obsEcf: observerEcf(observer.lat, observer.lng, heightKm),
    latRad: observer.lat * DEG2RAD,
    lngRad: observer.lng * DEG2RAD,
    scratch: makeScratch(),
  };
}

function elevationAtTime(rec: Satrec, timeMs: number, ctx: Ctx): number {
  const gmst = gmstFromMs(timeMs);
  const st = propagateInto(rec, timeMs, gmst, ctx.scratch.state);
  if (!st.ok) return Number.NEGATIVE_INFINITY;
  eciToEcf(st.x, st.y, st.z, gmst, ctx.scratch.ecf);
  lookAnglesInto(ctx.obsEcf, ctx.latRad, ctx.lngRad, ctx.scratch.ecf, ctx.scratch.look);
  return ctx.scratch.look.elevationDeg;
}

/** Bisect for the instant elevation crosses zero between two bracketing times. */
function refineHorizonCrossing(rec: Satrec, belowMs: number, aboveMs: number, ctx: Ctx): number {
  let lo = belowMs;
  let hi = aboveMs;
  while (Math.abs(hi - lo) > EDGE_TOLERANCE_MS) {
    const mid = (lo + hi) / 2;
    if (elevationAtTime(rec, mid, ctx) > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Ternary search for the elevation maximum. Elevation over one pass is
 * unimodal, which is the precondition ternary search wants, and it converges
 * far faster than resampling the pass at one second.
 */
function refinePeak(
  rec: Satrec,
  startMs: number,
  endMs: number,
  ctx: Ctx
): { timeMs: number; elevationDeg: number } {
  let lo = startMs;
  let hi = endMs;
  while (hi - lo > PEAK_TOLERANCE_MS) {
    const third = (hi - lo) / 3;
    const m1 = lo + third;
    const m2 = hi - third;
    if (elevationAtTime(rec, m1, ctx) < elevationAtTime(rec, m2, ctx)) lo = m1;
    else hi = m2;
  }
  const timeMs = (lo + hi) / 2;
  return { timeMs, elevationDeg: elevationAtTime(rec, timeMs, ctx) };
}

function sample(rec: Satrec, timeMs: number, ctx: Ctx) {
  const gmst = gmstFromMs(timeMs);
  const st = propagateInto(rec, timeMs, gmst, ctx.scratch.state);
  eciToEcf(st.x, st.y, st.z, gmst, ctx.scratch.ecf);
  lookAnglesInto(ctx.obsEcf, ctx.latRad, ctx.lngRad, ctx.scratch.ecf, ctx.scratch.look);
  return {
    azimuthDeg: ctx.scratch.look.azimuthDeg,
    elevationDeg: ctx.scratch.look.elevationDeg,
    rangeKm: ctx.scratch.look.rangeKm,
    eci: { x: st.x, y: st.y, z: st.z },
    altKm: st.altKm,
  };
}

/**
 * Find every pass of `rec` over `observer` inside the window.
 *
 * Two stages: a cheap 60-second sweep finds the horizon crossings, then
 * bisection and ternary search pin rise, peak and set to sub-second accuracy.
 * Scanning fine the whole way would cost 60x the propagation for no extra
 * precision anywhere that matters.
 */
export function findPassesForSatellite(
  rec: Satrec,
  name: string,
  noradId: number,
  observer: GeoPoint,
  opts: PassOptions,
  observerHeightKm = 0
): PassPrediction[] {
  const ctx = makeCtx(observer, observerHeightKm);
  const endMs = opts.startMs + opts.windowMinutes * 60_000;
  const out: PassPrediction[] = [];

  let prevTime = opts.startMs;
  let prevEl = elevationAtTime(rec, prevTime, ctx);
  let riseMs: number | null = prevEl > 0 ? prevTime : null;

  for (let t = opts.startMs + COARSE_STEP_MS; t <= endMs; t += COARSE_STEP_MS) {
    const el = elevationAtTime(rec, t, ctx);
    if (!Number.isFinite(el)) {
      prevTime = t;
      prevEl = el;
      continue;
    }

    if (el > 0 && prevEl <= 0) {
      riseMs = refineHorizonCrossing(rec, prevTime, t, ctx);
    } else if (el <= 0 && prevEl > 0 && riseMs !== null) {
      const setMs = refineHorizonCrossing(rec, t, prevTime, ctx);
      const pass = buildPass(rec, name, noradId, riseMs, setMs, ctx, opts);
      if (pass) out.push(pass);
      riseMs = null;
    }

    prevTime = t;
    prevEl = el;
  }

  // A pass still in progress at the end of the window is reported truncated.
  if (riseMs !== null && prevEl > 0) {
    const pass = buildPass(rec, name, noradId, riseMs, endMs, ctx, opts);
    if (pass) out.push({ ...pass, truncated: true });
  }

  return out;
}

function buildPass(
  rec: Satrec,
  name: string,
  noradId: number,
  riseMs: number,
  setMs: number,
  ctx: Ctx,
  opts: PassOptions
): PassPrediction | null {
  const peak = refinePeak(rec, riseMs, setMs, ctx);
  if (peak.elevationDeg < opts.minElevationDeg) return null;

  const riseSample = sample(rec, riseMs, ctx);
  const setSample = sample(rec, setMs, ctx);
  const peakSample = sample(rec, peak.timeMs, ctx);

  const sun = sunState(peak.timeMs);
  const illumination = illuminationState(peakSample.eci, sun);
  const observerSunElevationDeg = sunElevationDeg(
    { lat: ctx.latRad / DEG2RAD, lng: ctx.lngRad / DEG2RAD },
    sun
  );
  const visible =
    illumination !== 'umbra' && observerSunElevationDeg < TWILIGHT_SUN_ELEVATION_DEG;

  if (opts.visibleOnly && !visible) return null;

  return {
    noradId,
    name,
    riseTimeMs: riseMs,
    riseAzimuthDeg: riseSample.azimuthDeg,
    peakTimeMs: peak.timeMs,
    peakElevationDeg: peak.elevationDeg,
    peakAzimuthDeg: peakSample.azimuthDeg,
    peakRangeKm: peakSample.rangeKm,
    setTimeMs: setMs,
    setAzimuthDeg: setSample.azimuthDeg,
    durationMs: setMs - riseMs,
    illumination,
    observerSunElevationDeg,
    visible,
    truncated: false,
  };
}
