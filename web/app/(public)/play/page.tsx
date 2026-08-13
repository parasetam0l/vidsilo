"use client";

import * as React from "react";
import Link from "next/link";

import { api, type PlayInfo } from "@/lib/api";
import { getSiteConfig, useSiteName, useAppVersion } from "@/lib/site-config";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { VODPlayer } from "@/components/vod-player";
import { LoadingCircle } from "@/components/loading";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelect } from "@/components/language-select";
import { ClapperboardIcon, FilmIcon } from "lucide-react";

function uuidFromPath(): string {
  // /play/{uuid}
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export default function PlayPage() {
  const t = useT();
  const siteName = useSiteName();
  const appVersion = useAppVersion();
  const toast = useToast();
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
          document.title = `${info.title} | ${cfg.siteName || "Vidsilo"}`;
        })
        .catch(() => {
          document.title = `${info.title} | VOD App`;
        });
      setMeta("og:title", info.title);
      if (info.description) setMeta("og:description", info.description);
      if (info.poster) setMeta("og:image", info.poster);
      setMeta("og:type", "video.other");
    }, 0);
    return () => window.clearTimeout(id);
  });

  return (
    <main className="min-h-screen w-full">
      {/* Same top bar as the homepage */}
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ClapperboardIcon className="size-4" />
            </div>
            <span className="flex flex-col leading-none">
              <span className="text-sm font-semibold text-foreground">{siteName}</span>
              <span className="mt-0.5 text-xs text-muted-foreground">{appVersion}</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSelect />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        {error ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <FilmIcon className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">{t("videoUnavailable")}</p>
            <Link href="/" className="text-sm font-medium text-primary hover:underline">
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
            <Link href="/" className="text-sm font-medium text-primary hover:underline">
              {t("libraryBackToLibrary")}
            </Link>
          </div>
        ) : (
          <>
            <VODPlayer info={info} publicId={uuid} autoplay={opts.autoplay} muted={opts.muted} loop={opts.loop} branding={info.player} startTime={opts.startTime} />
            <h1 className="mt-4 text-xl font-semibold">{info.title}</h1>
            {info.description ? (
              <p className="mt-1 text-sm text-muted-foreground">{info.description}</p>
            ) : null}
          </>
        )}
      </div>
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
