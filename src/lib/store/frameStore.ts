/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { ILLUM } from '../math/constants';
import type { PoolFrame } from '../../workers/pool';

/**
 * Double-buffered position frames.
 *
 * The pool ticks once or twice a second, the renderers draw at 60. Holding on
 * to the previous frame as well as the current one lets each view interpolate
 * between them, so motion stays smooth without propagating 11,000 orbits per
 * animation frame. Satellite index is stable across frames by construction
 * (see the shard worker), which is the bit that makes this valid.
 */

export interface FrameSlot {
  timeMs: number;
  /** lat, lng, altKm triples. */
  lla: Float32Array;
  illum: Uint8Array;
  speed: Float32Array;
  valid: boolean;
}

export class FrameStore {
  count = 0;
  ids = new Int32Array(0);
  /** Bumped whenever a new frame lands, so renderers know to re-derive. */
  seq = 0;

  private a: FrameSlot = emptySlot();
  private b: FrameSlot = emptySlot();
  /** Points at the newer of `a`/`b`. */
  private curIsA = true;

  private indexById = new Map<number, number>();

  get current(): FrameSlot {
    return this.curIsA ? this.a : this.b;
  }

  get previous(): FrameSlot {
    return this.curIsA ? this.b : this.a;
  }

  indexOf(noradId: number): number {
    return this.indexById.get(noradId) ?? -1;
  }

  reset(count: number): void {
    this.count = count;
    this.ids = new Int32Array(count);
    this.a = allocSlot(count);
    this.b = allocSlot(count);
    this.curIsA = true;
    this.seq = 0;
    this.indexById.clear();
  }

  /**
   * Copy a pool frame into the write slot and swap.
   *
   * Yes, copy. The pool reuses its arrays every tick, so keeping a reference
   * would quietly turn the "previous" frame into the current one and
   * interpolation would go flat.
   */
  applyFrame(frame: PoolFrame): void {
    if (frame.count !== this.count) this.reset(frame.count);

    this.ids.set(frame.ids.subarray(0, this.count));
    if (this.indexById.size !== this.count) {
      this.indexById.clear();
      for (let i = 0; i < this.count; i++) this.indexById.set(this.ids[i]!, i);
    }

    const write = this.curIsA ? this.b : this.a;
    write.lla.set(frame.lla.subarray(0, this.count * 3));
    write.illum.set(frame.illum.subarray(0, this.count));
    write.speed.set(frame.speed.subarray(0, this.count));
    write.timeMs = frame.timeMs;
    write.valid = true;

    this.curIsA = !this.curIsA;
    this.seq++;
  }

  /**
   * Interpolation factor for `atMs`, clamped to [0, 1]. Extrapolating past the
   * newest frame makes satellites overshoot and snap back when a tick runs late.
   */
  alpha(atMs: number): number {
    const cur = this.current;
    const prev = this.previous;
    if (!prev.valid || !cur.valid) return 1;
    const span = cur.timeMs - prev.timeMs;
    if (span <= 0) return 1;
    return Math.min(1, Math.max(0, (atMs - prev.timeMs) / span));
  }

  /** True when the satellite at `index` has a usable position this frame. */
  isValid(index: number): boolean {
    return this.current.illum[index] !== ILLUM.INVALID;
  }
}

function emptySlot(): FrameSlot {
  return {
    timeMs: 0,
    lla: new Float32Array(0),
    illum: new Uint8Array(0),
    speed: new Float32Array(0),
    valid: false,
  };
}

function allocSlot(count: number): FrameSlot {
  return {
    timeMs: 0,
    lla: new Float32Array(count * 3),
    illum: new Uint8Array(count),
    speed: new Float32Array(count),
    valid: false,
  };
}
