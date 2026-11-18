/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
const ITEMS = [
  { colour: '#f3c06b', label: 'In sunlight' },
  { colour: '#a8794f', label: 'Penumbra' },
  { colour: '#4a5d80', label: "In Earth's shadow" },
  { colour: '#7fd1c1', label: 'Near you' },
  { colour: '#ff5d73', label: 'Selected' },
];

export default function Legend() {
  return (
    <div className="legend" aria-label="Map legend">
      {ITEMS.map((i) => (
        <span key={i.label} className="legend-item">
          <span className="legend-swatch" style={{ background: i.colour }} aria-hidden />
          {i.label}
        </span>
      ))}
    </div>
  );
}
