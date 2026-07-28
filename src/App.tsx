/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EngineContext } from './hooks/useEngine';
import { useGeolocation } from './hooks/useGeolocation';
import { useIsMobile } from './hooks/useMediaQuery';
import { TrackerEngine } from './lib/store/engine';
import type { GeoLocation, ViewMode } from './types';
import ErrorBoundary from './components/layout/ErrorBoundary';
import Legend from './components/controls/Legend';
import TimeControls from './components/controls/TimeControls';
import SettingsPanel, { type ViewSettings } from './components/controls/SettingsPanel';
import StatusPanel from './components/panels/StatusPanel';
import LocationPanel from './components/panels/LocationPanel';
import SearchPanel from './components/panels/SearchPanel';
import DetailPanel from './components/panels/DetailPanel';
import NearestPanel from './components/panels/NearestPanel';
import PassesPanel from './components/panels/PassesPanel';

// Three.js and MapLibre are the two heavy dependencies. Split them so you only
// download the renderer you're actually looking at.
const GlobeView = lazy(() => import('./components/globe/GlobeView'));
const MapView = lazy(() => import('./components/map/MapView'));

const DEFAULT_SETTINGS: ViewSettings = {
  sizeScale: 1,
  stride: 1,
  dimEclipsed: true,
  sunlitOnly: false,
  showOrbit: true,
  showFootprint: true,
};

const SETTINGS_KEY = 'starlink-tracker:settings';

export default function App() {
  // One engine for the life of the app. It owns the worker pool, so it
  // lives in a ref rather than state, so StrictMode's double-invoked effects
  // don't spin up a second set of workers.
  const engineRef = useRef<TrackerEngine | null>(null);
  if (engineRef.current === null) engineRef.current = new TrackerEngine();
  const engine = engineRef.current;

  const [viewMode, setViewMode] = useState<ViewMode>('globe');
  const [panelOpen, setPanelOpen] = useState(true);
  const [settings, setSettings] = useState<ViewSettings>(loadSettings);
  const geo = useGeolocation();
  const isMobile = useIsMobile();

  useEffect(() => {
    void engine.start();
    return () => engine.stop();
  }, [engine]);

  useEffect(() => {
    engine.setObserver(geo.location);
  }, [engine, geo.location]);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable, so settings just won't persist */
    }
  }, [settings]);

  // Panels start collapsed on phones so the globe gets the whole screen.
  useEffect(() => {
    setPanelOpen(!isMobile);
  }, [isMobile]);

  const updateSettings = useCallback((patch: Partial<ViewSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const handlePickLocation = useCallback((loc: GeoLocation) => geo.setManual(loc), [geo]);

  const cloudStyle = useMemo(
    () => ({
      sizeScale: settings.sizeScale,
      stride: settings.stride,
      dimEclipsed: settings.dimEclipsed,
      sunlitOnly: settings.sunlitOnly,
    }),
    [settings.sizeScale, settings.stride, settings.dimEclipsed, settings.sunlitOnly]
  );

  const viewProps = {
    observer: geo.location,
    style: cloudStyle,
    showOrbit: settings.showOrbit,
    showFootprint: settings.showFootprint,
    onPickLocation: handlePickLocation,
  };

  return (
    <EngineContext.Provider value={engine}>
      <div className={`app${isMobile ? ' is-mobile' : ''}`}>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden />
            <span className="brand-name">Starlink Tracker</span>
            <a
              className="brand-by"
              href="https://github.com/tristedw"
              target="_blank"
              rel="noopener noreferrer"
              title="Made by Tristan Edwards - github.com/tristedw"
            >
              By TristEdw
            </a>
          </div>

          <div className="segmented view-toggle" role="group" aria-label="View mode">
            <button
              className={viewMode === 'globe' ? 'active' : ''}
              onClick={() => setViewMode('globe')}
            >
              Globe
            </button>
            <button
              className={viewMode === 'map' ? 'active' : ''}
              onClick={() => setViewMode('map')}
            >
              Map
            </button>
          </div>

          <button
            className="btn btn-small panel-toggle"
            onClick={() => setPanelOpen((o) => !o)}
            aria-expanded={panelOpen}
          >
            {panelOpen ? 'Hide panel' : 'Show panel'}
          </button>
        </header>

        <main className="main">
          <div className="canvas-wrap">
            <ErrorBoundary label={viewMode === 'globe' ? 'the 3D globe' : 'the map'}>
              <Suspense
                fallback={
                  <div className="canvas-loading">
                    <span className="spinner" aria-hidden />
                    Loading {viewMode === 'globe' ? 'globe' : 'map'}…
                  </div>
                }
              >
                {viewMode === 'globe' ? <GlobeView {...viewProps} /> : <MapView {...viewProps} />}
              </Suspense>
            </ErrorBoundary>

            <Legend />
            <div className="time-dock">
              <TimeControls />
            </div>
          </div>

          <aside className={`panel ${panelOpen ? 'open' : 'closed'}`} aria-hidden={!panelOpen}>
            <div className="panel-scroll">
              <StatusPanel />
              <LocationPanel geo={geo} />
              <DetailPanel />
              <NearestPanel />
              <PassesPanel />
              <SearchPanel />
              <SettingsPanel settings={settings} onChange={updateSettings} />
              <footer className="panel-footer muted small">
                Orbital elements from{' '}
                <a href="https://celestrak.org" target="_blank" rel="noreferrer">
                  Celestrak
                </a>
                , propagated with SGP4. Positions are predictions, not measurements.
              </footer>
            </div>
          </aside>
        </main>
      </div>
    </EngineContext.Provider>
  );
}

function loadSettings(): ViewSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ViewSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
