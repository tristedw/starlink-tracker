/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { formatCoords } from '../../lib/format';
import type { GeolocationApi } from '../../hooks/useGeolocation';

interface Props {
  geo: GeolocationApi;
}

export default function LocationPanel({ geo }: Props) {
  const { status, location, errorMessage, watching } = geo;

  return (
    <section className="panel-section">
      <h2>Your location</h2>

      {!location && (
        <>
          <button
            className="btn btn-primary"
            onClick={geo.request}
            disabled={status === 'requesting'}
          >
            {status === 'requesting' ? 'Requesting…' : 'Use my location'}
          </button>
          <p className="hint">
            Or click anywhere on the {''}
            globe or map to drop a pin instead, no permission needed.
          </p>
        </>
      )}

      {location && (
        <>
          <div className="location-info">
            <span className="mono">{formatCoords(location.lat, location.lng)}</span>
            {location.accuracyM !== undefined && status === 'granted' && (
              <span className="muted small">±{Math.round(location.accuracyM)} m</span>
            )}
            {status === 'manual' && <span className="badge">pinned</span>}
          </div>
          <div className="button-row">
            <button className="btn btn-small" onClick={geo.toggleWatch}>
              {watching ? 'Stop following' : 'Follow me'}
            </button>
            <button className="btn btn-small btn-ghost" onClick={geo.clear}>
              Clear
            </button>
          </div>
        </>
      )}

      {status === 'denied' && (
        <p className="hint warn">
          Location permission denied. You can still click the map to set a position manually.
        </p>
      )}
      {status === 'unsupported' && (
        <p className="hint warn">Geolocation isn't available in this browser.</p>
      )}
      {status === 'error' && errorMessage && (
        <p className="hint warn">Couldn't get location: {errorMessage}</p>
      )}
    </section>
  );
}
