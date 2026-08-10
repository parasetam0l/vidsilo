"use client";

import * as React from "react";
import { Save } from "lucide-react";

import { api, type SettingsResponse } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GroupDef {
  title: string;
  description: string;
  keys: string[];
}

const groups: GroupDef[] = [
  {
    title: "General",
    description: "Site identity and upload rules",
    keys: ["site_name", "default_lang", "upload.max_size_bytes", "upload.allowed_extensions"],
  },
  {
    title: "Storage",
    description: "S3 read-through cache settings",
    keys: ["cache.enabled", "cache.max_bytes"],
  },
  {
    title: "Transcoding",
    description: "Pipeline tuning — applies to newly processed entries",
    keys: ["transcode.concurrency", "transcode.segment_seconds", "transcode.gop_seconds", "transcode.preset"],
  },
  {
    title: "Analytics",
    description: "Beacon collection and retention",
    keys: ["analytics.enabled", "analytics.retention_days", "analytics.flush_interval_s"],
  },
  {
    title: "Playback",
    description: "Global default embed policy",
    keys: ["embed.default_policy", "embed.default_allowlist"],
  },
  {
    title: "TLS",
    description: "Auto-HTTPS via Let's Encrypt — restart required",
    keys: ["tls.mode", "tls.acme_domains", "tls.cert_dir"],
  },
];

const labels: Record<string, string> = {
  site_name: "Site name",
  default_lang: "Default language",
  "upload.max_size_bytes": "Max upload size (bytes)",
  "upload.allowed_extensions": "Allowed extensions (comma separated)",
  "cache.enabled": "Disk cache enabled",
  "cache.max_bytes": "Cache size (bytes)",
  "transcode.concurrency": "Parallel encodes (0 = CPU count − 1)",
  "transcode.segment_seconds": "Segment length (s)",
  "transcode.gop_seconds": "GOP / keyframe interval (s)",
  "transcode.preset": "x264/x265 preset",
  "analytics.enabled": "Analytics enabled",
  "analytics.retention_days": "Retention (days)",
  "analytics.flush_interval_s": "Flush interval (s)",
  "embed.default_policy": "Default embed policy",
  "embed.default_allowlist": "Default allowlist (comma separated)",
  "tls.mode": "TLS mode",
  "tls.acme_domains": "ACME domains (comma separated)",
  "tls.cert_dir": "Certificate directory",
};

export default function SettingsPage() {
  const [data, setData] = React.useState<SettingsResponse | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api<SettingsResponse>("/api/settings").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="p-4 text-sm text-red-500">{error}</p>;
  if (!data) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;

  const s = data.settings;
  const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : Array.isArray(s[k]) ? (s[k] as string[]).join(", ") : String(s[k] ?? ""));
  const num = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : 0);
  const bool = (k: string) => s[k] === true;

  async function saveGroup(keys: string[]) {
    setError(null);
    const patch: Record<string, unknown> = {};
    for (const k of keys) {
      const raw = s[k];
      if (typeof raw === "boolean") continue; // edited via switch below
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
      setSaved(`Saved ${Object.keys(patch).join(", ")}`);
      setTimeout(() => setSaved(null), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  }

  async function setBool(key: string, value: boolean) {
    await api("/api/settings", { method: "PATCH", body: JSON.stringify({ [key]: value }) });
    const fresh = await api<SettingsResponse>("/api/settings");
    setData(fresh);
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      {data.restartRequired.length > 0 ? (
        <Alert>
          <AlertTitle>Restart required</AlertTitle>
          <AlertDescription>
            Changes to {data.restartRequired.join(", ")} take effect after the
            server restarts (Docker: <code>docker compose restart app</code>).
          </AlertDescription>
        </Alert>
      ) : null}
      {saved ? (
        <Alert>
          <AlertDescription>{saved}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {groups.map((g) => (
        <Card key={g.title}>
          <CardHeader>
            <CardTitle>{g.title}</CardTitle>
            <CardDescription>{g.description}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {g.keys.map((k) => {
              const isBool = typeof s[k] === "boolean";
              const isEnum = k === "embed.default_policy" || k === "tls.mode";
              return (
                <div key={k} className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">{labels[k] ?? k}</label>
                  {isBool ? (
                    <Switch checked={bool(k)} onCheckedChange={(v) => setBool(k, v)} />
                  ) : isEnum ? (
                    <Select
                      value={str(k)}
                      onValueChange={(v) => {
                        s[k] = v;
                        setData({ ...data });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {k === "embed.default_policy"
                          ? ["*", "same-origin", "allowlist"].map((o) => (
                              <SelectItem key={o} value={o}>{o}</SelectItem>
                            ))
                          : ["off", "auto"].map((o) => (
                              <SelectItem key={o} value={o}>{o}</SelectItem>
                            ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      defaultValue={typeof s[k] === "number" ? String(num(k)) : str(k)}
                      type={typeof s[k] === "number" ? "number" : "text"}
                      onChange={(e) => {
                        s[k] = typeof s[k] === "number" ? Number(e.target.value) : e.target.value;
                        setData({ ...data });
                      }}
                    />
                  )}
                </div>
              );
            })}
            <div className="md:col-span-2">
              <Button onClick={() => saveGroup(g.keys)}>
                <Save className="size-4" /> Save {g.title}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
