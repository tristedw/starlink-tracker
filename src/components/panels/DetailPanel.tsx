/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { EPOCH_WARN_AGE_MS } from '../../lib/config';
import {
  formatAge,
  formatAzimuth,
  formatCoords,
  formatDeg,
  formatKm,
  formatSpeed,
} from '../../lib/format';
import { useEngine, useEngineSnapshot } from '../../hooks/useEngine';
import IlluminationBadge from './IlluminationBadge';

export default function DetailPanel() {
  const engine = useEngine();
  const { selectedDetail: d } = useEngineSnapshot();
  if (!d) return null;

  const staleElements = Date.now() - d.epochMs > EPOCH_WARN_AGE_MS;

  return (
    <section className="panel-section detail-panel">
      <div className="detail-head">
        <h2>{d.name}</h2>
        <button
          className="btn-icon"
          onClick={() => engine.select(null)}
          aria-label="Clear selection"
        >
          ×
        </button>
      </div>

      <IlluminationBadge state={d.illumination} />

      <dl className="detail-grid">
        <dt>NORAD ID</dt>
        <dd className="mono">{d.noradId}</dd>

        <dt>Position</dt>
        <dd className="mono">{formatCoords(d.lat, d.lng)}</dd>

        <dt>Altitude</dt>
        <dd>{formatKm(d.altKm, 1)}</dd>

        <dt>Speed</dt>
        <dd>{formatSpeed(d.speedKmS)}</dd>

        <dt>Inclination</dt>
        <dd>{formatDeg(d.inclinationDeg, 2)}</dd>

        <dt>Orbital period</dt>
        <dd>{d.periodMinutes.toFixed(1)} min</dd>

        {d.block && (
          <>
            <dt>Batch</dt>
            <dd>~{d.block}</dd>
          </>
        )}

        <dt>Element age</dt>
        <dd className={staleElements ? 'warn' : undefined}>{formatAge(d.epochMs)}</dd>

        {d.look && (
          <>
            <dt>Direction</dt>
            <dd>{formatAzimuth(d.look.azimuthDeg)}</dd>

            <dt>Elevation</dt>
            <dd>
              {Number.isFinite(d.look.elevationDeg) ? (
                d.look.elevationDeg > 0 ? (
                  <span className="good">{formatDeg(d.look.elevationDeg)} above horizon</span>
                ) : (
                  <span className="muted">{formatDeg(d.look.elevationDeg)}, below horizon</span>
                )
              ) : (
                'n/a'
              )}
            </dd>

            <dt>Slant range</dt>
            <dd>{formatKm(d.look.rangeKm, 0)}</dd>

            <dt>Ground distance</dt>
            <dd>{formatKm(d.look.groundDistanceKm, 0)}</dd>
          </>
        )}
      </dl>
    </section>
  );
}
