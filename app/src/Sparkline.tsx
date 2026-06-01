// Tiny dependency-free SVG sparkline for score-over-time. Values are
// 0-100; renders a gradient area + line and a dashed average marker.

type Props = {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
};

export default function Sparkline({ values, width = 280, height = 48, color = '#00E5FF' }: Props) {
  if (values.length < 2) return null;
  const max = 100;
  const min = 0;
  const pad = 3;
  const w = width;
  const h = height;
  const n = values.length;
  const x = (i: number) => pad + (i / (n - 1)) * (w - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / (max - min)) * (h - pad * 2);

  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${(h - pad).toFixed(1)} ${pts} ${x(n - 1).toFixed(1)},${(h - pad).toFixed(1)}`;
  const avg = values.reduce((a, b) => a + b, 0) / n;
  const avgY = y(avg);
  const gid = 'spark-' + color.replace('#', '');

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <line x1={pad} y1={avgY} x2={w - pad} y2={avgY} stroke={color} strokeOpacity="0.3" strokeDasharray="3 3" strokeWidth="1" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* last point dot */}
      <circle cx={x(n - 1)} cy={y(values[n - 1])} r="2.5" fill={color} />
    </svg>
  );
}
