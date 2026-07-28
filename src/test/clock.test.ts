import { describe, expect, it } from 'vitest';
import { SimulationClock, clampToScrubRange, SCRUB_RANGE_MS } from '../lib/clock';

describe('SimulationClock', () => {
  it('tracks real time when live', () => {
    const c = new SimulationClock();
    expect(Math.abs(c.now() - Date.now())).toBeLessThan(50);
    expect(c.state.live).toBe(true);
    expect(c.state.offsetMs).toBe(0);
  });

  it('freezes when paused', async () => {
    const c = new SimulationClock();
    c.pause();
    const first = c.now();
    await new Promise((r) => setTimeout(r, 30));
    expect(c.now()).toBe(first);
    expect(c.state.playing).toBe(false);
  });

  it('resumes from where it paused, not from real time', async () => {
    const c = new SimulationClock();
    c.seek(Date.now() - 3_600_000);
    c.pause();
    const paused = c.now();
    await new Promise((r) => setTimeout(r, 30));
    c.play();
    // Should continue from the paused instant, roughly an hour behind now.
    expect(c.now()).toBeGreaterThanOrEqual(paused);
    expect(c.now()).toBeLessThan(paused + 1000);
  });

  it('advances faster than real time at higher rates', async () => {
    const c = new SimulationClock();
    c.setRate(60);
    const t0 = c.now();
    await new Promise((r) => setTimeout(r, 60));
    const elapsed = c.now() - t0;
    // 60ms of wall time at 60x should be roughly 3.6 simulated seconds.
    expect(elapsed).toBeGreaterThan(1500);
  });

  it('leaves live mode as soon as the rate changes', () => {
    const c = new SimulationClock();
    c.setRate(10);
    expect(c.state.live).toBe(false);
    expect(c.state.rate).toBe(10);
  });

  it('seeks to an absolute time', () => {
    const c = new SimulationClock();
    const target = Date.now() - 2 * 3_600_000;
    c.seek(target);
    expect(c.now()).toBeCloseTo(target, -2);
    expect(c.state.live).toBe(false);
  });

  it('clamps a seek beyond the scrub range', () => {
    const c = new SimulationClock();
    c.seek(Date.now() + SCRUB_RANGE_MS * 5);
    expect(c.now()).toBeLessThanOrEqual(Date.now() + SCRUB_RANGE_MS + 1000);
  });

  it('steps relative to the current instant', () => {
    const c = new SimulationClock();
    c.seek(Date.now());
    const before = c.now();
    c.step(-600_000);
    expect(c.now()).toBeLessThan(before - 500_000);
  });

  it('returns to real time on goLive', () => {
    const c = new SimulationClock();
    c.setRate(300);
    c.seek(Date.now() - 3_600_000);
    c.goLive();
    expect(c.state.live).toBe(true);
    expect(c.state.rate).toBe(1);
    expect(Math.abs(c.now() - Date.now())).toBeLessThan(50);
  });

  it('notifies subscribers on state changes', () => {
    const c = new SimulationClock();
    let calls = 0;
    const unsub = c.subscribe(() => calls++);
    c.pause();
    c.play();
    c.setRate(10);
    expect(calls).toBeGreaterThanOrEqual(3);
    unsub();
    c.pause();
    expect(calls).toBeGreaterThanOrEqual(3);
  });
});

describe('clampToScrubRange', () => {
  const now = 1_700_000_000_000;

  it('leaves in-range values alone', () => {
    expect(clampToScrubRange(now + 1000, now)).toBe(now + 1000);
  });

  it('clamps both directions', () => {
    expect(clampToScrubRange(now + SCRUB_RANGE_MS * 10, now)).toBe(now + SCRUB_RANGE_MS);
    expect(clampToScrubRange(now - SCRUB_RANGE_MS * 10, now)).toBe(now - SCRUB_RANGE_MS);
  });
});
