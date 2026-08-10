import { beforeEach, describe, expect, it, vi } from "vitest";

// The upload store persists to localStorage and uses IndexedDB for blobs;
// both are shimmed in jsdom (IDB via the fake-indexeddb-compatible mock
// below is replaced with a no-op since blob restore is covered by startJob
// paths that we intentionally don't drive network on).
vi.mock("@/lib/idb", () => ({
  idbPut: vi.fn(async () => {}),
  idbGet: vi.fn(async () => null),
  idbDelete: vi.fn(async () => {}),
}));

import {
  __resetUploadStore,
  addFiles,
  getUploads,
  removeJob,
  startJob,
  updateJob,
} from "@/lib/upload-store";

function file(name: string, size = 10): File {
  return new File([new Uint8Array(size)], name, { type: "video/mp4" });
}

describe("upload-store", () => {
  beforeEach(() => {
    localStorage.clear();
    __resetUploadStore();
  });

  it("adds files as queued jobs with defaults", () => {
    addFiles([file("movie.mp4")]);
    const jobs = getUploads();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].fileName).toBe("movie.mp4");
    expect(jobs[0].title).toBe("movie");
    expect(jobs[0].status).toBe("queued");
    expect(jobs[0].progress).toBe(0);
  });

  it("dedupes identical queued files", () => {
    addFiles([file("a.mp4"), file("a.mp4")]);
    expect(getUploads()).toHaveLength(1);
  });

  it("persists jobs to localStorage and restores them as interrupted", async () => {
    addFiles([file("a.mp4")]);
    updateJob(getUploads()[0].id, { status: "uploading", progress: 42 });

    // Simulate a reload: fresh module instance reading the same localStorage.
    __resetUploadStore();
    vi.resetModules();
    const reloaded = await import("@/lib/upload-store");
    const jobs = reloaded.getUploads();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("interrupted");
    expect(jobs[0].progress).toBe(42);
    expect(jobs[0].uploadUrl).toBeUndefined();
  });

  it("remaps an interrupted job to resumable when the same file is re-added", () => {
    addFiles([file("a.mp4")]);
    const id = getUploads()[0].id;
    updateJob(id, { status: "interrupted", uploadUrl: "/upload/abc" });

    addFiles([file("a.mp4")]);
    const jobs = getUploads();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(id);
    expect(jobs[0].status).toBe("queued");
  });

  it("updateJob patches fields immutably", () => {
    addFiles([file("a.mp4")]);
    const id = getUploads()[0].id;
    updateJob(id, { title: "Renamed" });
    expect(getUploads()[0].title).toBe("Renamed");
  });

  it("removeJob drops the job", () => {
    addFiles([file("a.mp4")]);
    removeJob(getUploads()[0].id);
    expect(getUploads()).toHaveLength(0);
  });

  it("startJob on an unknown id is a no-op and does not throw", async () => {
    await expect(startJob("missing")).resolves.toBeUndefined();
  });
});
