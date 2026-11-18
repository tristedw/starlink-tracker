/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { useCallback, useState } from 'react';
import {
  compassPoint,
  formatClockTime,
  formatCountdown,
  formatDeg,
  formatDuration,
} from '../../lib/format';
import { useEngine, useEngineSnapshot } from '../../hooks/useEngine';
import { useClockState } from '../../hooks/useClock';

const WINDOWS = [
  { label: '1h', minutes: 60 },
  { label: '3h', minutes: 180 },
  { label: '12h', minutes: 720 },
];

const MIN_ELEVATIONS = [0, 10, 25, 40];

/**
 * Upcoming passes.
 *
 * The visible-only filter is why all the illumination maths exists. Without it
 * you get thousands of entries and can see almost none of them. With it you get
 * "go outside at this time, look that way".
 */
export default function PassesPanel() {
  const engine = useEngine();
  const s = useEngineSnapshot();
  const clock = useClockState(1000);
  const [windowMinutes, setWindowMinutes] = useState(180);

  const run = useCallback(() => {
    void engine.predictPasses(windowMinutes);
  }, [engine, windowMinutes]);

  if (!s.observer) {
    return (
      <section className="panel-section">
        <h2>Upcoming passes</h2>
        <p className="hint">Set a location first and the pass list fills in here.</p>
      </section>
    );
  }

  return (
    <section className="panel-section">
      <div className="section-head">
        <h2>Upcoming passes</h2>
        {s.passes.length > 0 && (
          <span className="section-meta">
            {s.passes.length} in the next {formatDuration(windowMinutes * 60_000)}
          </span>
        )}
      </div>

      <div className="filter-grid">
        <label>
          <span className="field-label">Look ahead</span>
          <div className="segmented">
            {WINDOWS.map((w) => (
              <button
                key={w.minutes}
                className={windowMinutes === w.minutes ? 'active' : ''}
                onClick={() => setWindowMinutes(w.minutes)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </label>

        <label>
          <span className="field-label">Min. height</span>
          <div className="segmented">
            {MIN_ELEVATIONS.map((e) => (
              <button
                key={e}
                className={s.passesMinElevationDeg === e ? 'active' : ''}
                onClick={() => engine.setPassFilters({ minElevationDeg: e })}
              >
                {e}°
              </button>
            ))}
          </div>
        </label>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={s.passesVisibleOnly}
          onChange={(e) => engine.setPassFilters({ visibleOnly: e.target.checked })}
        />
        <span>
          Naked-eye visible only
          <span className="checkbox-hint">Sunlit satellite and a dark sky where you are</span>
        </span>
      </label>

      <button className="btn btn-primary" onClick={run} disabled={s.passesStatus === 'loading'}>
        {s.passesStatus === 'loading' ? 'Searching…' : s.passes.length > 0 ? 'Search again' : 'Find passes'}
      </button>

      {s.passesStatus === 'ready' && s.passes.length === 0 && (
        <p className="hint">
          No passes matched in the next {formatDuration(windowMinutes * 60_000)}
          {s.passesVisibleOnly && ' that are visible to the naked eye'}. Try a longer window
          or a lower minimum elevation.
        </p>
      )}

      {s.passes.length > 0 && (
        <ul className="list pass-list">
          {s.passes.slice(0, 40).map((p) => (
            <li key={`${p.noradId}-${p.riseTimeMs}`}>
              <button
                className={`pass${p.noradId === s.selectedId ? ' selected' : ''}${p.visible ? ' is-visible' : ''}`}
                onClick={() => engine.select(p.noradId)}
              >
                <span className="pass-when">
                  <span className="pass-in">{formatCountdown(p.riseTimeMs, clock.timeMs)}</span>
                  <span className="pass-clock">{formatClockTime(p.riseTimeMs)}</span>
                </span>
                <span className="pass-what">
                  <span className="pass-name">
                    {p.name}
                    {p.visible && <span className="tag-visible">Visible</span>}
                  </span>
                  <span className="pass-path">
                    {compassPoint(p.riseAzimuthDeg)} to {compassPoint(p.setAzimuthDeg)}, {formatDuration(p.durationMs)}
                  </span>
                </span>
                <span className="pass-peak" title="Peak height above the horizon">
                  {formatDeg(p.peakElevationDeg, 0)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
