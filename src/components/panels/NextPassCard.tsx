/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { useEffect, useRef } from 'react';
import {
  compassPoint,
  formatClockTime,
  formatCountdown,
  formatDeg,
  formatDuration,
} from '../../lib/format';
import { useEngine, useEngineSnapshot } from '../../hooks/useEngine';
import { useClockState } from '../../hooks/useClock';
import SkyPlot from './SkyPlot';

/**
 * The one question most people open this for: when's the next one, and where
 * do I look. Runs a 3h search on its own as soon as there's a location, so the
 * answer is there without pressing anything.
 */
export default function NextPassCard() {
  const engine = useEngine();
  const s = useEngineSnapshot();
  const clock = useClockState(500);
  const lastKey = useRef('');

  const obsKey = s.observer ? `${s.observer.lat.toFixed(3)},${s.observer.lng.toFixed(3)}` : '';

  useEffect(() => {
    if (!obsKey || s.status !== 'ready') return;
    if (lastKey.current === obsKey) return;
    lastKey.current = obsKey;
    void engine.predictPasses(180);
  }, [engine, obsKey, s.status]);

  if (!s.observer) {
    return (
      <section className="nextpass nextpass-empty">
        <h2 className="nextpass-title">When's the next one overhead?</h2>
        <p className="hint">
          Share your location or click a spot on the globe and you'll get the next pass, the
          direction to face and how high it climbs.
        </p>
      </section>
    );
  }

  const now = clock.timeMs;
  const upcoming = s.passes.filter((p) => p.setTimeMs > now);
  const next = upcoming[0];
  const nextVisible = next && !next.visible ? upcoming.find((p) => p.visible) : undefined;

  if (s.passesStatus === 'loading' && !next) {
    return (
      <section className="nextpass">
        <p className="nextpass-status">
          <span className="spinner" aria-hidden /> Working out passes for your sky…
        </p>
      </section>
    );
  }

  if (!next) {
    return (
      <section className="nextpass">
        <h2 className="nextpass-title">No passes found</h2>
        <p className="hint">
          Nothing matched your filters in the search window. Lower the minimum elevation or
          widen the window in the passes list.
        </p>
      </section>
    );
  }

  const inProgress = next.riseTimeMs <= now;

  return (
    <section className={`nextpass${next.visible ? ' is-visible' : ''}`}>
      <div className="nextpass-body">
        <div className="nextpass-text">
          <p className="nextpass-kicker">{inProgress ? 'Overhead now, sets in' : 'Next pass in'}</p>
          <p className="nextpass-count">
            {formatCountdown(inProgress ? next.setTimeMs : next.riseTimeMs, now)}
          </p>
          <button className="nextpass-name" onClick={() => engine.select(next.noradId)}>
            {next.name}
          </button>
          <dl className="nextpass-facts">
            <dt>Rises</dt>
            <dd>
              {formatClockTime(next.riseTimeMs)}, {compassPoint(next.riseAzimuthDeg)}
            </dd>
            <dt>Peaks</dt>
            <dd>
              {formatDeg(next.peakElevationDeg, 0)} up, {compassPoint(next.peakAzimuthDeg)}
            </dd>
            <dt>Sets</dt>
            <dd>{compassPoint(next.setAzimuthDeg)}, after {formatDuration(next.durationMs)}</dd>
          </dl>
        </div>
        <SkyPlot
          size={132}
          arc={{
            riseAz: next.riseAzimuthDeg,
            peakAz: next.peakAzimuthDeg,
            peakEl: next.peakElevationDeg,
            setAz: next.setAzimuthDeg,
          }}
        />
      </div>

      <p className={`nextpass-visibility${next.visible ? ' yes' : ''}`}>
        {next.visible
          ? 'Sunlit against a dark sky, so you should see it with the naked eye.'
          : nextVisible
            ? `Not visible to the eye. First naked-eye pass: ${nextVisible.name} in ${formatCountdown(
                nextVisible.riseTimeMs,
                now
              )}.`
            : 'Not visible to the eye: either the satellite is in shadow or your sky is too bright.'}
      </p>
    </section>
  );
}
