/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { useCallback, useState } from 'react';
import {
  formatAzimuth,
  formatClockTime,
  formatCountdown,
  formatDeg,
  formatDuration,
} from '../../lib/format';
import { useEngine, useEngineSnapshot } from '../../hooks/useEngine';

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
  const [windowMinutes, setWindowMinutes] = useState(180);

  const run = useCallback(() => {
    void engine.predictPasses(windowMinutes);
  }, [engine, windowMinutes]);

  if (!s.observer) {
    return (
      <section className="panel-section">
        <h2>Upcoming passes</h2>
        <p className="hint">Set a location to predict when satellites will fly over you.</p>
      </section>
    );
  }

  return (
    <section className="panel-section">
      <h2>Upcoming passes</h2>

      <div className="filter-grid">
        <label>
          <span className="muted small">Window</span>
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
          <span className="muted small">Min elevation</span>
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
          <span className="muted small">: sunlit satellite, dark sky where you are</span>
        </span>
      </label>

      <button className="btn btn-primary" onClick={run} disabled={s.passesStatus === 'loading'}>
        {s.passesStatus === 'loading' ? 'Searching the constellation…' : 'Find passes'}
      </button>

      {s.passesStatus === 'ready' && s.passes.length === 0 && (
        <p className="hint">
          No passes matched in the next {formatDuration(windowMinutes * 60_000)}
          {s.passesVisibleOnly && ' that are visible to the naked eye'}. Try a longer window
          or a lower minimum elevation.
        </p>
      )}

      {s.passes.length > 0 && (
        <>
          <p className="muted small">
            {s.passes.length} pass{s.passes.length === 1 ? '' : 'es'} · sorted by rise time
          </p>
          <ul className="list pass-list">
            {s.passes.slice(0, 40).map((p) => (
              <li key={`${p.noradId}-${p.riseTimeMs}`}>
                <button
                  className={p.noradId === s.selectedId ? 'list-item selected' : 'list-item'}
                  onClick={() => engine.select(p.noradId)}
                >
                  <span className="list-item-title">
                    {p.name}
                    {p.visible && (
                      <span className="tag tag-visible" title="Sunlit satellite, dark sky">
                        visible
                      </span>
                    )}
                  </span>
                  <span className="pass-timing">
                    in {formatCountdown(p.riseTimeMs)} · peak {formatDeg(p.peakElevationDeg, 0)}
                  </span>
                  <span className="muted small">
                    {formatClockTime(p.riseTimeMs)} {formatAzimuth(p.riseAzimuthDeg)} →{' '}
                    {formatAzimuth(p.setAzimuthDeg)} · {formatDuration(p.durationMs)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
