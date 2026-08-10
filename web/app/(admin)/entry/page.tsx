"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Copy,
  Play,
  RotateCcw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";

import {
  api,
  ApiError,
  type AnalyticsResponse,
  type Category,
  type EntryDetail,
  type Flavor,
} from "@/lib/api";
import { formatBytes, formatDate, formatDuration, formatGb, formatWatchHours } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { SvgChart } from "@/components/svg-chart";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function EntryPage() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const [entry, setEntry] = React.useState<EntryDetail | null>(null);
  const [flavors, setFlavors] = React.useState<Flavor[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [ticked, setTicked] = React.useState<Set<number>>(new Set());
  const [analytics, setAnalytics] = React.useState<AnalyticsResponse | null>(null);

  React.useEffect(() => {
    if (!id) return;
    api<EntryDetail>(`/api/entries/${id}`)
      .then((e) => {
        setEntry(e);
        setTicked(
          new Set(e.flavors.filter((f) => f.status !== "skipped").map((f) => f.flavorId)),
        );
      })
      .catch((err) => setError(err.message));
    api<Flavor[]>("/api/flavors").then(setFlavors).catch(() => {});
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
    api<AnalyticsResponse>(`/api/entries/${id}/analytics`).then(setAnalytics).catch(() => {});
  }, [id]);

  if (!id) return <div className="p-4 text-sm text-muted-foreground">No entry selected.</div>;
  if (error) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!entry) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;

    const catName = categories.find((c) => c.id === entry.categoryId)?.name ?? "—";

  const saveMetadata = async () => {
    try {
      const updated = await api<EntryDetail>(`/api/entries/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: entry.title,
          description: entry.description,
          categoryId: entry.categoryId,
          isPublic: entry.isPublic,
        }),
      });
      setEntry(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "save failed");
    }
  }

  const reprocess = async () => {
    await api<void>(`/api/entries/${entry.id}/reprocess`, { method: "POST" }).catch((e) => setError(e.message));
    router.refresh();
  }

  const applyFlavors = async () => {
    await api<void>(`/api/entries/${entry.id}/flavors`, {
      method: "POST",
      body: JSON.stringify({ flavorIds: [...ticked] }),
    }).catch((e) => setError(e.message));
    router.refresh();
  }

  const deleteEntry = async () => {
    await api<void>(`/api/entries/${entry.id}`, { method: "DELETE" });
    router.push("/entries");
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {entry.title || "(untitled)"}
            </h1>
            <StatusBadge status={entry.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {catName} · {formatDuration(entry.durationMs)} ·{" "}
            {formatBytes(entry.sourceSize)} · uploaded {formatDate(entry.createdAt)}
            {entry.uploaderName ? ` by ${entry.uploaderName}` : ""}
          </p>
          {entry.error ? (
            <p className="mt-2 max-w-xl text-sm text-red-500">{entry.error}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reprocess}>
            <RotateCcw className="size-4" /> Reprocess
          </Button>
          <Button variant="outline" render={<a href={`/play/${entry.id}`} target="_blank" rel="noreferrer" />}>
            <Play className="size-4" /> Watch
          </Button>
          <Button variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      </div>

      {entry.status === "ready" && entry.posterKey ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/media/${entry.posterKey}`}
          alt="poster"
          className="aspect-video w-full max-w-xl rounded-xl border object-cover"
        />
      ) : null}

      <Tabs defaultValue="metadata">
        <TabsList>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
          <TabsTrigger value="flavors">Flavors</TabsTrigger>
          <TabsTrigger value="poster">Poster</TabsTrigger>
          <TabsTrigger value="subtitles">Subtitles</TabsTrigger>
          <TabsTrigger value="playback">Playback</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="metadata" className="mt-4 space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>Title</Label>
                  <Input
                    value={entry.title}
                    onChange={(e) => setEntry({ ...entry, title: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Category</Label>
                  <Select
                    value={entry.categoryId ? String(entry.categoryId) : "none"}
                    onValueChange={(v) =>
                      setEntry({ ...entry, categoryId: v === "none" ? null : Number(v) })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Description</Label>
                <Textarea
                  rows={4}
                  value={entry.description}
                  onChange={(e) =>
                    setEntry({ ...entry, description: e.target.value })
                  }
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={entry.isPublic}
                  onCheckedChange={(v) => setEntry({ ...entry, isPublic: v })}
                />
                <Label>Public (browseable without sign-in)</Label>
              </div>
              <Button onClick={saveMetadata}>
                <Save className="size-4" /> {saved ? "Saved" : "Save"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="flavors" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Renditions</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tick</TableHead>
                    <TableHead>Flavor</TableHead>
                    <TableHead>Codec</TableHead>
                    <TableHead>Height</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flavors.map((f) => {
                    const ef = entry.flavors.find((x) => x.flavorId === f.id);
                    return (
                      <TableRow key={f.id}>
                        <TableCell>
                          <Switch
                            checked={ticked.has(f.id)}
                            onCheckedChange={(v) => {
                              setTicked((prev) => {
                                const next = new Set(prev);
                                if (v) next.add(f.id);
                                else next.delete(f.id);
                                return next;
                              });
                            }}
                          />
                        </TableCell>
                        <TableCell>{f.name}</TableCell>
                        <TableCell className="text-muted-foreground">{f.codec}</TableCell>
                        <TableCell className="text-muted-foreground">{f.height}p</TableCell>
                        <TableCell>
                          {ef ? (
                            <Badge variant="outline">{ef.status}</Badge>
                          ) : (
                            <span className="text-muted-foreground">not ticked</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {ef?.status === "failed" ? ef.error : ef?.status === "skipped" ? ef.error : ""}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Button className="mt-4" onClick={applyFlavors}>
                Save flavors & reprocess
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="poster" className="mt-4">
          <PosterPicker entry={entry} onPicked={() => window.location.reload()} />
        </TabsContent>

        <TabsContent value="subtitles" className="mt-4">
          <SubtitlesTab entry={entry} />
        </TabsContent>

        <TabsContent value="playback" className="mt-4">
          <PlaybackTab entry={entry} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {analytics ? <AnalyticsTab data={analytics} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              The entry and all its media (original, renditions, posters,
              analytics) will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteEntry}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PosterPicker({
  entry,
  onPicked,
}: {
  entry: EntryDetail;
  onPicked: () => void;
}) {
  const [frame, setFrame] = React.useState(0);
  if (!entry.spriteKey || entry.spriteFrames === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          No sprite sheet yet — the probe job generates one. Reprocess the
          entry if it is ready and this is still empty.
        </CardContent>
      </Card>
    );
  }
  const sprite = `/media/${entry.spriteKey}`;
  const cols = 10;
  const rows = Math.ceil(entry.spriteFrames / cols);
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div
          className="relative aspect-video w-full max-w-xl overflow-hidden rounded-xl border bg-black"
          style={{
            backgroundImage: `url(${sprite})`,
            backgroundSize: `${cols * 100}% ${rows * 100}%`,
            backgroundPosition: `${(frame % cols) * (100 / (cols - 1))}% ${Math.floor(frame / cols) * (100 / (rows - 1))}%`,
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Label>Frame {frame}</Label>
          <Input
            type="range"
            min={0}
            max={entry.spriteFrames - 1}
            value={frame}
            onChange={(e) => setFrame(Number(e.target.value))}
            className="max-w-64"
          />
          <Button
            onClick={async () => {
              await api<void>(`/api/entries/${entry.id}/poster`, {
                method: "POST",
                body: JSON.stringify({ frame }),
              });
              onPicked();
            }}
          >
            Use as poster
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SubtitlesTab({ entry }: { entry: EntryDetail }) {
  const [lang, setLang] = React.useState("en");
  const [label, setLabel] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function uploadSubtitle(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("lang", lang);
    form.append("label", label || lang);
    await api(`/api/entries/${entry.id}/subtitles`, { method: "POST", body: form }).catch((e) => alert(e.message));
    window.location.reload();
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lang</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>File</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entry.subtitles.map((s) => (
              <TableRow key={s.id}>
                <TableCell>{s.lang}</TableCell>
                <TableCell>{s.label}</TableCell>
                <TableCell className="text-muted-foreground">{s.vttKey}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await api<void>(`/api/entries/${entry.id}/subtitles/${s.id}`, { method: "DELETE" });
                      window.location.reload();
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {entry.subtitles.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No subtitles
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label>Lang</Label>
            <Input className="w-24" value={lang} onChange={(e) => setLang(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Label</Label>
            <Input className="w-40" placeholder="English" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".vtt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadSubtitle(f);
            }}
          />
          <Button onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> Upload .vtt
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlaybackTab({ entry }: { entry: EntryDetail }) {
  const [policy, setPolicy] = React.useState(entry.embedPolicy);
  const [domains, setDomains] = React.useState(entry.embedDomains.join(", "));
  const [copied, setCopied] = React.useState(false);

  const embedUrl = `https://${typeof window !== "undefined" ? window.location.host : "localhost"}/embed/${entry.id}`;
  const snippet = `<iframe src="${embedUrl}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;

  async function save() {
    await api(`/api/entries/${entry.id}/embed`, {
      method: "PATCH",
      body: JSON.stringify({
        policy,
        domains: domains.split(",").map((d) => d.trim()).filter(Boolean),
      }),
    });
    window.location.reload();
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-2">
          <Label>Embed policy</Label>
          <Select value={policy} onValueChange={(v) => v && setPolicy(v)}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default (global)</SelectItem>
              <SelectItem value="*">Anywhere</SelectItem>
              <SelectItem value="same-origin">Same origin</SelectItem>
              <SelectItem value="allowlist">Allowlist</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {policy === "allowlist" || policy === "default" ? (
          <div className="flex flex-col gap-2">
            <Label>Allowed domains (comma separated, subdomains match)</Label>
            <Input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="example.com, other.org" />
          </div>
        ) : null}
        <Button onClick={save}>
          <Save className="size-4" /> Save policy
        </Button>
        <div className="flex flex-col gap-2">
          <Label>Embed snippet</Label>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs">
            {snippet}
          </pre>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(snippet);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              <Copy className="size-4" /> {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalyticsTab({ data }: { data: AnalyticsResponse }) {
  const plays = data.series.map((d) => ({ label: d.day, value: d.plays }));
  const watch = data.series.map((d) => ({
    label: d.day,
    value: Math.round(d.watchSeconds / 60),
  }));
  const bytes = data.series.map((d) => ({
    label: d.day,
    value: Number(formatGb(d.bytes)),
  }));
  const cards = [
    { title: "Plays", value: String(data.totals.plays) },
    { title: "Unique viewers", value: String(data.series.reduce((s, d) => s + d.uniqueViewers, 0)) },
    { title: "Watch time", value: `${formatWatchHours(data.totals.watchSeconds)} h` },
    { title: "Bandwidth", value: `${formatGb(data.totals.bytes)} GB` },
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Plays per day</CardTitle>
        </CardHeader>
        <CardContent>
          <SvgChart points={plays} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Watch minutes per day</CardTitle>
        </CardHeader>
        <CardContent>
          <SvgChart points={watch} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Bandwidth (GB) per day</CardTitle>
        </CardHeader>
        <CardContent>
          <SvgChart points={bytes} />
        </CardContent>
      </Card>
    </div>
  );
}
