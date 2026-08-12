// Client-side cached copy of the public /api/site-config (site name +
// default language). Fetched once per TTL — pages never re-ask on load.
"use client";

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

export function getSiteConfig(): Promise<SiteConfig> {
  if (typeof window === "undefined") {
    return Promise.resolve({ siteName: "VOD", defaultLang: "en", libraryMode: "disabled" });
  }
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const entry = JSON.parse(raw) as CacheEntry;
      if (Date.now() - entry.ts < CACHE_TTL_MS) {
        return Promise.resolve(entry.data);
      }
    }
  } catch {
    /* corrupted cache — refetch */
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
