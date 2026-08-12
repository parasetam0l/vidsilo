"use client";

import * as React from "react";
import {
  BarChart3Icon,
  GlobeIcon,
  HardDriveIcon,
  Save,
  SlidersHorizontalIcon,
} from "lucide-react";

import { api, type SettingsResponse } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/format";

interface GroupDef {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  keys: string[];
}

interface SettingSpec {
  label: string;
  hint: string;
  /** Pretty-formats the current value under the field (e.g. bytes). */
  pretty?: (v: number | string) => string;
}

const specs: Record<string, SettingSpec> = {
  site_name: {
    label: "Site Name",
    hint: "Shown in the admin UI and the browser title.",
  },
  default_lang: {
    label: "Default Language",
    hint: "Used when a viewer hasn't chosen a language.",
  },
  "upload.max_size_bytes": {
    label: "Max Upload Size",
    hint: "Largest allowed file per upload; anything larger is rejected.",
    pretty: (v) => `≈ ${formatBytes(Number(v))}`,
  },
  "upload.allowed_extensions": {
    label: "Allowed File Extensions",
    hint: "Comma-separated list; other extensions are rejected.",
  },
  "cache.enabled": {
    label: "Enable Disk Caching",
    hint: "Read-through cache in front of the media store.",
  },
  "cache.max_bytes": {
    label: "Max Cache Size",
    hint: "The cache evicts least-recently-used files beyond this.",
    pretty: (v) => `≈ ${formatBytes(Number(v))}`,
  },
  "transcode.concurrency": {
    label: "Parallel Encoders",
    hint: "How many videos transcode at once. 0 = CPU count − 1; each encoder needs ~1–2 GB RAM.",
  },
  "transcode.segment_seconds": {
    label: "HLS Segment Length",
    hint: "Shorter segments reduce start latency; longer ones reduce overhead.",
  },
  "transcode.gop_seconds": {
    label: "GOP Keyframe Interval",
    hint: "Keyframe frequency — usually 2s with 4s segments.",
  },
  "transcode.preset": {
    label: "Encoder Speed Preset",
    hint: "Faster = less CPU and larger files; slower = better compression.",
  },
  "analytics.enabled": {
    label: "Playback Analytics",
    hint: "Collects play, bandwidth and watch-time beacons.",
  },
  "analytics.retention_days": {
    label: "Data Retention (Days)",
    hint: "Beacon rows older than this are purged.",
  },
  "analytics.flush_interval_s": {
    label: "Flush Buffer Interval (Seconds)",
    hint: "How often buffered analytics are written to the database.",
  },
};

export default function SettingsPage() {
  const t = useT();
  const toast = useToast();
  const [activeTab, setActiveTab] = React.useState("general");

  const groups: GroupDef[] = [
    {
      id: "general",
      title: t("gGeneral"),
      description: t("gGeneralDesc"),
      icon: GlobeIcon,
      keys: ["site_name", "default_lang", "upload.max_size_bytes", "upload.allowed_extensions"],
    },
    {
      id: "storage",
      title: t("gStorage"),
      description: t("gStorageDesc"),
      icon: HardDriveIcon,
      keys: ["cache.enabled", "cache.max_bytes"],
    },
    {
      id: "transcoding",
      title: t("gTranscoding"),
      description: t("gTranscodingDesc"),
      icon: SlidersHorizontalIcon,
      keys: ["transcode.concurrency", "transcode.segment_seconds", "transcode.gop_seconds", "transcode.preset"],
    },
    {
      id: "analytics",
      title: t("gAnalytics"),
      description: t("gAnalyticsDesc"),
      icon: BarChart3Icon,
      keys: ["analytics.enabled", "analytics.retention_days", "analytics.flush_interval_s"],
    },
  ];

  const [data, setData] = React.useState<SettingsResponse | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    api<SettingsResponse>("/api/settings")
      .then(setData)
      .catch((e) => toast.error(e.message));
  }, [toast]);

  if (!data) {
    return (
      <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0 md:flex-row">
        <Skeleton className="h-64 w-full md:w-60 rounded-xl" />
        <Skeleton className="h-96 flex-1 rounded-xl" />
      </div>
    );
  }

  const s = data.settings;
  const str = (k: string) =>
    typeof s[k] === "string"
      ? (s[k] as string)
      : Array.isArray(s[k])
        ? (s[k] as string[]).join(", ")
        : String(s[k] ?? "");
  const num = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : 0);
  const bool = (k: string) => s[k] === true;

  async function saveGroup(keys: string[]) {
    setSaving(true);
    const patch: Record<string, unknown> = {};
    for (const k of keys) {
      const raw = s[k];
      if (typeof raw === "boolean") continue; // edited via switch instantly
      const v = str(k);
      if (Array.isArray(raw)) patch[k] = v.split(",").map((x) => x.trim()).filter(Boolean);
      else if (typeof raw === "number") patch[k] = Number(v);
      else patch[k] = v;
    }
    try {
      await api<{ updated: Record<string, unknown> }>("/api/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      const fresh = await api<SettingsResponse>("/api/settings");
      setData(fresh);
      toast.success(t("settingsSaved", { keys: Object.keys(patch).join(", ") }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    } finally {
      setSaving(false);
    }
  }

  async function setBool(key: string, value: boolean) {
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ [key]: value }) });
      const fresh = await api<SettingsResponse>("/api/settings");
      setData(fresh);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    }
  }

  const activeGroup = groups.find((g) => g.id === activeTab) ?? groups[0];

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
      <div className="flex flex-col gap-6 md:flex-row">
        {/* Navigation Sidebar */}
        <div className="w-full shrink-0 md:w-60">
          <Card className="p-2 shadow-xs">
            <nav className="flex flex-row gap-1 overflow-x-auto md:flex-col">
              {groups.map((g) => {
                const Icon = g.icon;
                const isActive = activeTab === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => setActiveTab(g.id)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-accent text-accent-foreground shadow-xs"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    }`}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{g.title}</span>
                  </button>
                );
              })}
            </nav>
          </Card>
        </div>

        {/* Content Pane */}
        <div className="flex-1">
          <Card className="relative overflow-hidden ">
            <div className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-primary/10 blur-3xl" />
            <CardHeader className="border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-xs">
                  <activeGroup.icon className="size-5" />
                </div>
                <div>
                  <CardTitle className="text-base font-semibold tracking-tight">{activeGroup.title}</CardTitle>
                  <CardDescription className="mt-0.5 text-sm">{activeGroup.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="flex flex-col gap-4">
                {activeGroup.keys.map((k) => {
                  const spec = specs[k] ?? { label: k, hint: "" };
                  const isBool = typeof s[k] === "boolean";
                  const isPreset = k === "transcode.preset";
                  const pretty =
                    spec.pretty && !isBool ? (
                      <span className="text-xs font-semibold text-primary">
                        {spec.pretty(typeof s[k] === "number" ? num(k) : str(k))}
                      </span>
                    ) : null;

                  return (
                    <div key={k} className="rounded-xl border bg-card p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 space-y-0.5">
                          <Label className="text-sm font-medium">{spec.label}</Label>
                          <p className="text-xs text-muted-foreground">{spec.hint}</p>
                          {pretty ? <div>{pretty}</div> : null}
                        </div>
                        {isBool ? (
                          <Switch checked={bool(k)} onCheckedChange={(v) => setBool(k, v)} />
                        ) : isPreset ? (
                          <Select
                            options={["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"].map((p) => ({
                              value: p,
                              label: p,
                            }))}
                            className="w-full sm:w-56 shrink-0 rounded-lg"
                            value={str(k)}
                            onChange={(v) => {
                              s[k] = v;
                              setData({ ...data });
                            }}
                          />
                        ) : (
                          <Input
                            defaultValue={typeof s[k] === "number" ? String(num(k)) : str(k)}
                            type={typeof s[k] === "number" ? "number" : "text"}
                            className="w-full sm:w-56 shrink-0 rounded-lg"
                            onChange={(e) => {
                              s[k] = typeof s[k] === "number" ? Number(e.target.value) : e.target.value;
                              setData({ ...data });
                            }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end border-t pt-4">
                <Button
                  disabled={saving}
                  className="gap-2 shadow-xs"
                  onClick={() => saveGroup(activeGroup.keys)}
                >
                  <Save className="size-4" />
                  {saving ? t("loading") : t("settingsSave", { group: activeGroup.title })}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
