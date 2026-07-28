/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RATE_PRESETS, SCRUB_RANGE_MS } from '../../lib/clock';
import { formatDateTime, formatDuration } from '../../lib/format';
import { useEngine } from '../../hooks/useEngine';
import { useClockState } from '../../hooks/useClock';

const STEPS = [
  { label: '−1h', ms: -3_600_000 },
  { label: '−5m', ms: -300_000 },
  { label: '+5m', ms: 300_000 },
  { label: '+1h', ms: 3_600_000 },
];

/**
 * Simulation clock controls.
 *
 * Scrubbing works because everything reads the same clock: propagators, sun
 * position, pass search. Dragging the slider isn't replaying a recording, it
 * re-derives the whole constellation at that instant, which is why backwards
 * works as well as forwards.
 */
export default function TimeControls() {
  const engine = useEngine();
  const clock = useClockState();
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  // Anchor the slider range to a "now" that only moves while nobody's
  // dragging, so the handle doesn't crawl out from under the pointer.
  const [anchorNow, setAnchorNow] = useState(() => Date.now());
  useEffect(() => {
    if (dragging) return;
    const t = setInterval(() => setAnchorNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [dragging]);

  const offset = dragging ? dragValue : clock.timeMs - anchorNow;

  const onScrub = useCallback(
    (value: number) => {
      setDragValue(value);
      engine.clock.seek(anchorNow + value);
    },
    [engine, anchorNow]
  );

  const offsetLabel = useMemo(() => {
    if (clock.live) return 'Live';
    if (Math.abs(offset) < 2000) return 'now';
    return offset > 0 ? `+${formatDuration(offset)}` : `−${formatDuration(-offset)}`;
  }, [clock.live, offset]);

  // Keyboard shortcuts: space to pause, arrows to step, L for live.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key === ' ') {
        e.preventDefault();
        engine.clock.toggle();
      } else if (e.key === 'ArrowLeft') {
        engine.clock.step(e.shiftKey ? -3_600_000 : -300_000);
      } else if (e.key === 'ArrowRight') {
        engine.clock.step(e.shiftKey ? 3_600_000 : 300_000);
      } else if (e.key.toLowerCase() === 'l') {
        engine.clock.goLive();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  return (
    <div className="time-controls">
      <div className="time-row">
        <button
          className="btn-icon btn-play"
          onClick={() => engine.clock.toggle()}
          aria-label={clock.playing ? 'Pause' : 'Play'}
          title={clock.playing ? 'Pause (space)' : 'Play (space)'}
        >
          {clock.playing ? '❚❚' : '▶'}
        </button>

        <div className="time-readout">
          <span className="mono time-value">{formatDateTime(clock.timeMs)}</span>
          <span className={clock.live ? 'badge badge-live' : 'badge'}>{offsetLabel}</span>
        </div>

        <div className="segmented rate-picker" role="group" aria-label="Time rate">
          {RATE_PRESETS.map((r) => (
            <button
              key={r.value}
              className={!clock.live && clock.rate === r.value ? 'active' : ''}
              onClick={() => engine.clock.setRate(r.value)}
              title={`Run time at ${r.label} speed`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <button
          className="btn btn-small"
          onClick={() => engine.clock.goLive()}
          disabled={clock.live}
          title="Return to real time (L)"
        >
          Live
        </button>
      </div>

      <div className="time-row">
        {STEPS.map((s) => (
          <button key={s.label} className="btn btn-small btn-ghost" onClick={() => engine.clock.step(s.ms)}>
            {s.label}
          </button>
        ))}

        <input
          className="scrubber"
          type="range"
          min={-SCRUB_RANGE_MS}
          max={SCRUB_RANGE_MS}
          step={30_000}
          value={Math.round(offset)}
          onPointerDown={() => {
            setDragValue(clock.timeMs - anchorNow);
            setDragging(true);
          }}
          onPointerUp={() => setDragging(false)}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="Scrub simulated time"
        />
      </div>
    </div>
  );
}
