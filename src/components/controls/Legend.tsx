/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
const ITEMS = [
  { colour: '#5ad1ff', label: 'Sunlit' },
  { colour: '#3f9fc4', label: 'Penumbra' },
  { colour: '#2c4b63', label: "Earth's shadow" },
  { colour: '#ffd23f', label: 'Near you' },
  { colour: '#ff6b5c', label: 'Selected' },
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
