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
      <h2>Find a satellite</h2>
      <input
        id="sat-search"
        className="search-input"
        type="search"
        inputMode="search"
        placeholder="STARLINK-1130 or 44713"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search satellites by name or NORAD ID"
      />
      {deferred.trim() !== '' && results.length === 0 && (
        <p className="hint">Nothing matches "{deferred.trim()}". Try part of the name or the 5 digit NORAD number.</p>
      )}
      {deferred.trim() === '' && (
        <p className="hint">Type a name or NORAD number. Tip: press / anywhere to jump here.</p>
      )}
      {results.length > 0 && (
        <ul className="list">
          {results.map((info) => (
            <li key={info.noradId}>
              <button
                className={info.noradId === snapshot.selectedId ? 'row row-4 selected' : 'row row-4'}
                onClick={() => engine.select(info.noradId)}
              >
                <span className="row-dot" aria-hidden />
                <span className="row-name">{info.name}</span>
                <span className="row-num row-dim">{info.noradId}</span>
                <span className="row-num row-dim">{info.inclinationDeg.toFixed(1)}°</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
