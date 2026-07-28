/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
/**
 * Simulation clock.
 *
 * Splits "what time the app is showing" from wall-clock time, so the whole
 * constellation can be paused, rewound or run at 300x. Propagation, sun
 * position and pass windows all read time from here, which is why the scrubber
 * needs no second code path.
 *
 * Time is derived, not accumulated (`base + elapsed * rate`), so it can't
 * drift. Elapsed comes from `performance.now()` so a system clock change
 * mid-session doesn't jump the view.
 */

export const RATE_PRESETS = [
  { label: '1×', value: 1 },
  { label: '10×', value: 10 },
  { label: '60×', value: 60 },
  { label: '300×', value: 300 },
] as const;

/** How far either side of real time the scrubber may travel. */
export const SCRUB_RANGE_MS = 6 * 60 * 60 * 1000;

export interface ClockState {
  /** Current simulated time, epoch ms. */
  timeMs: number;
  playing: boolean;
  rate: number;
  /** True when tracking real time at 1x, the normal case. */
  live: boolean;
  /** Simulated minus real time, ms. Zero when live. */
  offsetMs: number;
}

type Listener = (state: ClockState) => void;

export class SimulationClock {
  private baseSimMs: number;
  private basePerfMs: number;
  private rateValue = 1;
  private playingValue = true;
  private liveValue = true;
  private listeners = new Set<Listener>();

  constructor(nowMs: number = Date.now()) {
    this.baseSimMs = nowMs;
    this.basePerfMs = perfNow();
  }

  /** Current simulated time. Safe to call every frame, it's pure arithmetic. */
  now(): number {
    if (this.liveValue) return Date.now();
    if (!this.playingValue) return this.baseSimMs;
    return this.baseSimMs + (perfNow() - this.basePerfMs) * this.rateValue;
  }

  get state(): ClockState {
    const timeMs = this.now();
    return {
      timeMs,
      playing: this.playingValue,
      rate: this.rateValue,
      live: this.liveValue,
      offsetMs: this.liveValue ? 0 : timeMs - Date.now(),
    };
  }

  /** Re-anchor so `now()` is continuous across a mode change. */
  private reanchor(atMs = this.now()): void {
    this.baseSimMs = atMs;
    this.basePerfMs = perfNow();
  }

  play(): void {
    if (this.playingValue) return;
    this.reanchor();
    this.playingValue = true;
    this.emit();
  }

  pause(): void {
    if (!this.playingValue) return;
    // Freezing at the current instant requires leaving live mode.
    const at = this.now();
    this.liveValue = false;
    this.playingValue = false;
    this.reanchor(at);
    this.emit();
  }

  toggle(): void {
    this.playingValue ? this.pause() : this.play();
  }

  setRate(rate: number): void {
    if (rate === this.rateValue && !this.liveValue) return;
    this.reanchor();
    this.rateValue = rate;
    // Any rate other than 1x is by definition not tracking real time.
    if (rate !== 1) this.liveValue = false;
    this.playingValue = true;
    this.emit();
  }

  /** Jump to an absolute simulated time. */
  seek(timeMs: number): void {
    const clamped = clampToScrubRange(timeMs);
    this.liveValue = false;
    this.reanchor(clamped);
    this.emit();
  }

  /** Nudge forward or backward by a delta, keeping play state. */
  step(deltaMs: number): void {
    this.seek(this.now() + deltaMs);
  }

  /** Snap back to real time at 1x. */
  goLive(): void {
    this.liveValue = true;
    this.playingValue = true;
    this.rateValue = 1;
    this.reanchor(Date.now());
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    const s = this.state;
    for (const fn of this.listeners) fn(s);
  }
}

export function clampToScrubRange(timeMs: number, nowMs = Date.now()): number {
  return Math.min(nowMs + SCRUB_RANGE_MS, Math.max(nowMs - SCRUB_RANGE_MS, timeMs));
}

function perfNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
