export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "–";
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "–";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${y}-${m}-${d}`;
}

export function formatWatchHours(seconds: number): string {
  return (seconds / 3600).toFixed(1);
}

export function formatGb(bytes: number): string {
  return (bytes / (1024 ** 3)).toFixed(2);
}

export function viewerId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("vod-viewer-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("vod-viewer-id", id);
  }
  return id;
}
