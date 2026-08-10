"use client";

import * as React from "react";

import { api, type PlayInfo } from "@/lib/api";
import { VODPlayer } from "@/components/vod-player";
import { ClapperboardIcon } from "lucide-react";

function uuidFromPath(): string {
  // /play/{uuid}
  if (typeof window === "undefined") return "";
  const parts = window.location.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export default function PlayPage() {
  const [uuid] = React.useState(uuidFromPath);
  const [info, setInfo] = React.useState<PlayInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!uuid) return;
    api<PlayInfo>(`/play/${uuid}/playinfo.json`)
      .then(setInfo)
      .catch((e) => setError(e.message));
  }, [uuid]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col p-4">
      <header className="mb-4 flex items-center gap-2 text-muted-foreground">
        <ClapperboardIcon className="size-5" />
        <span className="text-sm font-medium">VOD</span>
      </header>
      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : !info ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : info.status !== "ready" ? (
        <p className="text-sm text-muted-foreground">
          This video is {info.status} — check back shortly.
        </p>
      ) : (
        <>
          <VODPlayer info={info} publicId={uuid} />
          <h1 className="mt-4 text-xl font-semibold">{info.title}</h1>
          {info.description ? (
            <p className="mt-1 text-sm text-muted-foreground">{info.description}</p>
          ) : null}
        </>
      )}
    </main>
  );
}
