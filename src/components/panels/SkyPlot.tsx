/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */

/**
 * Polar sky chart: horizon on the outer ring, straight up in the middle,
 * north at the top. Same layout as a planisphere, so "look north-east, about
 * halfway up" reads straight off it.
 */

export interface SkyDot {
  id: number;
  az: number;
  el: number;
  lit?: boolean;
  selected?: boolean;
}

export interface SkyArc {
  riseAz: number;
  peakAz: number;
  peakEl: number;
  setAz: number;
}

interface Props {
  dots?: SkyDot[];
  arc?: SkyArc;
  size?: number;
  onPick?: (id: number) => void;
}

const R = 46;

function project(az: number, el: number): [number, number] {
  const r = (R * (90 - Math.max(0, Math.min(90, el)))) / 90;
  const a = (az * Math.PI) / 180;
  return [50 + r * Math.sin(a), 50 - r * Math.cos(a)];
}

export default function SkyPlot({ dots = [], arc, size = 168, onPick }: Props) {
  let arcPath: string | null = null;
  let rise: [number, number] | null = null;
  let set: [number, number] | null = null;
  let peak: [number, number] | null = null;

  if (arc) {
    rise = project(arc.riseAz, 0);
    set = project(arc.setAz, 0);
    peak = project(arc.peakAz, arc.peakEl);
    // Control point chosen so the curve passes through the peak at t = 0.5.
    const cx = 2 * peak[0] - (rise[0] + set[0]) / 2;
    const cy = 2 * peak[1] - (rise[1] + set[1]) / 2;
    arcPath = `M${rise[0]},${rise[1]} Q${cx},${cy} ${set[0]},${set[1]}`;
  }

  return (
    <svg
      className="skyplot"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={arc ? 'Sky chart of the pass path' : 'Sky chart of satellites above you'}
    >
      <circle cx="50" cy="50" r={R} className="sky-horizon" />
      <circle cx="50" cy="50" r={(R * 60) / 90} className="sky-ring" />
      <circle cx="50" cy="50" r={(R * 30) / 90} className="sky-ring" />
      <line x1="50" y1={50 - R} x2="50" y2={50 + R} className="sky-ring" />
      <line x1={50 - R} y1="50" x2={50 + R} y2="50" className="sky-ring" />

      <text x="50" y="2.6" className="sky-cardinal sky-north">N</text>
      <text x="98.6" y="51.4" className="sky-cardinal">E</text>
      <text x="50" y="99.8" className="sky-cardinal">S</text>
      <text x="1.4" y="51.4" className="sky-cardinal">W</text>

      {arcPath && rise && set && peak && (
        <g className="sky-arc">
          <path d={arcPath} />
          <circle cx={rise[0]} cy={rise[1]} r="2.2" className="sky-rise" />
          <circle cx={peak[0]} cy={peak[1]} r="1.6" className="sky-peak" />
          <circle cx={set[0]} cy={set[1]} r="2.2" className="sky-set" />
        </g>
      )}

      {dots.map((d) => {
        const [x, y] = project(d.az, d.el);
        const cls = `sky-dot${d.lit ? ' lit' : ''}${d.selected ? ' selected' : ''}`;
        return (
          <circle
            key={d.id}
            cx={x}
            cy={y}
            r={d.selected ? 2.8 : 2}
            className={cls}
            onClick={onPick ? () => onPick(d.id) : undefined}
          />
        );
      })}
    </svg>
  );
}
