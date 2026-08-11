"use client";

import * as React from "react";
import {
  BarChart3Icon,
  GlobeIcon,
  HardDriveIcon,
  LockIcon,
  Save,
  SlidersHorizontalIcon,
} from "lucide-react";

import { api, type SettingsResponse } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface GroupDef {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  keys: string[];
}

const labels: Record<string, string> = {
  site_name: "Site Name",
  default_lang: "Default Language",
  "upload.max_size_bytes": "Max Upload Size (Bytes)",
  "upload.allowed_extensions": "Allowed File Extensions",
  "cache.enabled": "Enable Disk Caching",
  "cache.max_bytes": "Max Cache Size (Bytes)",
  "transcode.concurrency": "Parallel Encoders (0 = CPU count − 1)",
  "transcode.segment_seconds": "HLS Segment Length (Seconds)",
  "transcode.gop_seconds": "GOP Keyframe Interval (Seconds)",
  "transcode.preset": "Encoder Speed Preset",
  "analytics.enabled": "Enable Playback Analytics",
  "analytics.retention_days": "Data Retention (Days)",
  "analytics.flush_interval_s": "Flush Buffer Interval (Seconds)",
  "tls.mode": "TLS Mode",
  "tls.acme_domains": "ACME Certificate Domains",
  "tls.cert_dir": "Certificate Storage Path",
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
    {
      id: "tls",
      title: t("gTls"),
      description: t("gTlsDesc"),
      icon: LockIcon,
      keys: ["tls.mode", "tls.acme_domains", "tls.cert_dir"],
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
      <div className="flex flex-1 flex-col gap-4 p-4 md:flex-row">
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
    <div className="flex flex-1 flex-col gap-4 p-4">
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
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-xs font-medium transition-all ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-xs"
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
          <Card className="relative overflow-hidden shadow-sm">
            <div className="pointer-events-none absolute -top-12 -right-12 size-40 rounded-full bg-primary/10 blur-3xl" />
            <CardHeader className="border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-xs">
                  <activeGroup.icon className="size-5" />
                </div>
                <div>
                  <CardTitle className="text-lg font-semibold tracking-tight">{activeGroup.title}</CardTitle>
                  <CardDescription className="text-xs mt-0.5">{activeGroup.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="grid gap-5 md:grid-cols-2">
                {activeGroup.keys.map((k) => {
                  const isBool = typeof s[k] === "boolean";
                  const isEnum = k === "tls.mode";
                  const isPreset = k === "transcode.preset";

                  if (isBool) {
                    return (
                      <div
                        key={k}
                        className="flex items-center justify-between rounded-xl border bg-muted/30 p-4 md:col-span-2"
                      >
                        <div className="space-y-0.5">
                          <label className="text-sm font-medium text-foreground">{labels[k] ?? k}</label>
                          <p className="text-xs text-muted-foreground">Toggle setting immediately across the system.</p>
                        </div>
                        <Switch checked={bool(k)} onCheckedChange={(v) => setBool(k, v)} />
                      </div>
                    );
                  }

                  return (
                    <div key={k} className="flex flex-col gap-2">
                      <label className="text-xs font-medium text-foreground">{labels[k] ?? k}</label>
                      {isEnum ? (
                        <Select
                          options={["off", "auto"].map((o) => ({ value: o, label: o.toUpperCase() }))}
                          className="w-full rounded-lg"
                          value={str(k)}
                          onChange={(v) => {
                            s[k] = v;
                            setData({ ...data });
                          }}
                        />
                      ) : isPreset ? (
                        <Select
                          options={["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"].map((p) => ({
                            value: p,
                            label: p,
                          }))}
                          className="w-full rounded-lg"
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
                          className="rounded-lg"
                          onChange={(e) => {
                            s[k] = typeof s[k] === "number" ? Number(e.target.value) : e.target.value;
                            setData({ ...data });
                          }}
                        />
                      )}
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
