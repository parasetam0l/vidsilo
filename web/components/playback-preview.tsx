"use client";

import * as React from "react";
import { PlayIcon, VideoIcon, XIcon } from "lucide-react";

import { api, type PlayInfo } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { VODPlayer } from "@/components/vod-player";
import { formatDuration } from "@/lib/format";

// Playback preview shared by the entry metadata tab, the embed tab and the
// embed dialog: shows the poster, expands into the player when play is
// clicked, and collapses back to the poster via the close button.
export function PlaybackPreview({
  publicId,
  posterKey,
  updatedAt,
  durationMs,
  maxH = "max-h-60",
}: {
  publicId: string;
  posterKey?: string;
  updatedAt: string;
  durationMs: number | null;
  maxH?: string;
}) {
  const t = useT();
  const toast = useToast();
  const [preview, setPreview] = React.useState<PlayInfo | null>(null);

  if (preview) {
    return (
      <div className="group relative overflow-hidden rounded-2xl border bg-black/80 shadow-md">
        <VODPlayer info={preview} publicId={publicId} autoplay />
        <button
          type="button"
          onClick={() => setPreview(null)}
          aria-label={t("close")}
          className="absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-black/60 text-white/90 opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
        >
          <XIcon className="size-4" />
        </button>
      </div>
    );
  }

  if (!posterKey) {
    return (
      <div
        className={`grid aspect-video w-full ${maxH} place-items-center rounded-2xl border border-border/60 bg-muted/40`}
      >
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <VideoIcon className="size-8" />
          <span className="text-xs font-medium">{t("previewUnavailable")}</span>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="group relative block w-full overflow-hidden rounded-2xl border bg-black/80 shadow-md text-left"
      onClick={() => {
        api<PlayInfo>(`/play/${publicId}/playinfo.json`)
          .then((info) => setPreview(info.status === "ready" ? info : null))
          .catch((e) => toast.error(e instanceof Error ? e.message : t("error")));
      }}
      aria-label={t("entryWatch")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/media/${posterKey}?v=${encodeURIComponent(updatedAt)}`}
        alt="poster"
        className={`aspect-video w-full ${maxH} object-contain mx-auto transition-transform duration-300 group-hover:scale-102`}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-4">
        {durationMs ? (
          <span className="text-xs font-medium text-white/90 bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10">
            {formatDuration(durationMs)}
          </span>
        ) : null}
      </div>
      <div className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/30">
        <span className="grid size-14 place-items-center rounded-full bg-white/90 text-black opacity-0 shadow-lg transition-all group-hover:opacity-100">
          <PlayIcon className="ml-0.5 size-6 fill-current" />
        </span>
      </div>
    </button>
  );
}
