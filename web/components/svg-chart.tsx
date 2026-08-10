// Zero-dependency SVG line chart for the analytics tab.
export function SvgChart({
  points,
  height = 160,
}: {
  points: { label: string; value: number }[];
  height?: number;
}) {
  const width = 640;
  const pad = 24;
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>;
  }
  const max = Math.max(...points.map((p) => p.value), 1);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const x = (i: number) =>
    pad + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad + innerH - (v / max) * innerH;

  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");
  const area = `${pad},${pad + innerH} ${line} ${x(points.length - 1)},${pad + innerH}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="line chart"
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          x1={pad}
          x2={width - pad}
          y1={pad + innerH - f * innerH}
          y2={pad + innerH - f * innerH}
          stroke="currentColor"
          strokeOpacity={0.08}
        />
      ))}
      <polygon points={area} fill="currentColor" fillOpacity={0.08} />
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={2.5} fill="currentColor" />
      ))}
      <text x={pad} y={height - 4} fontSize={10} fill="currentColor" opacity={0.6}>
        {points[0].label}
      </text>
      <text x={width - pad} y={height - 4} fontSize={10} fill="currentColor" opacity={0.6} textAnchor="end">
        {points[points.length - 1].label}
      </text>
    </svg>
  );
}
