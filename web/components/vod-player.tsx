"use client";

import * as React from "react";
import Hls from "hls.js";

import type { PlayInfo } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { viewerId } from "@/lib/format";

// Analytics beacon helpers (throttled).
function applySubtitleTrack(video: HTMLVideoElement | null, lang: string) {
  const tracks = video?.textTracks;
  if (!tracks) return;
  for (let i = 0; i < tracks.length; i++) {
    tracks[i].mode = lang !== "" && tracks[i].language === lang ? "showing" : "hidden";
  }
}

function beacon(path: string, body: unknown) {
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

export function VODPlayer({
  info,
  publicId,
  autoplay,
  muted,
  loop,
}: {
  info: PlayInfo;
  publicId: string;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [current, setCurrent] = React.useState(0);
  const [duration, setDuration] = React.useState(info.durationMs ?? 0);
  const [volume, setVolume] = React.useState(() => {
    if (typeof window === "undefined") return 1;
    const v = Number(localStorage.getItem("vod-volume"));
    return v >= 0 && v <= 1 ? v : 1;
  });
  const [mutedState, setMutedState] = React.useState(() => {
    if (typeof window === "undefined") return !!muted;
    return localStorage.getItem("vod-muted") === "1" || !!muted;
  });
  const [rate, setRate] = React.useState(() => {
    if (typeof window === "undefined") return 1;
    const r = Number(localStorage.getItem("vod-rate"));
    return [0.5, 0.75, 1, 1.25, 1.5, 2].includes(r) ? r : 1;
  });
  const [levels, setLevels] = React.useState<{ index: number; height: number }[]>([]);
  const [level, setLevel] = React.useState(-1);
  const [subtitle, setSubtitle] = React.useState<string>("");
  const [fullscreen, setFullscreen] = React.useState(false);
  const [scrub, setScrub] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const t = useT();
  const viewId = React.useMemo(() => viewerId(), []);
  const watchedRef = React.useRef(0);
  const lastBeaconRef = React.useRef(0);
  const playedRef = React.useRef(false);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video || !info.master) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 30,
        backBufferLength: 60,
      });
      hls.loadSource(info.master);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setLevels(
          hls.levels.map((l, i) => ({ index: i, height: l.height })),
        );
        if (autoplay) video.play().catch(() => {});
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setLevel(data.level));
      (video as HTMLVideoElement & { hls?: Hls }).hls = hls;
      return () => hls.destroy();
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = info.master;
      if (autoplay) video.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.master]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.volume = volume;
      video.muted = mutedState;
      video.playbackRate = rate;
    }
    // Initial application only — later changes flow through the setters.
  }, [muted, volume, mutedState, rate]);

  React.useEffect(() => {
    localStorage.setItem("vod-volume", String(volume));
  }, [volume]);
  React.useEffect(() => {
    localStorage.setItem("vod-muted", mutedState ? "1" : "0");
  }, [mutedState]);
  React.useEffect(() => {
    localStorage.setItem("vod-rate", String(rate));
  }, [rate]);

  React.useEffect(() => {
    applySubtitleTrack(videoRef.current, subtitle);
  }, [subtitle]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTime = () => setCurrent(video.currentTime * 1000);
    const onMeta = () => {
      if (video.duration > 0) setDuration(video.duration * 1000);
    };
    const onPlay = () => {
      setPlaying(true);
      if (!playedRef.current) {
        playedRef.current = true;
        beacon("/api/analytics/play", { publicId, viewerId: viewId });
      }
    };
    const onPause = () => {
      setPlaying(false);
      flushWatch();
    };
    const onVolume = () => {
      setVolume(video.volume);
      setMutedState(video.muted);
    };
    const onFsChange = () => setFullscreen(document.fullscreenElement != null);

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("volumechange", onVolume);
    document.addEventListener("fullscreenchange", onFsChange);

    const flushWatch = () => {
      const seconds = Math.round(watchedRef.current);
      if (seconds > 0) {
        beacon("/api/analytics/watch", { publicId, viewerId: viewId, seconds });
        watchedRef.current = 0;
      }
    };
    const ticker = setInterval(() => {
      if (!video.paused && !video.ended) {
        watchedRef.current += 1;
        const now = Date.now();
        if (now - lastBeaconRef.current > 30000) {
          lastBeaconRef.current = now;
          flushWatch();
        }
      }
    }, 1000);
    window.addEventListener("beforeunload", flushWatch);

    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("volumechange", onVolume);
      document.removeEventListener("fullscreenchange", onFsChange);
      clearInterval(ticker);
      window.removeEventListener("beforeunload", flushWatch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function seekTo(ms: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = ms / 1000;
    setCurrent(ms);
  }

  function setQuality(index: number) {
    const video = videoRef.current as HTMLVideoElement & { hls?: Hls };
    if (video.hls) {
      video.hls.currentLevel = index;
      setLevel(index);
    }
  }

  function setPlaybackRate(r: number) {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = r;
    setRate(r);
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }

  function toggleFullscreen() {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else container.requestFullscreen();
  }

  function togglePictureInPicture() {
    const video = videoRef.current;
    if (!video) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else {
      video.requestPictureInPicture?.().catch(() => {});
    }
  }

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const video = videoRef.current;
      if (!video) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          if (video.paused) video.play().catch(() => {});
          else video.pause();
          break;
        case "ArrowRight":
          video.currentTime = Math.min(video.duration, video.currentTime + 10);
          break;
        case "ArrowLeft":
          video.currentTime = Math.max(0, video.currentTime - 10);
          break;
        case "ArrowUp":
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "m":
        case "M":
          video.muted = !video.muted;
          break;
        case "p":
        case "P":
          togglePictureInPicture();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const scrubAt = scrub != null ? Math.min(100, Math.max(0, scrub)) : null;
  const scrubTime = scrubAt != null ? (scrubAt / 100) * duration : null;
  const scrubFrame = scrubTime != null && info.spriteFrames > 0
    ? Math.min(info.spriteFrames - 1, Math.floor((scrubTime / duration) * info.spriteFrames))
    : null;

  const fmt = (ms: number) => {
    const t = Math.round(ms / 1000);
    const m = Math.floor(t / 60);
    const s = t % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const scrubberStyle: React.CSSProperties | undefined =
    scrubFrame != null && info.sprite
      ? {
          backgroundImage: `url(${info.sprite})`,
          backgroundSize: "1000% 1000%",
          backgroundPosition: `${(scrubFrame % 10) * 11.111}% ${Math.floor(scrubFrame / 10) * 11.111}%`,
        }
      : undefined;

  return (
    <div
      ref={containerRef}
      className="group relative aspect-video w-full overflow-hidden rounded-xl bg-black select-none"
    >
      <video
        ref={videoRef}
        className="h-full w-full"
        poster={info.poster}
        playsInline
        muted={mutedState}
        loop={loop}
        onError={() => setError(t("playerError"))}
      />

      {info.subtitles.map((s) => (
        <track key={s.lang} kind="subtitles" srcLang={s.lang} label={s.label} src={s.url} />
      ))}

      {error ? (
        <div className="absolute inset-0 grid place-items-center bg-black/80 text-sm text-red-400">
          {error}
        </div>
      ) : null}

      {!playing && !error ? (
        <button
          className="absolute inset-0 grid place-items-center bg-black/30 transition-opacity"
          onClick={togglePlay}
          aria-label={t("playerPlay")}
        >
          <div className="grid size-20 place-items-center rounded-full bg-white/90 text-black">
            <svg viewBox="0 0 24 24" className="ml-1 size-10 fill-current">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </button>
      ) : null}

      {/* controls */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
        {scrubTime != null && scrubFrame != null && info.sprite ? (
          <div className="pointer-events-none absolute bottom-12 -translate-x-1/2 overflow-hidden rounded border bg-black"
            style={{ left: `${scrubAt}%`, width: 160, height: 90, ...scrubberStyle }}
          />
        ) : null}
        <div
          className="relative h-1.5 cursor-pointer rounded-full bg-white/25"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setScrub(((e.clientX - rect.left) / rect.width) * 100);
          }}
          onMouseLeave={() => setScrub(null)}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekTo(((e.clientX - rect.left) / rect.width) * duration);
          }}
        >
          <div className="absolute h-full rounded-full bg-white" style={{ width: `${scrubAt ?? progress}%` }} />
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-white">
          <button onClick={togglePlay} aria-label={playing ? t("playerPause") : t("playerPlay")} className="opacity-80 hover:opacity-100">
            {playing ? (
              <svg viewBox="0 0 24 24" className="size-5 fill-current"><path d="M6 4h4v16H6zM14 4h4v16h-4z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="size-5 fill-current"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <button onClick={toggleMute} aria-label={mutedState || volume === 0 ? t("playerUnmute") : t("playerMute")} className="opacity-80 hover:opacity-100">
            {mutedState || volume === 0 ? (
              <svg viewBox="0 0 24 24" className="size-5 fill-current"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="size-5 fill-current"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4zM14 3.2v2.1c2.9.9 5 3.5 5 6.7s-2.1 5.8-5 6.7v2.1c4-.9 7-4.4 7-8.8s-3-7.9-7-8.8z" /></svg>
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={mutedState ? 0 : volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              const video = videoRef.current;
              if (video) {
                video.volume = v;
                video.muted = v === 0;
              }
            }}
            className="w-20"
          />
          <span className="tabular-nums opacity-80">
            {fmt(current)} / {fmt(duration)}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {levels.length > 1 ? (
              <select
                value={level}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="rounded bg-black/40 px-1 py-0.5"
                aria-label={t("colCodec")}
              >
                <option value={-1}>{t("playerAuto")}</option>
                {levels.map((l) => (
                  <option key={l.index} value={l.index}>
                    {l.height}p
                  </option>
                ))}
              </select>
            ) : null}
            {info.subtitles.length > 0 ? (
              <select
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                className="rounded bg-black/40 px-1 py-0.5"
                aria-label={t("tabSubtitles")}
              >
                <option value="">{t("playerOff")}</option>
                {info.subtitles.map((s) => (
                  <option key={s.lang} value={s.lang}>
                    {s.label || s.lang}
                  </option>
                ))}
              </select>
            ) : null}
            <select
              value={rate}
              onChange={(e) => setPlaybackRate(Number(e.target.value))}
              className="rounded bg-black/40 px-1 py-0.5"
              aria-label={t("playerSpeed")}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                <option key={r} value={r}>
                  {r}x
                </option>
              ))}
            </select>
            {typeof document !== "undefined" && "pictureInPictureEnabled" in document && document.pictureInPictureEnabled ? (
              <button onClick={togglePictureInPicture} aria-label={t("playerPictureInPicture")} className="opacity-80 hover:opacity-100">
                <svg viewBox="0 0 24 24" className="size-5 fill-current">
                  <path d="M10 8h11v9h-11V8zm2 2v5h7v-5h-7zM3 5h13v2H5v11h11v-2h2v4H3V5z" />
                </svg>
              </button>
            ) : null}
            <button onClick={toggleFullscreen} aria-label={fullscreen ? t("playerExitFullscreen") : t("playerFullscreen")} className="opacity-80 hover:opacity-100">
              {fullscreen ? (
                <svg viewBox="0 0 24 24" className="size-5 fill-current"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" /></svg>
              ) : (
                <svg viewBox="0 0 24 24" className="size-5 fill-current"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
