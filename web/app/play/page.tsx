"use client";

import * as React from "react";

import { api, type PlayInfo } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { VODPlayer } from "@/components/vod-player";
import { ClapperboardIcon } from "lucide-react";

function uuidFromPath(): string {
  // /play/{uuid}
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export default function PlayPage() {
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col p-4">
      <header className="mb-4 flex items-center gap-2 text-muted-foreground">
        <ClapperboardIcon className="size-5" />
        <span className="text-sm font-medium">{t("appName")}</span>
      </header>
      {error ? (
        <p className="text-sm text-muted-foreground">{t("videoUnavailable")}</p>
      ) : !info ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : info.status !== "ready" ? (
        <p className="text-sm text-muted-foreground">{t("playerVideoStatus")}</p>
      ) : (
        <>
          <VODPlayer info={info} publicId={uuid} autoplay={opts.autoplay} muted={opts.muted} loop={opts.loop} />
          <h1 className="mt-4 text-xl font-semibold">{info.title}</h1>
          {info.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{info.description}</p>
          ) : null}
        </>
      )}
    </main>
  );
}
