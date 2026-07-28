import { describe, expect, it } from 'vitest';
import { FrameStore } from '../lib/store/frameStore';
import { ILLUM } from '../lib/math/constants';
import type { PoolFrame } from '../../src/workers/pool';

function makeFrame(timeMs: number, lats: number[]): PoolFrame {
  const n = lats.length;
  const lla = new Float32Array(n * 3);
  lats.forEach((lat, i) => {
    lla[i * 3] = lat;
    lla[i * 3 + 1] = lat * 2;
    lla[i * 3 + 2] = 550;
  });
  return {
    timeMs,
    count: n,
    ids: Int32Array.from(lats.map((_, i) => 1000 + i)),
    lla,
    speed: new Float32Array(n).fill(7.5),
    illum: new Uint8Array(n).fill(ILLUM.SUNLIT),
    nearest: [],
  };
}

describe('FrameStore', () => {
  it('exposes the newest frame as current', () => {
    const s = new FrameStore();
    s.applyFrame(makeFrame(1000, [10, 20]));
    expect(s.current.timeMs).toBe(1000);
    expect(s.current.lla[0]).toBeCloseTo(10, 4);
  });

  it('keeps the prior frame available after a swap', () => {
    const s = new FrameStore();
    s.applyFrame(makeFrame(1000, [10, 20]));
    s.applyFrame(makeFrame(2000, [11, 21]));
    expect(s.current.timeMs).toBe(2000);
    expect(s.previous.timeMs).toBe(1000);
    expect(s.previous.lla[0]).toBeCloseTo(10, 4);
    expect(s.current.lla[0]).toBeCloseTo(11, 4);
  });

  it('copies rather than aliasing the pool buffers', () => {
    const s = new FrameStore();
    const frame = makeFrame(1000, [10, 20]);
    s.applyFrame(frame);
    // Simulate the pool reusing its combined array for the next tick.
    frame.lla[0] = 999;
    expect(s.current.lla[0]).toBeCloseTo(10, 4);
  });

  it('maps NORAD ids to stable indices', () => {
    const s = new FrameStore();
    s.applyFrame(makeFrame(1000, [10, 20, 30]));
    expect(s.indexOf(1000)).toBe(0);
    expect(s.indexOf(1002)).toBe(2);
    expect(s.indexOf(4242)).toBe(-1);
  });

  it('interpolates linearly between frame times', () => {
    const s = new FrameStore();
    s.applyFrame(makeFrame(1000, [10]));
    s.applyFrame(makeFrame(2000, [20]));
    expect(s.alpha(1000)).toBeCloseTo(0, 6);
    expect(s.alpha(1500)).toBeCloseTo(0.5, 6);
    expect(s.alpha(2000)).toBeCloseTo(1, 6);
  });

  it('clamps alpha rather than extrapolating', () => {
    const s = new FrameStore();
    s.applyFrame(makeFrame(1000, [10]));
    s.applyFrame(makeFrame(2000, [20]));
    // Overshooting would make satellites visibly race ahead and snap back
    // whenever a propagation tick runs late.
    expect(s.alpha(5000)).toBe(1);
    expect(s.alpha(0)).toBe(0);
  });

  it('returns alpha 1 before a second frame exists', () => {
    const s = new FrameStore();
    s.applyFrame(makeFrame(1000, [10]));
    expect(s.alpha(1000)).toBe(1);
  });

  it('handles a zero or reversed time span without dividing by zero', () => {
    const s = new FrameStore();
    s.applyFrame(makeFrame(2000, [10]));
    s.applyFrame(makeFrame(2000, [20]));
    expect(Number.isFinite(s.alpha(2000))).toBe(true);
    expect(s.alpha(2000)).toBe(1);
  });

  it('reallocates when the satellite count changes', () => {
    const s = new FrameStore();
    s.applyFrame(makeFrame(1000, [10, 20]));
    s.applyFrame(makeFrame(2000, [10, 20, 30]));
    expect(s.count).toBe(3);
    expect(s.current.lla).toHaveLength(9);
  });

  it('flags slots whose propagation failed', () => {
    const s = new FrameStore();
    const frame = makeFrame(1000, [10, 20]);
    frame.illum[1] = ILLUM.INVALID;
    s.applyFrame(frame);
    expect(s.isValid(0)).toBe(true);
    expect(s.isValid(1)).toBe(false);
  });

  it('increments seq on every applied frame', () => {
    const s = new FrameStore();
    expect(s.seq).toBe(0);
    s.applyFrame(makeFrame(1000, [10]));
    s.applyFrame(makeFrame(2000, [11]));
    expect(s.seq).toBe(2);
  });
});
