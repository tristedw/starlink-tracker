/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import type {
  GeoLocation,
  LookAngle,
  PassPrediction,
  PositionFrame,
  SatelliteInfo,
  TleRecord,
} from '../types';
import type { FrameBuffers, WorkerRequest, WorkerResponse } from '../types/messages';

/**
 * Runs the propagation shard workers and stitches their output into one frame.
 *
 * Propagating ~11,000 SGP4 objects takes about 70 ms on a desktop core, and
 * several times that on a phone. One worker means a 10 Hz ceiling and a pegged
 * core. Split four ways it's ~25 ms a shard, which leaves room for the tick
 * rates the scrubber needs at 60x.
 */

export interface PoolOptions {
  /** Number of shard workers. Defaults to a conservative read of the device. */
  shardCount?: number;
  /** Nearest candidates requested per shard before the global merge. */
  nearestKPerShard?: number;
}

export interface PoolFrame extends PositionFrame {
  /** Globally merged nearest satellites, closest first. */
  nearest: LookAngle[];
}

type FrameListener = (frame: PoolFrame) => void;

interface ShardState {
  worker: Worker;
  index: number;
  count: number;
  /** Start of this shard's slice in the combined arrays. */
  offset: number;
  ready: boolean;
  /** Buffers currently owned by the main thread, ready to lend back. */
  spare?: FrameBuffers;
  /** Latest frame received, awaiting the rest of the pool. */
  pending?: { timeMs: number; count: number; nearest: LookAngle[] };
}

/**
 * Pick a shard count. `hardwareConcurrency` counts hyperthreads and the main
 * thread still needs a core to render on, so under-subscribe on purpose.
 */
export function defaultShardCount(): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(6, Math.floor((cores - 1) / 1.5) || 1));
}

export class PropagatorPool {
  private shards: ShardState[] = [];
  private frameListeners = new Set<FrameListener>();
  private infoById = new Map<number, SatelliteInfo>();
  private totalCount = 0;
  private nearestK: number;
  private disposed = false;

  /** Combined arrays, allocated once the shard sizes are known. */
  private combined: {
    ids: Int32Array;
    lla: Float32Array;
    speed: Float32Array;
    illum: Uint8Array;
  } | null = null;

  private inflightTick = 0;
  private tickTimeMs = 0;
  private tickNearest: LookAngle[] = [];

  private nextRequestId = 1;
  private passWaiters = new Map<
    number,
    { resolve: (v: PassPrediction[]) => void; results: PassPrediction[]; remaining: number }
  >();
  private orbitWaiters = new Map<
    number,
    { resolve: (v: { path: Float32Array; times: Float64Array } | null) => void; remaining: number }
  >();

  constructor(private readonly options: PoolOptions = {}) {
    this.nearestK = options.nearestKPerShard ?? 24;
  }

  get satelliteCount(): number {
    return this.totalCount;
  }

  getInfo(noradId: number): SatelliteInfo | undefined {
    return this.infoById.get(noradId);
  }

  allInfo(): SatelliteInfo[] {
    return [...this.infoById.values()];
  }

  onFrame(fn: FrameListener): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  /** Spin up the workers and hand each its stride of the catalogue. */
  async init(records: TleRecord[]): Promise<{ count: number; shards: number }> {
    this.disposeWorkers();
    this.disposed = false;

    const shardCount = Math.max(
      1,
      Math.min(this.options.shardCount ?? defaultShardCount(), Math.ceil(records.length / 250) || 1)
    );

    const readyPromises: Promise<void>[] = [];

    for (let i = 0; i < shardCount; i++) {
      // Keep this options object a static literal. Vite reads it at build time
      // to work out how to bundle the worker and a computed `name` makes it
      // give up. The shard says who it is in the init message instead.
      const worker = new Worker(new URL('./propagator.worker.ts', import.meta.url), {
        type: 'module',
      });
      const shard: ShardState = { worker, index: i, count: 0, offset: 0, ready: false };
      this.shards.push(shard);

      readyPromises.push(
        new Promise<void>((resolve, reject) => {
          const onReady = (ev: MessageEvent<WorkerResponse>) => {
            const msg = ev.data;
            if (msg.type === 'ready' && msg.shardIndex === i) {
              shard.count = msg.count;
              shard.ready = true;
              for (const info of msg.info) this.infoById.set(info.noradId, info);
              worker.removeEventListener('message', onReady);
              resolve();
            } else if (msg.type === 'error') {
              worker.removeEventListener('message', onReady);
              reject(new Error(msg.message));
            }
          };
          worker.addEventListener('message', onReady);
        })
      );

      worker.addEventListener('message', (ev: MessageEvent<WorkerResponse>) =>
        this.handleMessage(shard, ev.data)
      );
      worker.addEventListener('error', (ev) =>
        console.error(`propagation shard ${i} crashed`, ev.message)
      );

      const req: WorkerRequest = {
        type: 'init',
        payload: { shardIndex: i, shardCount, records },
      };
      worker.postMessage(req);
    }

    await Promise.all(readyPromises);

    let offset = 0;
    for (const shard of this.shards) {
      shard.offset = offset;
      offset += shard.count;
    }
    this.totalCount = offset;

    this.combined = {
      ids: new Int32Array(this.totalCount),
      lla: new Float32Array(this.totalCount * 3),
      speed: new Float32Array(this.totalCount),
      illum: new Uint8Array(this.totalCount),
    };

    return { count: this.totalCount, shards: shardCount };
  }

  /**
   * Request a frame at `timeMs`. Ignored if a tick is still outstanding, so a
   * slow device just runs slower instead of piling up stale work.
   */
  tick(timeMs: number, observer: GeoLocation | null): boolean {
    if (this.disposed || this.shards.length === 0 || this.inflightTick > 0) return false;

    this.inflightTick = this.shards.length;
    this.tickTimeMs = timeMs;
    this.tickNearest = [];

    for (const shard of this.shards) {
      const buffers = shard.spare;
      shard.spare = undefined;
      const req: WorkerRequest = {
        type: 'tick',
        timeMs,
        observer,
        nearestK: observer ? this.nearestK : 0,
        ...(buffers ? { buffers } : {}),
      };
      const transfer = buffers
        ? [buffers.ids.buffer, buffers.lla.buffer, buffers.speed.buffer, buffers.illum.buffer]
        : [];
      shard.worker.postMessage(req, transfer);
    }
    return true;
  }

  /** True when no tick is currently outstanding. */
  get idle(): boolean {
    return this.inflightTick === 0;
  }

  /**
   * Pass search across the whole constellation, fanned out and merged.
   * `noradIds` narrows it when the caller only cares about a few satellites.
   */
  findPasses(params: {
    observer: GeoLocation;
    startMs: number;
    windowMinutes: number;
    minElevationDeg: number;
    visibleOnly: boolean;
    noradIds?: number[] | null;
  }): Promise<PassPrediction[]> {
    if (this.shards.length === 0) return Promise.resolve([]);
    const requestId = this.nextRequestId++;

    return new Promise<PassPrediction[]>((resolve) => {
      this.passWaiters.set(requestId, {
        resolve,
        results: [],
        remaining: this.shards.length,
      });
      for (const shard of this.shards) {
        const req: WorkerRequest = {
          type: 'passes',
          requestId,
          observer: params.observer,
          startMs: params.startMs,
          windowMinutes: params.windowMinutes,
          minElevationDeg: params.minElevationDeg,
          visibleOnly: params.visibleOnly,
          noradIds: params.noradIds ?? null,
        };
        shard.worker.postMessage(req);
      }
    });
  }

  /** Sampled orbit path for one satellite. Resolves null if it isn't tracked. */
  getOrbit(
    noradId: number,
    centreMs: number,
    revolutions = 1,
    steps = 240
  ): Promise<{ path: Float32Array; times: Float64Array } | null> {
    if (this.shards.length === 0) return Promise.resolve(null);
    const requestId = this.nextRequestId++;

    return new Promise((resolve) => {
      this.orbitWaiters.set(requestId, { resolve, remaining: this.shards.length });
      for (const shard of this.shards) {
        const req: WorkerRequest = {
          type: 'orbit',
          requestId,
          noradId,
          centreMs,
          revolutions,
          steps,
        };
        shard.worker.postMessage(req);
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.disposeWorkers();
    this.frameListeners.clear();
    this.infoById.clear();
    this.combined = null;
    this.totalCount = 0;
  }

  // -------------------------------------------------------------------------

  private disposeWorkers(): void {
    for (const shard of this.shards) shard.worker.terminate();
    this.shards = [];
    this.inflightTick = 0;
    this.passWaiters.clear();
    this.orbitWaiters.clear();
  }

  private handleMessage(shard: ShardState, msg: WorkerResponse): void {
    switch (msg.type) {
      case 'frame':
        this.handleFrame(shard, msg);
        break;
      case 'passes': {
        const waiter = this.passWaiters.get(msg.requestId);
        if (!waiter) return;
        waiter.results.push(...msg.results);
        if (--waiter.remaining === 0) {
          this.passWaiters.delete(msg.requestId);
          waiter.results.sort((a, b) => a.riseTimeMs - b.riseTimeMs);
          waiter.resolve(waiter.results);
        }
        break;
      }
      case 'orbit': {
        const waiter = this.orbitWaiters.get(msg.requestId);
        if (!waiter) return;
        if (msg.found) {
          this.orbitWaiters.delete(msg.requestId);
          waiter.resolve({ path: msg.path, times: msg.times });
        } else if (--waiter.remaining === 0) {
          // Every shard reported "not mine".
          this.orbitWaiters.delete(msg.requestId);
          waiter.resolve(null);
        }
        break;
      }
      case 'error':
        console.error(`propagation shard ${msg.shardIndex}:`, msg.message);
        if (this.inflightTick > 0) this.inflightTick--;
        break;
      case 'ready':
        break;
    }
  }

  private handleFrame(shard: ShardState, msg: Extract<WorkerResponse, { type: 'frame' }>): void {
    const combined = this.combined;
    if (!combined) return;

    // Frame from a superseded tick, e.g. after a seek. Drop it.
    if (msg.timeMs !== this.tickTimeMs) {
      shard.spare = msg.buffers;
      if (this.inflightTick > 0) this.inflightTick--;
      return;
    }

    const n = Math.min(msg.count, shard.count);
    combined.ids.set(msg.buffers.ids.subarray(0, n), shard.offset);
    combined.lla.set(msg.buffers.lla.subarray(0, n * 3), shard.offset * 3);
    combined.speed.set(msg.buffers.speed.subarray(0, n), shard.offset);
    combined.illum.set(msg.buffers.illum.subarray(0, n), shard.offset);

    // Hand the buffers back for reuse on the next tick.
    shard.spare = msg.buffers;
    if (msg.nearest.length) this.tickNearest.push(...msg.nearest);

    if (--this.inflightTick === 0) {
      this.tickNearest.sort((a, b) => a.groundDistanceKm - b.groundDistanceKm);
      const frame: PoolFrame = {
        timeMs: this.tickTimeMs,
        count: this.totalCount,
        ids: combined.ids,
        lla: combined.lla,
        speed: combined.speed,
        illum: combined.illum,
        nearest: this.tickNearest.slice(0, this.nearestK),
      };
      for (const fn of this.frameListeners) fn(frame);
    }
  }
}
