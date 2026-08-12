"use client";

import { cn } from "@/lib/utils";

// SummaryStrip is the shared stat-pill row used across admin list pages so
// every page renders the same information hierarchy.
export function SummaryStrip({
  items,
  className,
}: {
  items: { label: string; value: string | number; hint?: string }[];
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {items.map((it) => (
        <span
          key={it.label}
          title={it.hint}
          className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1 text-xs text-muted-foreground"
        >
          <span>{it.label}</span>
          <span className="font-semibold text-foreground">{it.value}</span>
        </span>
      ))}
    </div>
  );
}
