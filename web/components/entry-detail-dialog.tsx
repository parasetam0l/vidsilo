"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
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

// Opens the entry detail in a dialog (useDialog). The entries table and the
// dashboard open it; there is no dedicated detail page anymore.
export function useEntryDetailDialog() {
  const dialog = useDialog();
  return React.useCallback(
    (publicId: string) => {
      dialog.open({
        content: (close) => (
          <EntryDetailDialog publicId={publicId} onClose={close} />
        ),
        size: "4xl",
        dismissible: false,
        showCloseButton: true,
      });
    },
    [dialog],
  );
}

export function EntryDetailDialog({
  publicId,
  onClose,
}: {
  publicId: string;
  onClose: () => void;
}) {
  const t = useT();
  const { confirm } = useDialog();
  const toast = useToast();
  const router = useRouter();
  const [entry, setEntry] = React.useState<EntryDetail | null>(null);
  const [flavors, setFlavors] = React.useState<Flavor[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [ticked, setTicked] = React.useState<Set<number>>(new Set());
  const [analytics, setAnalytics] = React.useState<AnalyticsResponse | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  // Reload re-fetches everything after mutations (poster, subtitles, embed).
  const reload = React.useCallback(
    () => setReloadKey((k) => k + 1),
    [],
  );

  React.useEffect(() => {
    api<EntryDetail>(`/api/entries/${publicId}`)
      .then((e) => {
        setEntry(e);
        setTicked(
          new Set(e.flavors.filter((f) => f.status !== "skipped").map((f) => f.flavorId)),
        );
      })
      .catch((err) => toast.error(err.message));
    api<Flavor[]>("/api/flavors").then(setFlavors).catch(() => {});
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
    api<AnalyticsResponse>(`/api/entries/${publicId}/analytics`).then(setAnalytics).catch(() => {});
  }, [publicId, reloadKey, toast]);

  if (!entry) return <p className="text-sm text-muted-foreground">{t("loading")}</p>;

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
      toast.success(t("saved"));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : t("error"));
    }
  };

  const reprocess = async () => {
    try {
      await api<void>(`/api/entries/${entry.id}/reprocess`, { method: "POST" });
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    }
  };

  const applyFlavors = async () => {
    try {
      await api<void>(`/api/entries/${entry.id}/flavors`, {
        method: "POST",
        body: JSON.stringify({ flavorIds: [...ticked] }),
      });
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    }
  };

  const deleteEntry = async () => {
    try {
      await api<void>(`/api/entries/${entry.id}`, { method: "DELETE" });
      toast.success(t("deleted"));
      onClose();
      router.push("/entries");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
      throw e; // keep the confirm dialog open on failure
    }
  };

  const askDelete = () => {
    confirm({
      title: t("entryDeleteTitle"),
      description: t("entryDeleteDesc"),
      variant: "destructive",
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: deleteEntry,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4 pr-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold tracking-tight">
              {entry.title || t("untitled")}
            </h2>
            <StatusBadge status={entry.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("entryMetaLine", {
              category: catName,
              duration: formatDuration(entry.durationMs),
              size: formatBytes(entry.sourceSize),
              date: formatDate(entry.createdAt),
              by: entry.uploaderName ? ` by ${entry.uploaderName}` : "",
            })}
          </p>
          {entry.error ? (
            <p className="mt-2 max-w-xl text-sm text-amber-500">{entry.error}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reprocess}>
            <RotateCcw className="size-4" /> {t("entryReprocess")}
          </Button>
          <Button
            variant="outline"
            render={
              <a href={`/play/${entry.id}`} target="_blank" rel="noreferrer" />
            }
          >
            <Play className="size-4" /> {t("entryWatch")}
          </Button>
          <Button variant="destructive" onClick={askDelete}>
            <Trash2 className="size-4" /> {t("delete")}
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
          <TabsTrigger value="metadata">{t("tabMetadata")}</TabsTrigger>
          <TabsTrigger value="flavors">{t("tabFlavors")}</TabsTrigger>
          <TabsTrigger value="poster">{t("tabPoster")}</TabsTrigger>
          <TabsTrigger value="subtitles">{t("tabSubtitles")}</TabsTrigger>
          <TabsTrigger value="playback">{t("tabPlayback")}</TabsTrigger>
          <TabsTrigger value="analytics">{t("tabAnalytics")}</TabsTrigger>
        </TabsList>

        <TabsContent value="metadata" className="mt-4 space-y-4">
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label>{t("labelTitle")}</Label>
                  <Input
                    value={entry.title}
                    onChange={(e) => setEntry({ ...entry, title: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>{t("labelCategory")}</Label>
                  <Select
                    value={entry.categoryId ? String(entry.categoryId) : "none"}
                    onValueChange={(v) =>
                      setEntry({ ...entry, categoryId: v === "none" ? null : Number(v) })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("none")}</SelectItem>
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
                <Label>{t("labelDescription")}</Label>
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
                <Label>{t("labelPublic")}</Label>
              </div>
              <Button onClick={saveMetadata}>
                <Save className="size-4" /> {t("save")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="flavors" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t("tabFlavors")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("labelTick")}</TableHead>
                    <TableHead>{t("colFlavor")}</TableHead>
                    <TableHead>{t("colCodec")}</TableHead>
                    <TableHead>{t("colHeight")}</TableHead>
                    <TableHead>{t("colStatus")}</TableHead>
                    <TableHead>{t("colNote")}</TableHead>
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
                            <span className="text-muted-foreground">{t("notTicked")}</span>
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
                {t("saveFlavorsReprocess")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="poster" className="mt-4">
          <PosterPicker entry={entry} onPicked={reload} />
        </TabsContent>

        <TabsContent value="subtitles" className="mt-4">
          <SubtitlesTab entry={entry} onChanged={reload} />
        </TabsContent>

        <TabsContent value="playback" className="mt-4">
          <PlaybackTab entry={entry} onChanged={reload} />
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          {analytics ? (
            <AnalyticsTab data={analytics} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          )}
        </TabsContent>
      </Tabs>
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
  const t = useT();
  const toast = useToast();
  const [frame, setFrame] = React.useState(0);
  if (!entry.spriteKey || entry.spriteFrames === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          {t("noSprite")}
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
          <Label>{t("labelFrame", { n: frame })}</Label>
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
              toast.success(t("posterSaved"));
              onPicked();
            }}
          >
            {t("useAsPoster")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SubtitlesTab({
  entry,
  onChanged,
}: {
  entry: EntryDetail;
  onChanged: () => void;
}) {
  const t = useT();
  const { confirm } = useDialog();
  const toast = useToast();
  const [lang, setLang] = React.useState("en");
  const [label, setLabel] = React.useState("");
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function uploadSubtitle(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("lang", lang);
    form.append("label", label || lang);
    try {
      await api(`/api/entries/${entry.id}/subtitles`, { method: "POST", body: form });
      toast.success(t("subtitleUploaded"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow className="hover:bg-transparent">
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
                    onClick={() => {
                      confirm({
                        title: t("deleteSubtitleTitle"),
                        description: t("deleteSubtitleDesc"),
                        variant: "destructive",
                        confirmLabel: t("delete"),
                        cancelLabel: t("cancel"),
                        onConfirm: async () => {
                          await api<void>(`/api/entries/${entry.id}/subtitles/${s.id}`, { method: "DELETE" });
                          toast.success(t("deleted"));
                          onChanged();
                        },
                      });
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
                  {t("noSubtitles")}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-2">
            <Label>{t("labelLang")}</Label>
            <Input className="w-24" value={lang} onChange={(e) => setLang(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("labelSubtitleLabel")}</Label>
            <Input className="w-40" value={label} onChange={(e) => setLabel(e.target.value)} />
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
            <Upload className="size-4" /> {t("uploadVtt")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlaybackTab({
  entry,
  onChanged,
}: {
  entry: EntryDetail;
  onChanged: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [policy, setPolicy] = React.useState(entry.embedPolicy);
  const [domains, setDomains] = React.useState(entry.embedDomains.join(", "));
  const [copied, setCopied] = React.useState(false);

  const embedUrl = `https://${typeof window !== "undefined" ? window.location.host : "localhost"}/embed/${entry.id}`;
  const snippet = `<iframe src="${embedUrl}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;

  async function save() {
    try {
      await api(`/api/entries/${entry.id}/embed`, {
        method: "PATCH",
        body: JSON.stringify({
          policy,
          domains: domains.split(",").map((d) => d.trim()).filter(Boolean),
        }),
      });
      toast.success(t("saved"));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-2">
          <Label>{t("labelEmbedPolicy")}</Label>
          <Select value={policy} onValueChange={(v) => v && setPolicy(v)}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">{t("embedDefault")}</SelectItem>
              <SelectItem value="*">{t("embedAnywhere")}</SelectItem>
              <SelectItem value="same-origin">{t("embedSameOrigin")}</SelectItem>
              <SelectItem value="allowlist">{t("embedAllowlist")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {policy === "allowlist" || policy === "default" ? (
          <div className="flex flex-col gap-2">
            <Label>{t("allowedDomains")}</Label>
            <Input value={domains} onChange={(e) => setDomains(e.target.value)} />
          </div>
        ) : null}
        <Button onClick={save}>
          <Save className="size-4" /> {t("savePolicy")}
        </Button>
        <div className="flex flex-col gap-2">
          <Label>{t("embedSnippet")}</Label>
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
              <Copy className="size-4" /> {copied ? t("copied") : t("copy")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalyticsTab({ data }: { data: AnalyticsResponse }) {
  const t = useT();
  const series = data.series ?? [];
  const plays = series.map((d) => ({ label: d.day, value: d.plays }));
  const watch = series.map((d) => ({
    label: d.day,
    value: Math.round(d.watchSeconds / 60),
  }));
  const bytes = series.map((d) => ({
    label: d.day,
    value: Number(formatGb(d.bytes)),
  }));
  const cards = [
    { title: t("statPlays"), value: String(data.totals.plays) },
    { title: t("statViewers"), value: String(series.reduce((s, d) => s + d.uniqueViewers, 0)) },
    { title: t("statWatchTime"), value: `${formatWatchHours(data.totals.watchSeconds)} h` },
    { title: t("statBandwidth"), value: `${formatGb(data.totals.bytes)} GB` },
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
          <CardTitle>{t("chartPlays")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SvgChart points={plays} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("chartWatch")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SvgChart points={watch} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("chartBandwidth")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SvgChart points={bytes} />
        </CardContent>
      </Card>
    </div>
  );
}
