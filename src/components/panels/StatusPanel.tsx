/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { EPOCH_WARN_AGE_MS } from '../../lib/config';
import { formatAge } from '../../lib/format';
import { useEngineSnapshot } from '../../hooks/useEngine';

/**
 * Where the data came from and how old it is. SGP4 error grows with element
 * age, so this shouldn't be buried. Stale data gets a warning.
 */
export default function StatusPanel() {
  const s = useEngineSnapshot();

  if (s.status === 'loading') {
    return (
      <div className="status">
        <span className="spinner" aria-hidden />
        <span>Loading orbital elements…</span>
      </div>
    );
  }

  if (s.status === 'error') {
    return (
      <div className="status status-error" role="alert">
        <strong>Couldn't load satellite data.</strong>
        <span>{s.error}</span>
        <span>Reload the page to try again.</span>
      </div>
    );
  }

  const stale = s.dataFetchedAt !== null && Date.now() - s.dataFetchedAt > EPOCH_WARN_AGE_MS;

  return (
    <div className="status">
      <span className="dot-live" aria-hidden />
      <span>
        <strong>{s.satelliteCount.toLocaleString()}</strong> satellites, data{' '}
        {s.dataFetchedAt ? formatAge(s.dataFetchedAt) : 'of unknown age'}
        {s.dataSource === 'cache' && ' (cached)'}
      </span>
      {stale && (
        <p className="hint warn">
          These elements are over three days old, so positions may be off by several km.
        </p>
      )}
      {s.warning && <p className="hint warn">{s.warning}</p>}
    </div>
  );
}
