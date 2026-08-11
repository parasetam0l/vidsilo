"use client";

import * as React from "react";
import { Loader2Icon, VideoIcon } from "lucide-react";

import { api, type PlayInfo } from "@/lib/api";
import { useT } from "@/lib/i18n";

// Renders the /embed iframe preview, or a gray "Preview Not Available"
// placeholder when the entry isn't watchable yet.
export function EmbedPreview({
  publicId,
  maxH = "max-h-60",
}: {
  publicId: string;
  maxH?: string;
}) {
  const t = useT();
  const [ready, setReady] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let alive = true;
    api<PlayInfo>(`/play/${publicId}/playinfo.json`)
      .then((info) => {
        if (alive) setReady(info.status === "ready");
      })
      .catch(() => {
        if (alive) setReady(false);
      });
    return () => {
      alive = false;
    };
  }, [publicId]);

  return (
    <div
      className={`relative aspect-video ${maxH} w-full shrink-0 overflow-hidden rounded-2xl border border-border/60 bg-muted/40`}
    >
      {ready === true ? (
        <iframe
          src={`/embed/${publicId}`}
          className="h-full w-full border-0"
          allowFullScreen
          title="Video preview"
        />
      ) : ready === null ? (
        <div className="grid h-full w-full place-items-center">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <VideoIcon className="size-8" />
            <span className="text-xs font-medium">{t("previewUnavailable")}</span>
          </div>
        </div>
      )}
    </div>
  );
}
