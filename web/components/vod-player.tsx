"use client";

import * as React from "react";
import Hls from "hls.js";

import type { PlayInfo, PlayerConfig } from "@/lib/api";
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
  branding,
}: {
  info: PlayInfo;
  publicId: string;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  /** Player design (accent color, logo, loader). Absent = the Default look. */
  branding?: PlayerConfig;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = React.useState(false);
  const [buffering, setBuffering] = React.useState(false);
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
  const [dragging, setDragging] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Touch devices don't have hover: show the control bar whenever the video
  // is tapped; auto-hide stays in effect for pointer (mouse) users.
  const [tapped, setTapped] = React.useState(false);
  const hideTimer = React.useRef<number | null>(null);

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
    const onWaiting = () => setBuffering(true);
    const onPlaying = () => setBuffering(false);
    const onCanPlay = () => setBuffering(false);

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
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
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
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
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      // The seek bar handles its own arrow keys; skip it here so a focused
      // slider does not double-seek.
      if (target?.closest?.("[data-seekbar]")) return;
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

  const scrubCols = 10;
  const scrubRows = Math.max(1, Math.ceil(info.spriteFrames / scrubCols));
  const scrubRowStep = scrubRows > 1 ? 100 / (scrubRows - 1) : 0;
  const scrubberStyle: React.CSSProperties | undefined =
    scrubFrame != null && info.sprite
      ? {
          backgroundImage: `url(${info.sprite})`,
          backgroundSize: `${scrubCols * 100}% ${scrubRows * 100}%`,
          backgroundPosition: `${(scrubFrame % scrubCols) * (100 / (scrubCols - 1))}% ${Math.floor(scrubFrame / scrubCols) * scrubRowStep}%`,
        }
      : undefined;

  const b = branding ?? {};
  const accent = b.accentColor && /^#[0-9a-fA-F]{3,8}$/.test(b.accentColor) ? b.accentColor : "#ffffff";
  const showLoader = b.showLoader !== false;
  const autoHideControls = b.autoHideControls !== false;
  const logoPositionClass = {
    "top-left": "left-3 top-3",
    "top-right": "right-3 top-3",
    "bottom-left": "left-3 bottom-12",
    "bottom-right": "right-3 bottom-12",
  }[b.logoPosition ?? "top-right"];

  // armHideTimer (re)starts the auto-hide countdown after any interaction.
  const armHideTimer = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (autoHideControls) {
      hideTimer.current = window.setTimeout(() => setTapped(false), 3000);
    }
  };
  // Clear the pending hide timer on unmount.
  React.useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  // seekFromEvent maps a pointer position on the seek bar to a time.
  const seekFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div
      ref={containerRef}
      className="group relative aspect-video w-full overflow-hidden rounded-xl bg-black select-none"
      style={{ "--player-accent": accent } as React.CSSProperties}
      onPointerUp={(e) => {
        // Taps on the controls (or the logo) must not toggle visibility.
        if ((e.target as HTMLElement | null)?.closest?.("[data-controls]")) return;
        const video = videoRef.current;
        setTapped((prev) => {
          if (prev && video && !video.paused) {
            // Controls visible and playing: tap toggles pause.
            video.pause();
            return true;
          }
          return !prev;
        });
        armHideTimer();
      }}
      onPointerMove={() => {
        setTapped(true);
        armHideTimer();
      }}
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

      {(info.subtitles ?? []).map((s) => (
        <track key={s.lang} kind="subtitles" srcLang={s.lang} label={s.label} src={s.url} />
      ))}

      {b.logoUrl ? (
        <a
          href={b.logoHref || undefined}
          target={b.logoHref ? "_blank" : undefined}
          rel="noreferrer"
          onClick={(e) => !b.logoHref && e.preventDefault()}
          className={`pointer-events-auto absolute z-10 ${logoPositionClass}`}
          style={{ width: b.logoSize ?? 64, height: b.logoSize ?? 64, opacity: b.logoOpacity ?? 0.8 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.logoUrl} alt="" className="h-full w-full object-contain" draggable={false} />
        </a>
      ) : null}

      {buffering && showLoader && !error ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black/20">
          <div
            className="size-12 animate-spin rounded-full border-4 border-white/20"
            style={{ borderTopColor: accent }}
          />
        </div>
      ) : null}

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
          <div className="grid size-20 place-items-center rounded-full text-black" style={{ backgroundColor: accent }}>
            <svg viewBox="0 0 24 24" className="ml-1 size-10 fill-current">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </button>
      ) : null}

      {/* controls */}
      <div
        data-controls
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 transition-opacity ${
          autoHideControls
            ? tapped || !playing
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100"
            : "opacity-100"
        }`}
      >
        {scrubTime != null && scrubFrame != null && info.sprite ? (
          <div className="pointer-events-none absolute bottom-12 -translate-x-1/2 overflow-hidden rounded border bg-black"
            style={{ left: `${scrubAt}%`, width: 160, height: 90, ...scrubberStyle }}
          />
        ) : null}
        <div
          role="slider"
          tabIndex={0}
          data-seekbar
          aria-label={t("playerSeek")}
          aria-valuemin={0}
          aria-valuemax={Math.max(1, Math.round(duration))}
          aria-valuenow={Math.round(scrubTime ?? current)}
          className="relative h-1.5 cursor-pointer rounded-full bg-white/25 focus-visible:ring-2 focus-visible:ring-white/60"
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setScrub(((e.clientX - rect.left) / rect.width) * 100);
          }}
          onMouseLeave={() => {
            if (!dragging) setScrub(null);
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
            seekFromEvent(e);
          }}
          onPointerMove={(e) => {
            if (!dragging) return;
            const rect = e.currentTarget.getBoundingClientRect();
            setScrub(((e.clientX - rect.left) / rect.width) * 100);
          }}
          onPointerUp={(e) => {
            setDragging(false);
            seekFromEvent(e);
            setScrub(null);
          }}
          onPointerCancel={() => {
            setDragging(false);
            setScrub(null);
          }}
          onKeyDown={(e) => {
            const video = videoRef.current;
            if (!video) return;
            if (e.key === "ArrowRight") {
              e.preventDefault();
              video.currentTime = Math.min(video.duration, video.currentTime + 10);
            } else if (e.key === "ArrowLeft") {
              e.preventDefault();
              video.currentTime = Math.max(0, video.currentTime - 10);
            }
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seekTo(((e.clientX - rect.left) / rect.width) * duration);
          }}
        >
          <div
            className="absolute h-full rounded-full"
            style={{ width: `${scrubAt ?? progress}%`, backgroundColor: accent }}
          />
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
          <label className="flex items-center gap-2">
            <span className="sr-only">{mutedState ? t("playerUnmute") : t("playerMute")}</span>
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
              className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-white/30 accent-current"
              style={{ accentColor: accent }}
              aria-label={t("playerVolume")}
            />
          </label>
          <span className="tabular-nums opacity-80">
            {fmt(current)} / {fmt(duration)}
          </span>
          <div className="ml-auto flex items-center gap-3">
            {levels.length > 1 ? (
              <select
                value={level}
                onChange={(e) => setQuality(Number(e.target.value))}
                className="rounded border border-white/20 bg-black/60 px-1.5 py-1 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                aria-label={t("playerQuality")}
              >
                <option value={-1} className="bg-background text-foreground">{t("playerAuto")}</option>
                {levels.map((l) => (
                  <option key={l.index} value={l.index} className="bg-background text-foreground">
                    {l.height}p
                  </option>
                ))}
              </select>
            ) : null}
            {((info.subtitles ?? []).length > 0 ? (
              <select
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                className="rounded border border-white/20 bg-black/60 px-1.5 py-1 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                aria-label={t("tabSubtitles")}
              >
                <option value="" className="bg-background text-foreground">{t("playerOff")}</option>
                {(info.subtitles ?? []).map((s) => (
                  <option key={s.lang} value={s.lang} className="bg-background text-foreground">
                    {s.label || s.lang}
                  </option>
                ))}
              </select>
            ) : null)}
            <select
              value={rate}
              onChange={(e) => setPlaybackRate(Number(e.target.value))}
              className="rounded border border-white/20 bg-black/60 px-1.5 py-1 text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label={t("playerSpeed")}
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                <option key={r} value={r} className="bg-background text-foreground">
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
