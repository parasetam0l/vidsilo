"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";

// Default range: the trailing 14 days.
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 13 * 86400_000).toISOString().slice(0, 10);
  return { from, to };
}

// AnalyticsRange: the admin header's date range for the Analytics page.
// The range lives in the URL (?from=&to=) so the page, the header and any
// shared link all agree.
export function AnalyticsRange() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  // First visit: materialize the default range into the URL.
  React.useEffect(() => {
    if (from && to) return;
    const d = defaultRange();
    router.replace(`/admin/analytics?from=${d.from}&to=${d.to}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (nextFrom: string, nextTo: string) => {
    router.push(`/admin/analytics?from=${nextFrom}&to=${nextTo}`);
  };

  return (
    <div className="ml-auto flex items-center gap-1.5">
      <Input
        type="date"
        value={from}
        max={to || undefined}
        onChange={(e) => go(e.target.value, to)}
        aria-label="From"
        className="h-8 w-auto rounded-lg text-xs"
      />
      <span className="text-xs text-muted-foreground">–</span>
      <Input
        type="date"
        value={to}
        min={from || undefined}
        onChange={(e) => go(from, e.target.value)}
        aria-label="To"
        className="h-8 w-auto rounded-lg text-xs"
      />
    </div>
  );
}
