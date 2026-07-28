/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { EPOCH_WARN_AGE_MS } from '../../lib/config';
import { formatAge } from '../../lib/format';
import { useEngineSnapshot } from '../../hooks/useEngine';

/**
 * Where the data came from and how old it is, up front. SGP4 error grows with
 * element age, so this shouldn't be buried. Stale data gets a warning.
 */
export default function StatusPanel() {
  const s = useEngineSnapshot();

  if (s.status === 'loading') {
    return (
      <div className="panel-section status-row">
        <span className="spinner" aria-hidden />
        <span>Loading constellation…</span>
      </div>
    );
  }

  if (s.status === 'error') {
    return (
      <div className="panel-section status-row error" role="alert">
        <strong>Couldn't load satellite data.</strong>
        <span className="muted">{s.error}</span>
      </div>
    );
  }

  const stale = s.dataFetchedAt !== null && Date.now() - s.dataFetchedAt > EPOCH_WARN_AGE_MS;

  return (
    <div className="panel-section status-row">
      <div className="status-line">
        <span className="dot dot-live" aria-hidden />
        <span>
          Tracking <strong>{s.satelliteCount.toLocaleString()}</strong> satellites
        </span>
      </div>
      <div className="muted small">
        Elements {s.dataFetchedAt ? formatAge(s.dataFetchedAt) : 'unknown'}
        {s.dataSource === 'cache' && ' · from local cache'}
        {' · '}
        {s.shardCount} propagation {s.shardCount === 1 ? 'worker' : 'workers'}
        {s.tickHz > 0 && ` · ${s.tickHz.toFixed(1)} Hz`}
      </div>
      {stale && (
        <p className="hint warn">
          These elements are more than three days old, so positions may be off by several
          kilometres.
        </p>
      )}
      {s.warning && <p className="hint warn">{s.warning}</p>}
    </div>
  );
}
