"use client";

import * as React from "react";
import Link from "next/link";

import { api, type PlayInfo } from "@/lib/api";
import { getSiteConfig } from "@/lib/site-config";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { VODPlayer } from "@/components/vod-player";
import { LoadingCircle } from "@/components/loading";
import { ClapperboardIcon, FilmIcon } from "lucide-react";

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

  // Kaia-style dynamic title: set from the loaded video. The <title> element
  // is React-managed, so re-apply it deferred past each commit. Social/
  // search metadata (og:title/description/image) is written into <head> so
  // shared links render a proper card. Site name comes from the cached
  // site-config.
  React.useEffect(() => {
    if (!info?.title) return;
    const id = window.setTimeout(() => {
      getSiteConfig()
        .then((cfg) => {
          document.title = `${info.title} | ${cfg.siteName || t("appTitle")}`;
        })
        .catch(() => {
          document.title = `${info.title} | ${t("appTitle")}`;
        });
      setMeta("og:title", info.title);
      if (info.description) setMeta("og:description", info.description);
      if (info.poster) setMeta("og:image", info.poster);
      setMeta("og:type", "video.other");
    }, 0);
    return () => window.clearTimeout(id);
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col p-4">
      <header className="mb-4 flex items-center justify-between gap-2 text-muted-foreground">
        <div className="flex items-center gap-2">
          <ClapperboardIcon className="size-5" />
          <Link href="/library" className="text-sm font-medium hover:text-foreground">
            {t("libraryTitle")}
          </Link>
        </div>
      </header>
      {error ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <FilmIcon className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t("videoUnavailable")}</p>
          <Link href="/library" className="text-sm font-medium text-primary hover:underline">
            {t("libraryBackToLibrary")}
          </Link>
        </div>
      ) : !info ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <LoadingCircle />
          <span className="text-sm text-muted-foreground">{t("loading")}</span>
        </div>
      ) : info.status !== "ready" ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-sm text-muted-foreground">{t("playerVideoStatus")}</p>
          <Link href="/library" className="text-sm font-medium text-primary hover:underline">
            {t("libraryBackToLibrary")}
          </Link>
        </div>
      ) : (
        <>
          <VODPlayer info={info} publicId={uuid} autoplay={opts.autoplay} muted={opts.muted} loop={opts.loop} branding={info.player} />
          <h1 className="mt-4 text-xl font-semibold">{info.title}</h1>
          {info.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{info.description}</p>
          ) : null}
        </>
      )}
    </main>
  );
}

// setMeta upserts an Open Graph / meta tag in <head>.
function setMeta(property: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}
