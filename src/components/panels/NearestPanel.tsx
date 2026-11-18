/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { compassPoint, formatDeg, formatKm } from '../../lib/format';
import { useEngine, useEngineSnapshot } from '../../hooks/useEngine';
import SkyPlot from './SkyPlot';

/**
 * What's closest right now, split by whether it's actually above your horizon.
 *
 * "Nearest" on its own is misleading: the closest thing by ground distance is
 * often still under the horizon and no use to you. Hence the grouping rather
 * than one flat ranking.
 */
export default function NearestPanel() {
  const engine = useEngine();
  const { nearest, selectedId, observer } = useEngineSnapshot();
  if (!observer) return null;

  const overhead = nearest.filter((n) => n.elevationDeg > 0);
  const below = nearest.filter((n) => n.elevationDeg <= 0);
  const litCount = overhead.filter((n) => n.illumination === 'sunlit').length;

  return (
    <section className="panel-section">
      <div className="section-head">
        <h2>Above you now</h2>
        {overhead.length > 0 && (
          <span className="section-meta">
            {overhead.length} up, {litCount} in sunlight
          </span>
        )}
      </div>

      {nearest.length === 0 && <p className="hint">Waiting for the first position update…</p>}

      {nearest.length > 0 && overhead.length === 0 && (
        <p className="hint">
          Nothing above your horizon this second. Coverage moves fast, so check the passes
          list.
        </p>
      )}

      {overhead.length > 0 && (
        <>
          <div className="sky-wrap">
            <SkyPlot
              dots={overhead.map((n) => ({
                id: n.noradId,
                az: n.azimuthDeg,
                el: n.elevationDeg,
                lit: n.illumination === 'sunlit',
                selected: n.noradId === selectedId,
              }))}
              onPick={(id) => engine.select(id)}
            />
          </div>
          <ul className="list">
            {overhead.map((n) => (
              <li key={n.noradId}>
                <button
                  className={n.noradId === selectedId ? 'row selected' : 'row'}
                  onClick={() => engine.select(n.noradId)}
                >
                  <span className={`row-dot${n.illumination === 'sunlit' ? ' lit' : ''}`} aria-hidden />
                  <span className="row-name">{n.name}</span>
                  <span className="row-num">{formatDeg(n.elevationDeg, 0)}</span>
                  <span className="row-num row-dir">{compassPoint(n.azimuthDeg)}</span>
                  <span className="row-num row-dim">{formatKm(n.rangeKm, 0)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {below.length > 0 && (
        <details className="disclosure">
          <summary>{below.length} close by but under the horizon</summary>
          <ul className="list">
            {below.slice(0, 10).map((n) => (
              <li key={n.noradId}>
                <button
                  className={n.noradId === selectedId ? 'row selected' : 'row'}
                  onClick={() => engine.select(n.noradId)}
                >
                  <span className="row-dot" aria-hidden />
                  <span className="row-name">{n.name}</span>
                  <span className="row-num row-dim">{formatDeg(n.elevationDeg, 0)}</span>
                  <span className="row-num" />
                  <span className="row-num row-dim">{formatKm(n.groundDistanceKm, 0)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
