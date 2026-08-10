"use client";

// Upload jobs at app level, persisted to localStorage: the pending list and
// tus upload URLs survive page navigation AND hard refreshes, so interrupted
// uploads can be resumed by re-selecting the same file. File objects are
// memory-only (they cannot be serialized); tus itself stores progress
// server-side, so resume only needs the upload URL.
import * as React from "react";
import * as tus from "tus-js-client";

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
}

const STORAGE_KEY = "vod-uploads";
const listeners = new Set<() => void>();
let doneListener: (() => void) | null = null;

let jobs: UploadJob[] = load();
const files = new Map<string, File>(); // id -> File (memory only)

function load(): UploadJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UploadJob[];
    // Anything in flight when the page reloaded is resumable, not lost.
    return parsed.map((j) =>
      j.status === "uploading" || j.status === "queued"
        ? { ...j, status: "interrupted" }
        : j,
    );
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

// setUploadDoneListener is invoked whenever an upload finishes, so pages can
// refresh their data.
export function setUploadDoneListener(cb: (() => void) | null) {
  doneListener = cb;
}

function defaultTitle(name: string) {
  return name.replace(/\.[^.]+$/, "");
}

export function addFiles(newFiles: File[]) {
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
      jobs = jobs.map((j) =>
        j.id === resumable.id ? { ...j, status: "queued" } : j,
      );
      emit();
      persist();
      continue;
    }
    if (
      jobs.some(
        (j) =>
          j.fileName === f.name &&
          j.fileSize === f.size &&
          j.status !== "done" &&
          j.status !== "failed",
      )
    ) {
      continue; // already queued
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
    jobs = [...jobs, job];
  }
  emit();
  persist();
}

export function updateJob(id: string, patch: Partial<UploadJob>) {
  jobs = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  emit();
  persist();
}

export function removeJob(id: string) {
  jobs = jobs.filter((j) => j.id !== id);
  files.delete(id);
  emit();
  persist();
}

export function startJob(id: string) {
  const job = jobs.find((j) => j.id === id);
  const file = files.get(id);
  if (!job || !file || job.status === "uploading" || job.status === "done") {
    return;
  }
  updateJob(id, { status: "uploading", error: undefined });

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
      updateJob(id, { progress: 100, status: "done" });
      doneListener?.();
    },
    onError: (err) => {
      updateJob(id, { status: "failed", error: err.message });
    },
  });
  upload.start();
}

export function startAll() {
  for (const job of jobs) {
    if (job.status === "queued" || job.status === "interrupted") {
      startJob(job.id);
    }
  }
}

export function useUploads() {
  return React.useSyncExternalStore(subscribeUploads, getUploads);
}
