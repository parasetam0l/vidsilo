"use client";

import * as React from "react";

import { api, type PlayInfo } from "@/lib/api";
import { VODPlayer } from "@/components/vod-player";

function uuidFromPath(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export default function EmbedPage() {
  const [uuid] = React.useState(uuidFromPath);
  const [info, setInfo] = React.useState<PlayInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!uuid) return;
    api<PlayInfo>(`/play/${uuid}/playinfo.json`)
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, [uuid]);

  if (!uuid) return <div className="grid h-full min-h-[100px] place-items-center text-xs text-muted-foreground">Missing entry id in URL</div>;
  if (error) return <div className="grid h-full min-h-[100px] place-items-center text-xs text-red-500">{error}</div>;
  if (!info) return <div className="grid h-full min-h-[100px] place-items-center text-xs text-muted-foreground">Loading…</div>;

  return (
    <div className="h-full w-full bg-black">
      {info.status !== "ready" ? (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          Video is {info.status}
        </div>
      ) : (
        <VODPlayer info={info} publicId={uuid} />
      )}
    </div>
  );
}
