// Client-side cached copy of the public /api/site-config (site name +
// default language). Fetched once per TTL — pages never re-ask on load.
"use client";

import * as React from "react";

export interface SiteConfig {
  siteName: string;
  defaultLang: string;
  /** disabled | login_only | enabled */
  libraryMode: string;
}

const CACHE_KEY = "vod-site-config";
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: SiteConfig;
  ts: number;
}

let inFlight: Promise<SiteConfig> | null = null;

// cachedSiteConfig synchronously reads the localStorage cache (fresh within
// the TTL), so first paint can use the stored site name without a flash.
function cachedSiteConfig(): SiteConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.ts < CACHE_TTL_MS) return entry.data;
  } catch {
    /* corrupted cache — ignored */
  }
  return null;
}

export function getSiteConfig(): Promise<SiteConfig> {
  if (typeof window === "undefined") {
    return Promise.resolve({ siteName: "Vidsilo", defaultLang: "en", libraryMode: "disabled" });
  }
  const cached = cachedSiteConfig();
  if (cached) {
    return Promise.resolve(cached);
  }
  if (!inFlight) {
    inFlight = fetch("/api/site-config", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`site-config ${res.status}`);
        return res.json() as Promise<SiteConfig>;
      })
      .then((data) => {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
        } catch {
          /* storage full/unavailable — keep serving in-memory */
        }
        return data;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

// useSiteName renders the admin-configured site name ("App Name" setting),
// served from the cached site-config. The initial state matches the SSR
// default so hydration never mismatches (localStorage reads during the
// first client render would crash with a hydration error); the cached or
// fetched value lands right after hydration.
export function useSiteName(): string {
  const [name, setName] = React.useState<string>("VOD App");
  React.useEffect(() => {
    let alive = true;
    getSiteConfig()
      .then((cfg) => {
        if (alive && cfg.siteName) setName(cfg.siteName);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return name;
}
