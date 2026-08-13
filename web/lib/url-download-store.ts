"use client";

// URL download jobs at app level, persisted to localStorage: the pending
// list survives navigation and hard refreshes. The actual download runs on
// the server (worker); the client tracks per-URL state and polls progress.
import * as React from "react";

import { api } from "@/lib/api";

export type UrlDownloadStatus =
  | "checking"
  | "queued"
  | "downloading"
  | "done"
  | "failed";

export interface UrlDownloadJob {
  id: string;
  url: string;
  fileName: string;
  title?: string;
  category?: string;
  status: UrlDownloadStatus;
  progress: number; // 0..100, -1 = indeterminate
  error?: string;
  entryId?: string;
  finishedAt?: string;
}

const STORAGE_KEY = "vidsilo-url-downloads";
const COMPLETED_KEY = "vidsilo-url-downloads-completed";
const listeners = new Set<() => void>();

let jobs: UrlDownloadJob[] = load();
let lastCompletedAt: number | null = loadCompleted();

function loadCompleted(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(COMPLETED_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export function markUrlDownloadsCompleted() {
  lastCompletedAt = Date.now();
  try {
    localStorage.setItem(COMPLETED_KEY, String(lastCompletedAt));
  } catch {
    // ignore
  }
}

export function hasUrlDownloadsCompleted(): boolean {
  return lastCompletedAt != null;
}

export function clearUrlDownloadsCompleted() {
  lastCompletedAt = null;
  try {
    localStorage.removeItem(COMPLETED_KEY);
  } catch {
    // ignore
  }
}

function load(): UrlDownloadJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UrlDownloadJob[];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return parsed
      .map((j): UrlDownloadJob =>
        j.status === "queued" || j.status === "downloading"
          ? { ...j, status: "checking", progress: -1 }
          : j,
      )
      .filter((j) => {
        if (j.status !== "done" && j.status !== "failed") return true;
        return !!j.finishedAt && Date.parse(j.finishedAt) >= cutoff;
      });
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  } catch {
    // storage full / private mode — still works in-memory
  }
}

function emit() {
  for (const l of listeners) l();
}

export function subscribeUrlDownloads(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getUrlDownloads(): UrlDownloadJob[] {
  return jobs;
}

function update(id: string, patch: Partial<UrlDownloadJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  emit();
  persist();
}

export function updateUrlDownload(id: string, patch: Partial<UrlDownloadJob>) {
  update(id, patch);
}

// resetIdle clears the list when nothing is active (called on dialog open).
export function resetIdleDownloads() {
  const active = jobs.some((j) =>
    j.status === "queued" || j.status === "downloading" || j.status === "checking",
  );
  if (!active && jobs.length > 0) {
    jobs = [];
    emit();
    persist();
  }
}

interface CheckResult {
  url: string;
  ok: boolean;
  reason?: string;
  fileName?: string;
}

// checkUrls validates lines against the server; valid ones become cards.
export async function checkUrls(lines: string[]): Promise<{ added: number; failed: number }> {
  const fresh = lines.map((url) => url.trim()).filter(Boolean);
  if (fresh.length === 0) return { added: 0, failed: 0 };
  const result = await api<CheckResult[]>("/api/entries/from-url/check", {
    method: "POST",
    body: JSON.stringify({ urls: fresh }),
  });
  let added = 0;
  let failed = 0;
  const existing = new Set(jobs.map((j) => j.url));
  for (const r of result) {
    if (!r.ok) {
      failed++;
      continue;
    }
    if (existing.has(r.url)) continue;
    const name = r.fileName ?? r.url;
    jobs = [
      ...jobs,
      {
        id: crypto.randomUUID(),
        url: r.url,
        fileName: name,
        title: name.replace(/\.[^.]+$/, ""),
        category: "",
        status: "queued",
        progress: 0,
      },
    ];
    existing.add(r.url);
    added++;
  }
  emit();
  persist();
  return { added, failed };
}

// submitAndPoll starts the downloads one by one: submit a URL, then poll
// /api/url-downloads for progress and resolve each job via its entry status.
let polling = false;
export async function startDownloads() {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      const next = jobs.find((j) => j.status === "queued");
      if (!next) break;
      await submitOne(next);
    }
    await pollUntilIdle();
    if (jobs.some((j) => j.status === "done")) {
      markUrlDownloadsCompleted();
    }
  } finally {
    polling = false;
  }
}

async function submitOne(job: UrlDownloadJob) {
  update(job.id, { status: "downloading", progress: -1, error: undefined });
  const result = await api<
    { url: string; ok: boolean; reason?: string; entryId?: string }[]
  >("/api/entries/from-url", {
    method: "POST",
    body: JSON.stringify({ urls: [job.url] }),
  });
  const r = result[0];
  if (!r?.ok) {
    update(job.id, { status: "failed", error: r?.reason ?? "request failed", finishedAt: new Date().toISOString() });
    return;
  }
  update(job.id, { entryId: r.entryId });
  if (r.entryId && (job.title || job.category)) {
    const patchBody: Record<string, unknown> = {};
    if (job.title) patchBody.title = job.title;
    if (job.category) patchBody.categoryId = Number(job.category);
    api(`/api/entries/${r.entryId}`, {
      method: "PATCH",
      body: JSON.stringify(patchBody),
    }).catch(() => {});
  }
  // Wait for this download to finish (its row disappears from the active
  // list) before starting the next one.
  await waitForEntry(r.entryId!, job);
}

function waitForEntry(publicId: string, job: UrlDownloadJob): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setInterval(async () => {
      try {
        const active = await api<{ publicId: string; bytes: number; totalBytes: number }[]>("/api/url-downloads");
        const row = active.find((d) => d.publicId === publicId);
        if (row) {
          if (row.totalBytes > 0) {
            update(job.id, {
              progress: Math.min(99, Math.round((row.bytes / row.totalBytes) * 100)),
            });
          }
          return; // still downloading
        }
        // Row gone: resolve via the entry status.
        window.clearInterval(timer);
        const entry = await api<{ status: string; error?: string }>(`/api/entries/${publicId}`);
        if (entry.status === "failed") {
          update(job.id, { status: "failed", error: entry.error ?? "download failed", progress: -1, finishedAt: new Date().toISOString() });
        } else {
          update(job.id, { status: "done", progress: 100, finishedAt: new Date().toISOString() });
        }
        resolve();
      } catch {
        // transient network error — keep polling
      }
    }, 2000);
  });
}

// pollUntilIdle keeps polling progress for jobs still downloading (e.g. when
// the dialog was closed and reopened mid-download).
async function pollUntilIdle() {
  for (;;) {
    const downloading = jobs.find((j) => j.status === "downloading" && j.entryId);
    if (!downloading) break;
    await new Promise((r) => setTimeout(r, 2000));
    await waitForEntry(downloading.entryId!, downloading);
  }
}

export function useUrlDownloads() {
  return React.useSyncExternalStore(subscribeUrlDownloads, getUrlDownloads, () => []);
}

// removeUrlDownload drops a queued/failed job from the local list.
export function removeUrlDownload(id: string) {
  jobs = jobs.filter((j) => j.id !== id);
  emit();
  persist();
}

// clearUrlDownloads drops the whole URL queue from the local list.
export function clearUrlDownloads() {
  jobs = [];
  emit();
  persist();
}

export function clearAllUrlDownloads() {
  jobs = [];
  emit();
  persist();
}

export function __resetUrlDownloadStore() {
  jobs = [];
  emit();
}
