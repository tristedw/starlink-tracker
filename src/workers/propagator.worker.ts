/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
/// <reference lib="webworker" />
/**
 * Propagation shard worker.
 *
 * One of N identical workers, each owning a strided slice of the constellation
 * (`i % shardCount === shardIndex`). Strided rather than split into blocks: the
 * catalogue is ordered by launch, so blocks would dump all the decaying old
 * objects on one poor shard.
 *
 * Results go out as transferable typed arrays and the main thread hands the
 * same buffers back next tick, so steady-state allocation is zero.
 */

import type { GeoLocation, LookAngle, SatelliteInfo } from '../types';
import type { FrameBuffers, WorkerRequest, WorkerResponse } from '../types/messages';
import { DEG2RAD, ILLUM } from '../lib/math/constants';
import { haversineKm } from '../lib/math/geo';
import {
  canEverBeVisible,
  DEFAULT_PASS_OPTIONS,
  findPassesForSatellite,
} from '../lib/math/passes';
import {
  createStateOut,
  eciToEcf,
  inclinationDeg,
  lookAnglesInto,
  observerEcf,
  parseSatrec,
  periodMinutes,
  propagateInto,
  satrecEpochMs,
  type Satrec,
} from '../lib/math/propagation';
import { illuminationState, sunState } from '../lib/math/sun';
import { starlinkBlock } from '../lib/math/tle';
import { gmstFromMs } from '../lib/math/time';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

interface Entry {
  noradId: number;
  name: string;
  rec: Satrec;
}

let shardIndex = 0;
let entries: Entry[] = [];

const ILLUM_CODE = {
  umbra: ILLUM.UMBRA,
  penumbra: ILLUM.PENUMBRA,
  sunlit: ILLUM.SUNLIT,
} as const;
const ILLUM_INVALID = ILLUM.INVALID;

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

function ensureBuffers(n: number, reuse?: FrameBuffers): FrameBuffers {
  if (
    reuse &&
    reuse.ids.length >= n &&
    reuse.lla.length >= n * 3 &&
    reuse.speed.length >= n &&
    reuse.illum.length >= n
  ) {
    return reuse;
  }
  return {
    ids: new Int32Array(n),
    lla: new Float32Array(n * 3),
    speed: new Float32Array(n),
    illum: new Uint8Array(n),
  };
}

// ---------------------------------------------------------------------------
// Tick: propagate the whole shard for one instant.
// ---------------------------------------------------------------------------

const state = createStateOut();
const ecf = { x: 0, y: 0, z: 0 };
const look = { azimuthDeg: 0, elevationDeg: 0, rangeKm: 0 };

function handleTick(
  timeMs: number,
  observer: GeoLocation | null,
  nearestK: number,
  reuse?: FrameBuffers
): void {
  const buffers = ensureBuffers(entries.length, reuse);
  const { ids, lla, speed, illum } = buffers;

  // Both constant across the shard at a fixed instant. Hoisting them saves
  // ~11,000 redundant computations.
  const gmst = gmstFromMs(timeMs);
  const sun = sunState(timeMs);

  const obs = observer ? observerEcf(observer.lat, observer.lng, (observer.altitudeM ?? 0) / 1000) : null;
  const obsLatRad = observer ? observer.lat * DEG2RAD : 0;
  const obsLngRad = observer ? observer.lng * DEG2RAD : 0;

  // Insertion sort into a tiny array beats sorting the whole shard. We only
  // want the top K and K is about 30.
  const bestIdx: number[] = [];
  const bestDist: number[] = [];

  // Slot i belongs to entry i for the whole session. Compacting out failed
  // propagations would shift everything after it by one and quietly wreck the
  // frame-to-frame interpolation, so flag failures in place instead.
  const n = entries.length;
  for (let i = 0; i < n; i++) {
    const e = entries[i]!;
    ids[i] = e.noradId;

    const st = propagateInto(e.rec, timeMs, gmst, state);
    if (!st.ok) {
      illum[i] = ILLUM_INVALID;
      continue;
    }

    lla[i * 3] = st.lat;
    lla[i * 3 + 1] = st.lng;
    lla[i * 3 + 2] = st.altKm;
    speed[i] = st.speedKmS;
    illum[i] = ILLUM_CODE[illuminationState(st, sun)];

    if (obs) {
      // Rank by great-circle distance to the sub-satellite point. At a fixed
      // altitude it tracks slant range, and it's far cheaper than a full
      // look-angle solve.
      const d = haversineKm(observer!, { lat: st.lat, lng: st.lng });
      if (bestDist.length < nearestK || d < bestDist[bestDist.length - 1]!) {
        let pos = bestDist.length;
        while (pos > 0 && bestDist[pos - 1]! > d) pos--;
        bestDist.splice(pos, 0, d);
        bestIdx.splice(pos, 0, i);
        if (bestDist.length > nearestK) {
          bestDist.pop();
          bestIdx.pop();
        }
      }
    }
  }

  const nearest: LookAngle[] = [];
  if (obs && observer) {
    for (let k = 0; k < bestIdx.length; k++) {
      const e = entries[bestIdx[k]!]!;
      const st = propagateInto(e.rec, timeMs, gmst, state);
      if (!st.ok) continue;
      eciToEcf(st.x, st.y, st.z, gmst, ecf);
      lookAnglesInto(obs, obsLatRad, obsLngRad, ecf, look);
      nearest.push({
        noradId: e.noradId,
        name: e.name,
        azimuthDeg: look.azimuthDeg,
        elevationDeg: look.elevationDeg,
        rangeKm: look.rangeKm,
        groundDistanceKm: bestDist[k]!,
        altKm: st.altKm,
        illumination: illuminationState(st, sun),
      });
    }
  }

  post(
    { type: 'frame', shardIndex, timeMs, count: n, buffers, nearest },
    [buffers.ids.buffer, buffers.lla.buffer, buffers.speed.buffer, buffers.illum.buffer]
  );
}

// ---------------------------------------------------------------------------
// Pass search across the shard.
// ---------------------------------------------------------------------------

function handlePasses(msg: Extract<WorkerRequest, { type: 'passes' }>): void {
  const { requestId, observer, startMs, windowMinutes, minElevationDeg, visibleOnly } = msg;
  const filter = msg.noradIds ? new Set(msg.noradIds) : null;
  const heightKm = (observer.altitudeM ?? 0) / 1000;
  const results = [];

  for (const e of entries) {
    if (filter && !filter.has(e.noradId)) continue;
    // Rule out the geometrically impossible before propagating anything.
    if (!filter && !canEverBeVisible(e.rec, observer, minElevationDeg)) continue;

    const found = findPassesForSatellite(
      e.rec,
      e.name,
      e.noradId,
      observer,
      {
        startMs,
        windowMinutes,
        minElevationDeg,
        visibleOnly,
        limit: DEFAULT_PASS_OPTIONS.limit,
      },
      heightKm
    );
    for (const p of found) results.push(p);
  }

  results.sort((a, b) => a.riseTimeMs - b.riseTimeMs);
  post({ type: 'passes', requestId, shardIndex, results, done: true });
}

// ---------------------------------------------------------------------------
// Orbit path for one satellite (only the shard that owns it responds).
// ---------------------------------------------------------------------------

function handleOrbit(msg: Extract<WorkerRequest, { type: 'orbit' }>): void {
  const entry = entries.find((e) => e.noradId === msg.noradId);
  if (!entry) {
    post({
      type: 'orbit',
      requestId: msg.requestId,
      found: false,
      path: new Float32Array(0),
      times: new Float64Array(0),
    });
    return;
  }

  const period = periodMinutes(entry.rec) || 95;
  const spanMs = period * 60_000 * msg.revolutions;
  const startMs = msg.centreMs - spanMs / 2;
  const steps = msg.steps;

  const path = new Float32Array((steps + 1) * 3);
  const times = new Float64Array(steps + 1);
  const scratch = createStateOut();
  let n = 0;

  for (let i = 0; i <= steps; i++) {
    const t = startMs + (i / steps) * spanMs;
    const st = propagateInto(entry.rec, t, gmstFromMs(t), scratch);
    if (!st.ok) continue;
    path[n * 3] = st.lat;
    path[n * 3 + 1] = st.lng;
    path[n * 3 + 2] = st.altKm;
    times[n] = t;
    n++;
  }

  const trimmedPath = path.slice(0, n * 3);
  const trimmedTimes = times.slice(0, n);
  post(
    { type: 'orbit', requestId: msg.requestId, found: true, path: trimmedPath, times: trimmedTimes },
    [trimmedPath.buffer, trimmedTimes.buffer]
  );
}

// ---------------------------------------------------------------------------

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init': {
        shardIndex = msg.payload.shardIndex;
        const { shardCount, records } = msg.payload;
        const info: SatelliteInfo[] = [];
        entries = [];

        for (let i = shardIndex; i < records.length; i += shardCount) {
          const r = records[i]!;
          const rec = parseSatrec(r.line1, r.line2);
          if (!rec) continue;
          entries.push({ noradId: r.noradId, name: r.name, rec });
          info.push({
            noradId: r.noradId,
            name: r.name,
            inclinationDeg: inclinationDeg(rec),
            periodMinutes: periodMinutes(rec),
            epochMs: satrecEpochMs(rec),
            block: starlinkBlock(r.name),
          });
        }
        post({ type: 'ready', shardIndex, count: entries.length, info });
        break;
      }
      case 'tick':
        handleTick(msg.timeMs, msg.observer, msg.nearestK, msg.buffers);
        break;
      case 'passes':
        handlePasses(msg);
        break;
      case 'orbit':
        handleOrbit(msg);
        break;
      case 'dispose':
        entries = [];
        ctx.close();
        break;
    }
  } catch (err) {
    post({
      type: 'error',
      shardIndex,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
