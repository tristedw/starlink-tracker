/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import type { GeoLocation, LookAngle, PassPrediction, SatelliteInfo, TleRecord } from './index';

/**
 * Protocol between the UI thread and the propagation workers.
 *
 * Anything big crossing this boundary is a transferable typed array, and the
 * buffers get recycled: the main thread hands each one back on the next
 * request, so neither side is allocating megabytes a second.
 */

export interface ShardInit {
  /** Index of this shard within the pool. */
  shardIndex: number;
  /** Total shards, so each worker knows its stride. */
  shardCount: number;
  /** The full record list; each worker keeps only its own stride. */
  records: TleRecord[];
}

export type WorkerRequest =
  | { type: 'init'; payload: ShardInit }
  | {
      type: 'tick';
      timeMs: number;
      /** Recycled buffers handed back for reuse; worker allocates if absent. */
      buffers?: FrameBuffers;
      /** Observer for the nearest-satellite reduction, if any. */
      observer: GeoLocation | null;
      /** How many nearest candidates this shard should return. */
      nearestK: number;
    }
  | {
      type: 'passes';
      requestId: number;
      observer: GeoLocation;
      startMs: number;
      windowMinutes: number;
      minElevationDeg: number;
      visibleOnly: boolean;
      /** Restrict to these NORAD ids; empty means "search the whole shard". */
      noradIds: number[] | null;
    }
  | {
      type: 'orbit';
      requestId: number;
      noradId: number;
      /** Centre of the sampled span, epoch ms. */
      centreMs: number;
      /** Orbits either side of the centre. */
      revolutions: number;
      steps: number;
    }
  | { type: 'dispose' };

export interface FrameBuffers {
  ids: Int32Array;
  lla: Float32Array;
  speed: Float32Array;
  illum: Uint8Array;
}

export type WorkerResponse =
  | { type: 'ready'; shardIndex: number; count: number; info: SatelliteInfo[] }
  | {
      type: 'frame';
      shardIndex: number;
      timeMs: number;
      count: number;
      buffers: FrameBuffers;
      nearest: LookAngle[];
    }
  | {
      type: 'passes';
      requestId: number;
      shardIndex: number;
      results: PassPrediction[];
      /** Fraction of this shard scanned, for progress reporting. */
      done: boolean;
    }
  | {
      type: 'orbit';
      requestId: number;
      found: boolean;
      /** lat, lng, altKm triples. */
      path: Float32Array;
      /** Sample times matching `path`, epoch ms. */
      times: Float64Array;
    }
  | { type: 'error'; shardIndex: number; message: string };
