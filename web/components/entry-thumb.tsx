"use client";

import { FilmIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Small cover thumbnail for table rows: the poster when available, an
// icon placeholder (same size) until the probe job generates one.
export function EntryThumb({
  posterKey,
  updatedAt,
  className,
}: {
  posterKey?: string;
  updatedAt?: string;
  className?: string;
}) {
  if (posterKey) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/media/${posterKey}${updatedAt ? `?v=${encodeURIComponent(updatedAt)}` : ""}`}
        alt=""
        className={cn(
          "h-9 w-14 shrink-0 rounded-md border object-cover",
          className,
        )}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex h-9 w-14 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground",
        className,
      )}
    >
      <FilmIcon className="size-4" />
    </div>
  );
}
