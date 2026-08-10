"use client";

import * as React from "react";

import { api, type PlayInfo } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { VODPlayer } from "@/components/vod-player";

function uuidFromPath(): string {
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export default function EmbedPage() {
  const t = useT();
  const toast = useToast();
  const [uuid] = React.useState(uuidFromPath);
  const [info, setInfo] = React.useState<PlayInfo | null>(null);
  const [error, setError] = React.useState(false);
  const [opts] = React.useState(() => {
    if (typeof window === "undefined") return { autoplay: false, muted: false, loop: false };
    const p = new URLSearchParams(window.location.search);
    return {
      autoplay: p.get("autoplay") === "1",
      muted: p.get("muted") === "1",
      loop: p.get("loop") === "1",
    };
  });

  React.useEffect(() => {
    if (!uuid) return;
    api<PlayInfo>(`/play/${uuid}/playinfo.json`)
      .then(setInfo)
      .catch((e) => {
        toast.error(e.message);
        setError(true);
      });
  }, [uuid, toast]);

  if (!uuid) return <div className="grid h-full min-h-[100px] place-items-center text-xs text-muted-foreground">{t("playerMissingId")}</div>;
  if (error)
    return (
      <div className="grid h-full min-h-[100px] place-items-center text-xs text-muted-foreground">
        {t("videoUnavailable")}
      </div>
    );
  if (!info) return <div className="grid h-full min-h-[100px] place-items-center text-xs text-muted-foreground">{t("loading")}</div>;

  return (
    <div className="h-full w-full bg-black">
      {info.status !== "ready" ? (
        <div className="grid h-full place-items-center text-xs text-muted-foreground">
          {t("playerVideoStatus", { status: info.status })}
        </div>
      ) : (
        <VODPlayer info={info} publicId={uuid} autoplay={opts.autoplay} muted={opts.muted} loop={opts.loop} />
      )}
    </div>
  );
}
