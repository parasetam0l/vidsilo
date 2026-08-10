"use client";

import * as React from "react";
import { Plus, Save, Trash2 } from "lucide-react";

import { api, type Flavor } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

const blank = (): Flavor => ({
  id: 0,
  name: "",
  label: "",
  codec: "h264",
  height: 480,
  videoMode: "crf",
  crf: 23,
  videoBitrate: null,
  audioBitrate: 128,
  preset: "veryfast",
  enabled: false,
  position: 0,
});

export default function FlavorsPage() {
  const [flavors, setFlavors] = React.useState<Flavor[]>([]);
  const [editing, setEditing] = React.useState<Flavor | null>(null);

  const load = React.useCallback(() => {
    api<Flavor[]>("/api/flavors").then(setFlavors).catch(() => {});
  }, []);
  React.useEffect(load, [load]);

  async function save() {
    if (!editing) return;
    const body = {
      ...editing,
      videoBitrate: editing.videoMode === "bitrate" ? editing.videoBitrate : null,
      crf: editing.videoMode === "crf" ? editing.crf : null,
    };
    if (editing.id === 0) {
      await api<Flavor>("/api/flavors", { method: "POST", body: JSON.stringify(body) });
    } else {
      await api<Flavor>(`/api/flavors/${editing.id}`, { method: "PATCH", body: JSON.stringify(body) });
    }
    setEditing(null);
    load();
  }

  async function remove(f: Flavor) {
    await api<void>(`/api/flavors/${f.id}`, { method: "DELETE" });
    load();
  }

  async function toggle(f: Flavor) {
    await api<Flavor>(`/api/flavors/${f.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...f, enabled: !f.enabled }),
    });
    load();
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Flavors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Transcode renditions — only enabled flavors are built; flavors
            taller than the source are skipped
          </p>
        </div>
        <Button onClick={() => setEditing(blank())}>
          <Plus className="size-4" /> New flavor
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Enabled</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Codec</TableHead>
                <TableHead>Height</TableHead>
                <TableHead>Video</TableHead>
                <TableHead>Audio</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flavors.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <Switch checked={f.enabled} onCheckedChange={() => toggle(f)} />
                  </TableCell>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{f.codec}</Badge>
                  </TableCell>
                  <TableCell>{f.height}p</TableCell>
                  <TableCell className="text-muted-foreground">
                    {f.videoMode === "crf" ? `crf ${f.crf}` : `${f.videoBitrate}k`} · {f.preset}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{f.audioBitrate}k</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => setEditing({ ...f })}>
                      <Save className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(f)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={editing != null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit flavor" : "New flavor"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Name</label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Label</label>
                <Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Codec</label>
                <Select value={editing.codec} onValueChange={(v) => setEditing({ ...editing, codec: (v ?? "h264") as "h264" | "h265" })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="h264">H.264</SelectItem>
                    <SelectItem value="h265">H.265 (HEVC)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Height (px)</label>
                <Input
                  type="number"
                  value={editing.height}
                  onChange={(e) => setEditing({ ...editing, height: Number(e.target.value) })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Video mode</label>
                <Select
                  value={editing.videoMode}
                  onValueChange={(v) => setEditing({ ...editing, videoMode: (v ?? "crf") as "crf" | "bitrate" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="crf">CRF (quality)</SelectItem>
                    <SelectItem value="bitrate">Bitrate (kbps)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editing.videoMode === "crf" ? (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">CRF</label>
                  <Input
                    type="number"
                    step="0.5"
                    value={editing.crf ?? 23}
                    onChange={(e) => setEditing({ ...editing, crf: Number(e.target.value) })}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Bitrate (kbps)</label>
                  <Input
                    type="number"
                    value={editing.videoBitrate ?? 0}
                    onChange={(e) => setEditing({ ...editing, videoBitrate: Number(e.target.value) })}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Audio bitrate (kbps)</label>
                <Input
                  type="number"
                  value={editing.audioBitrate}
                  onChange={(e) => setEditing({ ...editing, audioBitrate: Number(e.target.value) })}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Preset</label>
                <Select value={editing.preset} onValueChange={(v) => setEditing({ ...editing, preset: v ?? "veryfast" })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"].map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button className="col-span-2" onClick={save}>
                <Save className="size-4" /> Save flavor
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
