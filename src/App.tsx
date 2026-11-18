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
import NextPassCard from './components/panels/NextPassCard';

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

type Tab = 'sky' | 'search' | 'display';
const TABS: { id: Tab; label: string }[] = [
  { id: 'sky', label: 'Your sky' },
  { id: 'search', label: 'Search' },
  { id: 'display', label: 'Display' },
];

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
  const [tab, setTab] = useState<Tab>('sky');
  const [helpOpen, setHelpOpen] = useState(false);
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

  // Global shortcuts. Time keys live in TimeControls.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (e.key === 'Escape') {
        if (typing) (target as HTMLElement).blur();
        else if (helpOpen) setHelpOpen(false);
        else engine.select(null);
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 'g') setViewMode('globe');
      else if (k === 'm') setViewMode('map');
      else if (k === 'p') setPanelOpen((o) => !o);
      else if (k === '?') setHelpOpen((o) => !o);
      else if (e.key === '/') {
        e.preventDefault();
        setPanelOpen(true);
        setTab('search');
        requestAnimationFrame(() => document.getElementById('sat-search')?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, helpOpen]);

  return (
    <EngineContext.Provider value={engine}>
      <div className={`app${isMobile ? ' is-mobile' : ''}`}>
        <header className="topbar">
          <div className="brand">
            <svg className="brand-mark" viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <circle cx="12" cy="12" r="4.2" fill="currentColor" opacity="0.9" />
              <ellipse cx="12" cy="12" rx="10.5" ry="4" fill="none" stroke="currentColor" strokeWidth="1.2" transform="rotate(-28 12 12)" opacity="0.55" />
              <circle cx="20.6" cy="7.6" r="1.7" className="brand-sat" />
            </svg>
            <span className="brand-name">Starlink Tracker</span>
            <a
              className="brand-by"
              href="https://github.com/tristedw"
              target="_blank"
              rel="noopener noreferrer"
              title="Made by Tristan Edwards - github.com/tristedw"
            >
              by TristEdw
            </a>
          </div>

          <div className="topbar-actions">
            <div className="segmented view-toggle" role="group" aria-label="View mode">
              <button
                className={viewMode === 'globe' ? 'active' : ''}
                aria-pressed={viewMode === 'globe'}
                onClick={() => setViewMode('globe')}
                title="Globe (G)"
              >
                Globe
              </button>
              <button
                className={viewMode === 'map' ? 'active' : ''}
                aria-pressed={viewMode === 'map'}
                onClick={() => setViewMode('map')}
                title="Flat map (M)"
              >
                Map
              </button>
            </div>

            <button
              className="btn-icon topbar-icon"
              onClick={() => setHelpOpen((o) => !o)}
              aria-expanded={helpOpen}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              ?
            </button>

            <button
              className="btn-icon topbar-icon"
              onClick={() => setPanelOpen((o) => !o)}
              aria-expanded={panelOpen}
              aria-label={panelOpen ? 'Hide side panel' : 'Show side panel'}
              title={panelOpen ? 'Hide panel (P)' : 'Show panel (P)'}
            >
              <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
                <rect x="2.5" y="3.5" width="15" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <rect x="12" y="3.5" width="5.5" height="13" rx="1" fill="currentColor" opacity={panelOpen ? 0.85 : 0.2} />
              </svg>
            </button>
          </div>
        </header>

        <main className="main">
          <div className="canvas-wrap">
            <ErrorBoundary label={viewMode === 'globe' ? 'the 3D globe' : 'the map'}>
              <Suspense
                fallback={
                  <div className="canvas-loading">
                    <span className="spinner" aria-hidden />
                    Loading the {viewMode === 'globe' ? 'globe' : 'map'}…
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

            {helpOpen && (
              <div className="help" role="dialog" aria-label="Keyboard shortcuts">
                <div className="help-head">
                  <h2>Shortcuts</h2>
                  <button className="btn-icon btn-close" onClick={() => setHelpOpen(false)} aria-label="Close">
                    ×
                  </button>
                </div>
                <dl className="help-keys">
                  <dt><kbd>Space</kbd></dt><dd>Pause or play time</dd>
                  <dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>Step 5 minutes (hold Shift for an hour)</dd>
                  <dt><kbd>L</kbd></dt><dd>Back to real time</dd>
                  <dt><kbd>G</kbd> <kbd>M</kbd></dt><dd>Globe or flat map</dd>
                  <dt><kbd>/</kbd></dt><dd>Search for a satellite</dd>
                  <dt><kbd>P</kbd></dt><dd>Show or hide the panel</dd>
                  <dt><kbd>Esc</kbd></dt><dd>Clear the selection</dd>
                </dl>
              </div>
            )}
          </div>

          <aside className={`panel ${panelOpen ? 'open' : 'closed'}`} aria-hidden={!panelOpen}>
            <div className="panel-scroll">
              <StatusPanel />
              <NextPassCard />
              <DetailPanel />

              <div className="tabs" role="tablist" aria-label="Panel sections">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    role="tab"
                    aria-selected={tab === t.id}
                    className={tab === t.id ? 'tab active' : 'tab'}
                    onClick={() => setTab(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div role="tabpanel">
                {tab === 'sky' && (
                  <>
                    <LocationPanel geo={geo} />
                    <NearestPanel />
                    <PassesPanel />
                  </>
                )}
                {tab === 'search' && <SearchPanel />}
                {tab === 'display' && (
                  <SettingsPanel settings={settings} onChange={updateSettings} />
                )}
              </div>

              <footer className="panel-footer">
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
