"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

// Shared empty-state block used by tables and panels: muted icon, optional
// title/copy and an optional action slot.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title?: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Icon className="size-7 text-muted-foreground/50" />
      {title ? <p className="text-sm font-medium">{title}</p> : null}
      {description ? (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
