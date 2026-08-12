"use client";

import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";

// LoadingCircle is a spinning circular progress indicator (muted track +
// primary arc) used in loading states.
export function LoadingCircle({ className }: { className?: string }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-8 animate-spin", className)}
      role="status"
      aria-label="loading"
    >
      <circle cx="16" cy="16" r={r} fill="none" strokeWidth="3.5" className="stroke-muted" />
      <circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        strokeWidth="3.5"
        strokeLinecap="round"
        className="stroke-primary"
        strokeDasharray={c}
        strokeDashoffset={c * 0.65}
        transform="rotate(-90 16 16)"
      />
    </svg>
  );
}

// PageLoader is the full-page loading state (auth gate, page data).
export function PageLoader({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-1 flex-col items-center justify-center gap-3">
      <LoadingCircle className="size-10" />
      <span className="text-sm text-muted-foreground">{label ?? t("loading")}</span>
    </div>
  );
}
