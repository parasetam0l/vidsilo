"use client";

import * as React from "react";

import { api, type PlayInfo } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { VidsiloPlayer } from "@/components/vidsilo-player";
import { LoadingCircle } from "@/components/loading";

function uuidFromPath(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export default function EmbedPage() {
  const t = useT();
  const [uuid] = React.useState(uuidFromPath);
  const [info, setInfo] = React.useState<PlayInfo | null>(null);
  const [error, setError] = React.useState(false);
  const [opts] = React.useState(() => {
    if (typeof window === "undefined") return { autoplay: false, muted: false, loop: false, startTime: 0 };
    const p = new URLSearchParams(window.location.search);
    const t = Number(p.get("t"));
    return {
      autoplay: p.get("autoplay") === "1",
      muted: p.get("muted") === "1",
      loop: p.get("loop") === "1",
      startTime: Number.isFinite(t) && t > 0 ? t : 0,
    };
  });

  React.useEffect(() => {
    if (!uuid) return;
    api<PlayInfo>(`/play/${uuid}/playinfo.json`)
      .then(setInfo)
      .catch(() => setError(true));
  }, [uuid]);

  if (!uuid) return <div className="grid h-full min-h-[100px] place-items-center text-xs text-muted-foreground">{t("playerMissingId")}</div>;
  if (error)
    return (
      <div className="grid h-full min-h-[100px] place-items-center text-xs text-muted-foreground">
        {t("videoUnavailable")}
      </div>
    );
  if (!info) return <div className="grid h-full min-h-[100px] place-items-center text-xs text-muted-foreground"><LoadingCircle className="size-6" /></div>;

  return (
    <div className="h-full w-full bg-black">
      {info.status !== "ready" ? (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          {t("playerVideoStatus")}
        </div>
      ) : (
        <VidsiloPlayer info={info} publicId={uuid} autoplay={opts.autoplay} muted={opts.muted} loop={opts.loop} branding={info.player} startTime={opts.startTime} />
      )}
    </div>
  );
}
