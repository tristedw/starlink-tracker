/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { formatAzimuth, formatDeg, formatKm } from '../../lib/format';
import { useEngine, useEngineSnapshot } from '../../hooks/useEngine';

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

  return (
    <section className="panel-section">
      <h2>
        Above you now
        {overhead.length > 0 && <span className="count-pill">{overhead.length}</span>}
      </h2>

      {nearest.length === 0 && <p className="hint">Waiting for the first position update…</p>}

      {nearest.length > 0 && overhead.length === 0 && (
        <p className="hint">
          Nothing above your horizon this second. Starlink coverage moves fast, so check
          upcoming passes below.
        </p>
      )}

      {overhead.length > 0 && (
        <ul className="list">
          {overhead.map((n) => (
            <li key={n.noradId}>
              <button
                className={n.noradId === selectedId ? 'list-item selected' : 'list-item'}
                onClick={() => engine.select(n.noradId)}
              >
                <span className="list-item-title">
                  {n.name}
                  {n.illumination === 'sunlit' && (
                    <span className="tag tag-lit" title="Sunlit, potentially visible">
                      lit
                    </span>
                  )}
                </span>
                <span className="muted small">
                  {formatDeg(n.elevationDeg, 0)} up · {formatAzimuth(n.azimuthDeg)} ·{' '}
                  {formatKm(n.rangeKm, 0)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {below.length > 0 && (
        <details className="disclosure">
          <summary>{below.length} nearby but below the horizon</summary>
          <ul className="list">
            {below.slice(0, 10).map((n) => (
              <li key={n.noradId}>
                <button
                  className={n.noradId === selectedId ? 'list-item selected' : 'list-item'}
                  onClick={() => engine.select(n.noradId)}
                >
                  <span className="list-item-title">{n.name}</span>
                  <span className="muted small">
                    {formatKm(n.groundDistanceKm, 0)} away · {formatDeg(n.elevationDeg, 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
