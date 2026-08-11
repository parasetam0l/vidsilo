"use client";

// Upload jobs at app level, persisted to localStorage: the pending list and
// tus upload URLs survive page navigation AND hard refreshes, so interrupted
// uploads can be resumed by re-selecting the same file. File objects are
// memory-only (they cannot be serialized); tus itself stores progress
// server-side, so resume only needs the upload URL.
import * as React from "react";
import * as tus from "tus-js-client";

import { idbDelete, idbGet, idbPut } from "@/lib/idb";

export type UploadStatus =
  | "queued"
  | "uploading"
  | "done"
  | "failed"
  | "interrupted";

export interface UploadJob {
  id: string;
  fileName: string;
  fileSize: number;
  title: string;
  description: string;
  category: string;
  progress: number;
  status: UploadStatus;
  error?: string;
  uploadUrl?: string;
  finishedAt?: string;
}

const STORAGE_KEY = "vod-uploads";
const COMPLETED_KEY = "vod-uploads-completed";
const listeners = new Set<() => void>();

let jobs: UploadJob[] = load();
let lastCompletedAt: number | null = loadCompleted();
const files = new Map<string, File>(); // id -> File (memory only)
const activeUploads = new Map<string, tus.Upload>(); // id -> in-flight tus upload

function loadCompleted(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(COMPLETED_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

// markUploadsCompleted remembers that the batch finished, so reopening the
// dialog can show the completed state instead of resetting it away.
export function markUploadsCompleted() {
  lastCompletedAt = Date.now();
  try {
    localStorage.setItem(COMPLETED_KEY, String(lastCompletedAt));
  } catch {
    // ignore
  }
}

export function hasUploadsCompleted(): boolean {
  return lastCompletedAt != null;
}

export function clearUploadsCompleted() {
  lastCompletedAt = null;
  try {
    localStorage.removeItem(COMPLETED_KEY);
  } catch {
    // ignore
  }
}

function load(): UploadJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UploadJob[];
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return parsed
      // Anything in flight when the page reloaded is resumable, not lost.
      .map((j): UploadJob =>
        j.status === "uploading" || j.status === "queued"
          ? { ...j, status: "interrupted" }
          : j,
      )
      // Completed/failed history older than a day is dropped from the list.
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
    // storage full / private mode — uploads still work in-memory
  }
}

function emit() {
  for (const l of listeners) l();
}

export function subscribeUploads(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getUploads(): UploadJob[] {
  return jobs;
}

function defaultTitle(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

export const MAX_BATCH = 10;

export interface AddFilesResult {
  added: number;
  duplicates: number;
  overLimit: number;
}

export function addFiles(newFiles: File[]): AddFilesResult {
  const result: AddFilesResult = { added: 0, duplicates: 0, overLimit: 0 };
  // Free slots: active (non-done, non-failed) jobs count against the cap.
  const active = jobs.filter(
    (j) => j.status !== "done" && j.status !== "failed",
  ).length;
  const slots = Math.max(0, MAX_BATCH - active);
  for (const f of newFiles) {
    // Resume: same file name+size with a stored tus upload URL.
    const resumable = jobs.find(
      (j) =>
        j.fileName === f.name &&
        j.fileSize === f.size &&
        j.status === "interrupted" &&
        j.uploadUrl,
    );
    if (resumable) {
      files.set(resumable.id, f);
      void idbPut(resumable.id, f);
      jobs = jobs.map((j) =>
        j.id === resumable.id ? { ...j, status: "queued" } : j,
      );
      emit();
      persist();
      result.added++;
      continue;
    }
    // Already in the list — report it as a duplicate even when the batch
    // is full, so the user gets the right message.
    if (
      jobs.some(
        (j) =>
          j.fileName === f.name &&
          j.fileSize === f.size &&
          j.status !== "done" &&
          j.status !== "failed",
      )
    ) {
      result.duplicates++;
      continue;
    }
    if (result.added >= slots) {
      result.overLimit++;
      continue;
    }
    const job: UploadJob = {
      id: crypto.randomUUID(),
      fileName: f.name,
      fileSize: f.size,
      title: defaultTitle(f.name),
      description: "",
      category: "",
      progress: 0,
      status: "queued",
    };
    files.set(job.id, f);
    void idbPut(job.id, f);
    jobs = [...jobs, job];
    result.added++;
  }
  emit();
  persist();
  return result;
}

export function updateJob(id: string, patch: Partial<UploadJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  emit();
  persist();
}

// removeJob drops the job. An in-flight upload is aborted first: the
// transfer stops and the partially uploaded file is discarded — the server
// entry stays 'uploading' (no source media) and can be deleted from the
// entries list.
export function removeJob(id: string) {
  activeUploads.get(id)?.abort();
  activeUploads.delete(id);
  jobs = jobs.filter((j) => j.id !== id);
  files.delete(id);
  void idbDelete(id);
  emit();
  persist();
}

// startJob uploads one file and resolves when it finishes (done or failed),
// so callers can serialize batches.
export async function startJob(id: string): Promise<void> {
  const job = jobs.find((j) => j.id === id);
  if (!job || job.status === "uploading" || job.status === "done") {
    return;
  }
  let file = files.get(id);
  if (!file) {
    // After a hard refresh the File is gone from memory — restore from
    // IndexedDB so interrupted uploads resume without re-selecting.
    file = (await idbGet(id)) ?? undefined;
    if (!file) return;
    files.set(id, file);
  }
  updateJob(id, { status: "uploading", error: undefined });

  let resolveFinished: () => void;
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const upload = new tus.Upload(file, {
    endpoint: "/upload/",
    retryDelays: [0, 1000, 3000, 5000],
    chunkSize: 4 * 1024 * 1024,
    uploadUrl: job.uploadUrl, // resume after refresh when present
    metadata: {
      filename: file.name,
      title: job.title,
      description: job.description,
      category: job.category,
    },
    onProgress: (bytesSent, bytesTotal) => {
      updateJob(id, {
        progress: Math.round((bytesSent / bytesTotal) * 100),
      });
    },
    onUploadUrlAvailable: () => {
      if (upload.url) updateJob(id, { uploadUrl: upload.url });
    },
    onSuccess: () => {
      activeUploads.delete(id);
      void idbDelete(id);
      updateJob(id, { progress: 100, status: "done", finishedAt: new Date().toISOString() });
      resolveFinished();
    },
    onError: (err) => {
      activeUploads.delete(id);
      updateJob(id, { status: "failed", error: err.message, finishedAt: new Date().toISOString() });
      resolveFinished();
    },
  });
  activeUploads.set(id, upload);
  upload.start();
  await finished;
}

// startAll runs the pending batch one file at a time: bandwidth-friendly
// and predictable. Re-entrant safe (no-op while already running).
let batchRunning = false;
export async function startAll() {
  if (batchRunning) return;
  batchRunning = true;
  try {
    for (;;) {
      const next = jobs.find(
        (j) => j.status === "queued" || j.status === "interrupted",
      );
      if (!next) break;
      await startJob(next.id);
    }
    if (jobs.some((j) => j.status === "done")) {
      markUploadsCompleted();
    }
  } finally {
    batchRunning = false;
  }
}

export function useUploads() {
  // Server snapshot: nothing to render during prerender (the store is
  // client-only; listeners hydrate from localStorage on the client).
  return React.useSyncExternalStore(subscribeUploads, getUploads, () => []);
}

// resetIdle clears the list when nothing is in flight (called on dialog
// open): with no ongoing upload the dialog always starts fresh.
export function resetIdle() {
  const active = jobs.some(
    (j) => j.status === "uploading" || j.status === "queued" || j.status === "interrupted",
  );
  if (!active && jobs.length > 0) {
    jobs = [];
    files.clear();
    emit();
    persist();
  }
}

// clearUploads aborts every in-flight transfer and drops the whole queue.
export function clearUploads() {
  for (const [id, upload] of activeUploads) {
    upload.abort();
    void idbDelete(id);
  }
  activeUploads.clear();
  files.clear();
  jobs = [];
  emit();
  persist();
}

// clearAllUploads resets all upload jobs and memory state.
export function clearAllUploads() {
  for (const [, upload] of activeUploads.entries()) {
    upload.abort();
  }
  activeUploads.clear();
  jobs = [];
  files.clear();
  emit();
  persist();
}

// Test helper: clears the in-memory store (localStorage untouched).
export function __resetUploadStore() {
  jobs = [];
  files.clear();
  emit();
}
