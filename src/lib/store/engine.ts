/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import type {
  GeoLocation,
  LookAngle,
  PassPrediction,
  SatelliteDetail,
  SatelliteInfo,
} from '../../types';
import { PropagatorPool, type PoolFrame } from '../../workers/pool';
import { fetchMeta, isAbortError, loadTle } from '../api/tleClient';
import { SimulationClock } from '../clock';
import { META_POLL_MS } from '../config';
import { ILLUM } from '../math/constants';
import { haversineKm } from '../math/geo';
import { FrameStore } from './frameStore';

/**
 * Owns the data pipeline: fetch, shard workers, frame store.
 *
 * Two kinds of state, kept well apart. Positions live in {@link FrameStore} as
 * typed arrays that the renderers read straight off each animation frame. They
 * never go near React. Everything else (counts, nearest list, selection,
 * passes) is a plain immutable snapshot published a few times a second for
 * `useSyncExternalStore`.
 */

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';
export type PassesStatus = 'idle' | 'loading' | 'ready';

export interface EngineSnapshot {
  status: EngineStatus;
  error: string | null;
  warning: string | null;
  satelliteCount: number;
  shardCount: number;
  /** Epoch ms of the element set currently loaded. */
  dataFetchedAt: number | null;
  dataSource: 'network' | 'cache' | null;
  /** Simulated time of the most recent frame. */
  frameTimeMs: number;
  observer: GeoLocation | null;
  nearest: LookAngle[];
  selectedId: number | null;
  selectedDetail: SatelliteDetail | null;
  passes: PassPrediction[];
  passesStatus: PassesStatus;
  passesVisibleOnly: boolean;
  passesMinElevationDeg: number;
  /** Measured propagation ticks per second. Actual load, not a guess. */
  tickHz: number;
}

/** UI-visible state is republished no faster than this. */
const SNAPSHOT_INTERVAL_MS = 250;
/** Longest gap between propagation ticks (real time). */
const MAX_TICK_MS = 1000;
/** Shortest gap, so a high time-rate can't peg the CPU. */
const MIN_TICK_MS = 120;
/** Target simulated seconds per tick; drives the adaptive tick rate. */
const TARGET_SIM_STEP_MS = 5000;

export class TrackerEngine {
  readonly clock = new SimulationClock();
  readonly frames = new FrameStore();
  readonly pool = new PropagatorPool();

  private snapshot: EngineSnapshot = {
    status: 'idle',
    error: null,
    warning: null,
    satelliteCount: 0,
    shardCount: 0,
    dataFetchedAt: null,
    dataSource: null,
    frameTimeMs: Date.now(),
    observer: null,
    nearest: [],
    selectedId: null,
    selectedDetail: null,
    passes: [],
    passesStatus: 'idle',
    passesVisibleOnly: false,
    passesMinElevationDeg: 10,
    tickHz: 0,
  };

  private listeners = new Set<() => void>();
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSnapshotAt = 0;
  private tickTimestamps: number[] = [];
  private unsubFrame: (() => void) | null = null;
  private abort: AbortController | null = null;
  /**
   * Identifies the current `start()` run. StrictMode double-mounts in dev, so
   * two loads can be in flight at once and without this the slower one wins.
   */
  private startToken = 0;
  private passToken = 0;
  private infoIndex: SatelliteInfo[] = [];

  // --- external store plumbing --------------------------------------------

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): EngineSnapshot => this.snapshot;

  private publish(patch: Partial<EngineSnapshot>, force = false): void {
    this.snapshot = { ...this.snapshot, ...patch };
    const now = performance.now();
    if (!force && now - this.lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;
    this.lastSnapshotAt = now;
    for (const fn of this.listeners) fn();
  }

  // --- lifecycle -----------------------------------------------------------

  /**
   * Load elements and bring the pool up. `quiet` is for the background refresh,
   * where there's already a constellation on screen and flashing a spinner at
   * it every two hours would be worse than useless.
   */
  async start(quiet = false): Promise<void> {
    this.abort?.abort();
    this.abort = new AbortController();
    const token = ++this.startToken;
    if (!quiet) this.publish({ status: 'loading', error: null, warning: null }, true);

    try {
      const { records, fetchedAt, source, warning } = await loadTle(this.abort.signal);
      if (token !== this.startToken) return;

      const { count, shards } = await this.pool.init(records);
      if (token !== this.startToken) return;

      this.frames.reset(count);
      this.infoIndex = this.pool.allInfo();

      this.unsubFrame?.();
      this.unsubFrame = this.pool.onFrame((frame) => this.onFrame(frame));

      this.publish(
        {
          status: 'ready',
          satelliteCount: count,
          shardCount: shards,
          dataFetchedAt: fetchedAt,
          dataSource: source,
          warning: warning ?? null,
        },
        true
      );

      this.scheduleTick(0);
      this.scheduleRefresh();
    } catch (err) {
      // Superseded or cancelled runs aren't failures worth showing anyone.
      if (token !== this.startToken || isAbortError(err)) return;
      // Don't tear down a working view over a failed refresh. What's on
      // screen is still the best we have.
      if (quiet) {
        this.scheduleRefresh();
        return;
      }
      this.publish(
        {
          status: 'error',
          error: err instanceof Error ? err.message : 'Failed to load satellite data',
        },
        true
      );
    }
  }

  stop(): void {
    this.startToken++;
    this.abort?.abort();
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.unsubFrame?.();
    this.unsubFrame = null;
    this.pool.dispose();
    this.listeners.clear();
  }

  // --- periodic element refresh -------------------------------------------

  /**
   * Elements get republished every couple of hours. Leave the tracker open
   * overnight and it shouldn't still be running yesterday's set.
   *
   * We poll meta.json, not the 1.8 MB element file, and a hidden tab skips it
   * entirely. No point generating traffic for a page nobody's looking at.
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.checkForNewElements(), META_POLL_MS);
  }

  private async checkForNewElements(): Promise<void> {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      this.scheduleRefresh();
      return;
    }

    const meta = await fetchMeta();
    const current = this.snapshot.dataFetchedAt;
    if (!meta?.ok || meta.fetchedAt === null || current === null || meta.fetchedAt <= current) {
      this.scheduleRefresh();
      return;
    }

    // `start` reschedules the next check itself, on both paths.
    await this.start(true);
  }

  // --- ticking -------------------------------------------------------------

  /**
   * Tick interval follows the time rate. One second per tick is fine at 1x, but
   * at 300x it's a five-minute jump and you can see the interpolation cutting
   * corners.
   */
  private currentTickMs(): number {
    const rate = Math.max(1, this.clock.state.rate);
    return Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, TARGET_SIM_STEP_MS / rate));
  }

  private scheduleTick(delay: number): void {
    if (this.tickTimer !== null) clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(() => this.runTick(), delay);
  }

  private runTick(): void {
    const interval = this.currentTickMs();
    // Skip while the pool is busy. A device that can't keep up should just
    // tick slower, not build a queue.
    if (this.pool.idle) {
      this.pool.tick(this.clock.now(), this.snapshot.observer);
    }
    this.scheduleTick(interval);
  }

  private onFrame(frame: PoolFrame): void {
    this.frames.applyFrame(frame);

    const now = performance.now();
    this.tickTimestamps.push(now);
    while (this.tickTimestamps.length > 0 && now - this.tickTimestamps[0]! > 3000) {
      this.tickTimestamps.shift();
    }
    const tickHz =
      this.tickTimestamps.length > 1
        ? ((this.tickTimestamps.length - 1) * 1000) /
          (now - this.tickTimestamps[0]!)
        : 0;

    this.publish({
      frameTimeMs: frame.timeMs,
      nearest: frame.nearest,
      selectedDetail: this.buildDetail(frame),
      tickHz,
    });
  }

  // --- selection -----------------------------------------------------------

  select(noradId: number | null): void {
    this.publish({ selectedId: noradId }, true);
    this.publish({ selectedDetail: this.buildDetail(null) }, true);
  }

  private buildDetail(frame: PoolFrame | null): SatelliteDetail | null {
    const id = this.snapshot.selectedId;
    if (id === null) return null;
    const info = this.pool.getInfo(id);
    if (!info) return null;

    const idx = this.frames.indexOf(id);
    if (idx < 0) return { ...info, lat: 0, lng: 0, altKm: 0, speedKmS: 0, illumination: 'sunlit', look: null };

    const cur = this.frames.current;
    const lat = cur.lla[idx * 3] ?? 0;
    const lng = cur.lla[idx * 3 + 1] ?? 0;
    const altKm = cur.lla[idx * 3 + 2] ?? 0;
    const code = cur.illum[idx] ?? ILLUM.SUNLIT;

    const nearestEntry = (frame?.nearest ?? this.snapshot.nearest).find((n) => n.noradId === id);
    const observer = this.snapshot.observer;

    return {
      ...info,
      lat,
      lng,
      altKm,
      speedKmS: cur.speed[idx] ?? 0,
      illumination: code === ILLUM.UMBRA ? 'umbra' : code === ILLUM.PENUMBRA ? 'penumbra' : 'sunlit',
      look: nearestEntry
        ? {
            azimuthDeg: nearestEntry.azimuthDeg,
            elevationDeg: nearestEntry.elevationDeg,
            rangeKm: nearestEntry.rangeKm,
            groundDistanceKm: nearestEntry.groundDistanceKm,
          }
        : observer
          ? {
              // Not in the nearest set. Ground distance is cheap so show it,
              // but leave look angles out rather than make them up.
              azimuthDeg: Number.NaN,
              elevationDeg: Number.NaN,
              rangeKm: Number.NaN,
              groundDistanceKm: haversineKm(observer, { lat, lng }),
            }
          : null,
    };
  }

  // --- observer ------------------------------------------------------------

  setObserver(observer: GeoLocation | null): void {
    this.publish({ observer, nearest: observer ? this.snapshot.nearest : [] }, true);
    if (!observer) this.publish({ passes: [], passesStatus: 'idle' }, true);
  }

  // --- passes --------------------------------------------------------------

  setPassFilters(patch: { visibleOnly?: boolean; minElevationDeg?: number }): void {
    this.publish(
      {
        passesVisibleOnly: patch.visibleOnly ?? this.snapshot.passesVisibleOnly,
        passesMinElevationDeg: patch.minElevationDeg ?? this.snapshot.passesMinElevationDeg,
      },
      true
    );
  }

  /**
   * Search the whole constellation for upcoming passes, fanned out across the
   * pool. Results from a superseded request get dropped instead of flashing
   * into the UI.
   */
  async predictPasses(windowMinutes = 180, noradIds: number[] | null = null): Promise<void> {
    const observer = this.snapshot.observer;
    if (!observer) return;

    const token = ++this.passToken;
    this.publish({ passesStatus: 'loading' }, true);

    const results = await this.pool.findPasses({
      observer,
      startMs: this.clock.now(),
      windowMinutes,
      minElevationDeg: this.snapshot.passesMinElevationDeg,
      visibleOnly: this.snapshot.passesVisibleOnly,
      noradIds,
    });

    if (token !== this.passToken) return;
    this.publish({ passes: results, passesStatus: 'ready' }, true);
  }

  // --- search --------------------------------------------------------------

  /** Prefix/substring search over names and NORAD ids. */
  search(query: string, limit = 20): SatelliteInfo[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SatelliteInfo[] = [];
    for (const info of this.infoIndex) {
      if (info.name.toLowerCase().includes(q) || String(info.noradId).includes(q)) {
        out.push(info);
        if (out.length >= limit) break;
      }
    }
    return out;
  }
}
