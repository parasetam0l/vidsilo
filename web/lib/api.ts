export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "same-origin",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api<T>(
  path: string,
  init?: RequestInit,
  retried = false,
): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: init?.body
      ? { "Content-Type": "application/json", ...(init.headers ?? {}) }
      : init?.headers,
    ...init,
  });

  // Silent session renewal on 401: refresh the access token and retry once.
  // Only the login/refresh endpoints themselves are exempt (a 401 there
  // means bad credentials / a revoked session, not an expired token).
  const noRefresh =
    path.includes("/api/auth/login") || path.includes("/api/auth/refresh");

  if (res.status === 401 && !noRefresh && !retried) {
    if (await tryRefresh()) {
      return api<T>(path, init, true);
    }
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      (body as { error?: string }).error ?? "error",
      (body as { message?: string }).message ?? res.statusText,
    );
  }
  return body as T;
}

export type Role = "admin" | "editor" | "uploader" | "viewer";

export interface User {
  id: number;
  email: string;
  nameSurname: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export function displayName(u: Pick<User, "nameSurname" | "email">): string {
  return u.nameSurname || u.email;
}

export type EntryStatus =
  | "uploading"
  | "probing"
  | "transcoding"
  | "ready"
  | "failed";

export interface Entry {
  /** Public uuid — the only identifier the client ever sees. */
  id: string;
  categoryId: number | null;
  uploadedBy: number | null;
  title: string;
  description: string;
  status: EntryStatus;
  durationMs: number | null;
  sourceKey: string;
  sourceSize: number | null;
  isPublic: boolean;
  /** True = hidden from all viewers (editors/admins can still manage it). */
  accessDenied: boolean;
  /** null = "Allow All" (embed anywhere); otherwise references a DomainAcl. */
  domainAclId: number | null;
  /** Assigned player design id; null = the Default player. */
  playerId: number | null;
  posterKey: string;
  /** Sprite-frame index the current poster was extracted from. */
  posterFrame: number;
  spriteKey: string;
  spriteFrames: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntryDetail extends Entry {
  flavors: EntryFlavor[];
  subtitles: Subtitle[];
  uploaderName: string;
}

export interface EntryFlavor {
  entryId: number;
  flavorId: number;
  status: "pending" | "transcoding" | "done" | "failed" | "skipped";
  error?: string;
  playlistKey: string;
}

export interface Subtitle {
  id: number;
  lang: string;
  label: string;
  vttKey: string;
}

export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  position: number;
  children?: Category[];
}

export interface DomainAcl {
  id: number;
  title: string;
  whitelist: string[];
  blocklist: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Flavor {
  id: number;
  name: string;
  label: string;
  codec: "h264" | "h265";
  height: number;
  videoMode: "crf" | "bitrate";
  crf: number | null;
  videoBitrate: number | null;
  audioBitrate: number;
  preset: string;
  enabled: boolean;
  position: number;
}

export interface EntryList {
  items: Entry[];
  total: number;
  catalogTotal: number;
  page: number;
  limit: number;
}

export interface Dashboard {
  entriesByStatus: Record<string, number>;
  totalEntries: number;
  storageUsed: number;
  bandwidthTotalBytes: number;
  bandwidthTodayBytes: number;
  bandwidthSeries: { day: string; bytes: number }[];
  analyticsEnabled: boolean;
  queueDepth: number;
  recent: Entry[];
}

export interface AnalyticsResponse {
  totals: { plays: number; watchSeconds: number; bytes: number };
  series: {
    day: string;
    plays: number;
    watchSeconds: number;
    bytes: number;
    uniqueViewers: number;
  }[];
}

export interface PlayInfo {
  title: string;
  description: string;
  status: EntryStatus;
  durationMs: number | null;
  master?: string;
  poster?: string;
  sprite?: string;
  spriteFrames: number;
  subtitles: { lang: string; label: string; url: string }[];
  embedUrl: string;
  /** Resolved player design; absent = the Default look. */
  player?: PlayerConfig;
}

export interface PlayerConfig {
  accentColor?: string;
  logoUrl?: string;
  logoHref?: string;
  logoPosition?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  logoSize?: number;
  logoOpacity?: number;
  showLoader?: boolean;
  autoHideControls?: boolean;
}

export interface Player {
  id: number;
  name: string;
  isDefault: boolean;
  config: PlayerConfig;
  createdAt: string;
  updatedAt: string;
}

export interface UploadConfig {
  maxSizeBytes: number;
  allowedExtensions: string[];
}

export interface UploadActivity {
  id: string;
  entryId: number;
  title: string;
  uploader: string;
  size: number;
  offset: number;
  progress: number;
  createdAt: string;
}

export interface JobActivity {
  id: number;
  type: string;
  entryId: number | null;
  entryTitle: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  attempts: number;
  error?: string;
  /** Free-text progress line, e.g. "Transcoding 1080p-h264 (2/4)". */
  progress?: string;
  /** Flavor label for transcode jobs (from the job payload). */
  label?: string;
  /** True while the job is paused (queued but not claimable). */
  paused: boolean;
  createdAt: string;
}

export interface SettingsResponse {
  settings: Record<string, unknown>;
}

export interface StorageUsage {
  usedBytes: number;
  /** 0 when the backend has no known capacity (S3). */
  totalBytes: number;
  freeBytes: number;
  objectCount: number;
  driver: string;
}

export interface StorageEntryFile {
  label: "source" | "poster" | "flavors" | "subtitles" | "other" | "system";
  /** Flavor name for flavors rows; category for system rows. */
  name?: string;
  bytes: number;
  count: number;
}

export interface StorageEntry {
  publicId: string;
  title: string;
  status: EntryStatus;
  totalBytes: number;
  files: StorageEntryFile[];
}
