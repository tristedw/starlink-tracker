/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { useDeferredValue, useMemo, useState } from 'react';
import { useEngine, useEngineSnapshot } from '../../hooks/useEngine';

/**
 * Name and NORAD-ID search.
 *
 * Runs against the static satellite index, not the live position frame, so
 * results don't churn as things move and the cost doesn't scale with tick rate.
 */
export default function SearchPanel() {
  const engine = useEngine();
  const snapshot = useEngineSnapshot();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);

  const results = useMemo(
    () => engine.search(deferred, 25),
    // `satelliteCount` participates so results appear once loading finishes.
    [engine, deferred, snapshot.satelliteCount]
  );

  return (
    <section className="panel-section">
      <h2>Search</h2>
      <input
        className="search-input"
        type="search"
        inputMode="search"
        placeholder="Name or NORAD ID…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search satellites by name or NORAD ID"
      />
      {deferred.trim() !== '' && results.length === 0 && (
        <p className="hint">No matches.</p>
      )}
      {results.length > 0 && (
        <ul className="list">
          {results.map((info) => (
            <li key={info.noradId}>
              <button
                className={
                  info.noradId === snapshot.selectedId ? 'list-item selected' : 'list-item'
                }
                onClick={() => engine.select(info.noradId)}
              >
                <span className="list-item-title">{info.name}</span>
                <span className="muted small">
                  #{info.noradId} · {info.inclinationDeg.toFixed(1)}° incl
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
