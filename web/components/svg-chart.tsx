"use client";

import * as React from "react";

// Zero-dependency SVG line chart for the analytics tabs, with hover tooltips.
export function SvgChart({
  points,
  height = 160,
}: {
  points: { label: string; value: number }[];
  height?: number;
}) {
  const [hover, setHover] = React.useState<number | null>(null);
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

  const hx = hover != null ? x(hover) : 0;
  const hy = hover != null ? y(points[hover].value) : 0;
  const tooltipLeft = Math.min(88, Math.max(12, (hx / width) * 100));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label="line chart"
        onMouseLeave={() => setHover(null)}
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
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.value)}
            r={12}
            fill="transparent"
            className="cursor-pointer outline-none"
            tabIndex={0}
            aria-label={`${p.label}: ${p.value}`}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        ))}
        {hover != null ? (
          <g pointerEvents="none">
            <line
              x1={hx}
              x2={hx}
              y1={pad}
              y2={pad + innerH}
              stroke="currentColor"
              strokeOpacity={0.25}
              strokeDasharray="3 3"
            />
            <circle cx={hx} cy={hy} r={4} fill="currentColor" stroke="var(--background)" strokeWidth={2} />
          </g>
        ) : null}
        <text x={pad} y={height - 4} fontSize={10} fill="currentColor" opacity={0.6}>
          {points[0].label}
        </text>
        <text x={width - pad} y={height - 4} fontSize={10} fill="currentColor" opacity={0.6} textAnchor="end">
          {points[points.length - 1].label}
        </text>
      </svg>
      {hover != null ? (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border bg-popover px-2 py-1 text-xs font-medium shadow-md"
          style={{ left: `${tooltipLeft}%`, top: `${(hy / height) * 100}%` }}
        >
          <span className="opacity-70">{points[hover].label}</span>
          <span className="ml-1.5 tabular-nums">{points[hover].value}</span>
        </div>
      ) : null}
    </div>
  );
}
