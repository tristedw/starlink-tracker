/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import type { PointCloudStyle } from '../globe/SatellitePointCloud';

export interface ViewSettings extends PointCloudStyle {
  showOrbit: boolean;
  showFootprint: boolean;
}

interface Props {
  settings: ViewSettings;
  onChange: (patch: Partial<ViewSettings>) => void;
}

const DENSITY = [
  { label: 'All', stride: 1 },
  { label: '½', stride: 2 },
  { label: '¼', stride: 4 },
];

export default function SettingsPanel({ settings, onChange }: Props) {
  return (
    <section className="panel-section">
      <h2>Display</h2>

      <label className="field">
        <span className="muted small">
          Density
          <span className="muted">: reduce if the view stutters on your device</span>
        </span>
        <div className="segmented">
          {DENSITY.map((d) => (
            <button
              key={d.stride}
              className={settings.stride === d.stride ? 'active' : ''}
              onClick={() => onChange({ stride: d.stride })}
            >
              {d.label}
            </button>
          ))}
        </div>
      </label>

      <label className="field">
        <span className="muted small">Satellite size</span>
        <input
          type="range"
          min={0.5}
          max={2.5}
          step={0.1}
          value={settings.sizeScale}
          onChange={(e) => onChange({ sizeScale: Number(e.target.value) })}
        />
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.dimEclipsed}
          onChange={(e) => onChange({ dimEclipsed: e.target.checked })}
        />
        <span>Dim satellites in Earth's shadow</span>
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.sunlitOnly}
          onChange={(e) => onChange({ sunlitOnly: e.target.checked })}
        />
        <span>
          Show only sunlit satellites
          <span className="muted small">: the ones that could be seen</span>
        </span>
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.showOrbit}
          onChange={(e) => onChange({ showOrbit: e.target.checked })}
        />
        <span>Orbit path & ground track for selection</span>
      </label>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={settings.showFootprint}
          onChange={(e) => onChange({ showFootprint: e.target.checked })}
        />
        <span>Coverage footprint for selection</span>
      </label>
    </section>
  );
}
