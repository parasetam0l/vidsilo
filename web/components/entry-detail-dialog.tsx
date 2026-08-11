"use client";

import * as React from "react";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth-provider";
import {
  BarChart3Icon,
  CaptionsIcon,
  CheckIcon,
  CopyIcon,
  FilmIcon,
  ImageIcon,
  InfoIcon,
  Link2Icon,
  PencilLineIcon,
  PlayIcon,
  RotateCcwIcon,
  SaveIcon,
  Trash2Icon,
  UploadIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";

import {
  api,
  type AnalyticsResponse,
  type Category,
  type DomainAcl,
  type EntryDetail,
  type Flavor,
  type PlayInfo,
} from "@/lib/api";
import { formatBytes, formatDate, formatDuration, formatGb, formatWatchHours } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { VODPlayer } from "@/components/vod-player";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { SvgChart } from "@/components/svg-chart";

// Opens the entry detail in a high-end modal dialog: section navigation
// on the left, header + scrollable content pane on the right.
export function useEntryDetailDialog() {
  const dialog = useDialog();
  return React.useCallback(
    (publicId: string) => {
      dialog.open({
        content: (close) => (
          <EntryDetailDialog publicId={publicId} onClose={close} />
        ),
        size: "5xl",
        className: "p-0 overflow-hidden md:max-w-[1000px] h-[85vh] max-h-[750px] flex flex-col rounded-2xl border border-border/80 shadow-2xl bg-background",
        dismissible: false,
        showCloseButton: true,
      });
    },
    [dialog],
  );
}

export function EntryDetailDialog({
  publicId,
}: {
  publicId: string;
  onClose: () => void;
}) {
  const t = useT();
  const { confirm } = useDialog();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [entry, setEntry] = React.useState<EntryDetail | null>(null);
  const [flavors, setFlavors] = React.useState<Flavor[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [ticked, setTicked] = React.useState<Set<number>>(new Set());
  const [analytics, setAnalytics] = React.useState<AnalyticsResponse | null>(null);
  const [acls, setAcls] = React.useState<DomainAcl[]>([]);
  const [aclId, setAclId] = React.useState<number | null>(null);
  const [base, setBase] = React.useState<{
    title: string;
    description: string;
    categoryId: number | null;
    isPublic: boolean;
    domainAclId: number | null;
    ticked: Set<number>;
  } | null>(null);
  const [posterFrame, setPosterFrame] = React.useState(0);
  const [posterTouched, setPosterTouched] = React.useState(false);
  const [preview, setPreview] = React.useState<PlayInfo | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [active, setActive] = React.useState("metadata");

  const reload = React.useCallback(() => setReloadKey((k) => k + 1), []);

  React.useEffect(() => {
    api<EntryDetail>(`/api/entries/${publicId}`)
      .then((e) => {
        setEntry(e);
        setAclId(e.domainAclId);
        const tick = new Set(
          e.flavors.filter((f) => f.status !== "skipped").map((f) => f.flavorId),
        );
        setTicked(tick);
        setPosterFrame(0);
        setPosterTouched(false);
        setPreview(null);
        setBase({
          title: e.title,
          description: e.description,
          categoryId: e.categoryId,
          isPublic: e.isPublic,
          domainAclId: e.domainAclId,
          ticked: tick,
        });
      })
      .catch((err) => toast.error(err.message));
    api<Flavor[]>("/api/flavors").then(setFlavors).catch(() => {});
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
    api<DomainAcl[]>("/api/acls").then(setAcls).catch(() => {});
    api<AnalyticsResponse>(`/api/entries/${publicId}/analytics`).then(setAnalytics).catch(() => {});
  }, [publicId, reloadKey, toast]);

  const sections = [
    { id: "metadata", label: t("tabMetadata"), icon: <PencilLineIcon className="size-4" /> },
    { id: "flavors", label: t("tabFlavors"), icon: <VideoIcon className="size-4" /> },
    { id: "poster", label: t("tabPoster"), icon: <ImageIcon className="size-4" /> },
    { id: "subtitles", label: t("tabSubtitles"), icon: <CaptionsIcon className="size-4" /> },
    { id: "playback", label: t("tabPlayback"), icon: <Link2Icon className="size-4" /> },
    { id: "analytics", label: t("tabAnalytics"), icon: <BarChart3Icon className="size-4" /> },
  ];

  if (!entry) {
    return (
      <SidebarProvider className="!min-h-0 h-full w-full flex-1 flex overflow-hidden">
        <Sidebar collapsible="none" className="hidden w-52 border-r bg-muted/20 md:flex">
          <SidebarContent>
            <SidebarGroup className="p-3">
              <SidebarGroupContent>
                <SidebarMenu className="gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <SidebarMenuItem key={i}>
                      <div className="flex h-9 items-center gap-2 px-3">
                        <Skeleton className="size-4 rounded-md" />
                        <Skeleton className="h-4 w-24 rounded-md" />
                      </div>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <main className="flex flex-1 flex-col h-full min-h-0 overflow-hidden bg-background">
          <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-6 pr-12">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-48 rounded-md" />
              <Skeleton className="h-3 w-64 rounded-md" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-24 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>
          <div className="flex-1 space-y-6 overflow-hidden p-6">
            <Skeleton className="h-48 w-full rounded-2xl" />
            <Skeleton className="h-36 w-full rounded-2xl" />
          </div>
        </main>
      </SidebarProvider>
    );
  }

  const catName = categories.find((c) => c.id === entry.categoryId)?.name ?? "—";

  const setsEqual = (a: Set<number>, b: Set<number>) =>
    a.size === b.size && [...a].every((v) => b.has(v));

  const isDirty = !!base && (
    entry.title !== base.title ||
    entry.description !== base.description ||
    entry.categoryId !== base.categoryId ||
    entry.isPublic !== base.isPublic ||
    aclId !== base.domainAclId ||
    posterTouched ||
    !setsEqual(ticked, base.ticked)
  );

  const buildChanges = (): string[] => {
    if (!base) return [];
    const items: string[] = [];
    const truncate = (s: string) => (s.length > 50 ? `${s.slice(0, 50)}…` : s);
    if (entry.title !== base.title) {
      items.push(`${t("chgTitle")}: ${base.title || "—"} → ${entry.title || "—"}`);
    }
    if (entry.description !== base.description) {
      items.push(`${t("chgDesc")}: ${truncate(base.description) || "—"} → ${truncate(entry.description)}`);
    }
    if (entry.categoryId !== base.categoryId) {
      const name = (id: number | null) =>
        id == null ? t("none") : categories.find((c) => c.id === id)?.name ?? String(id);
      items.push(`${t("chgCategory")}: ${name(base.categoryId)} → ${name(entry.categoryId)}`);
    }
    if (entry.isPublic !== base.isPublic) {
      items.push(
        `${t("chgVisibility")}: ${base.isPublic ? t("visibilityPublic") : t("visibilityPrivate")} → ${entry.isPublic ? t("visibilityPublic") : t("visibilityPrivate")}`,
      );
    }
    if (aclId !== base.domainAclId) {
      const name = (id: number | null) =>
        id == null ? t("allowAll") : acls.find((a) => a.id === id)?.title ?? String(id);
      items.push(`${t("chgAcl")}: ${name(base.domainAclId)} → ${name(aclId)}`);
    }
    if (!setsEqual(ticked, base.ticked)) {
      const name = (id: number) => flavors.find((f) => f.id === id)?.name ?? String(id);
      const added = [...ticked].filter((v) => !base.ticked.has(v)).map(name);
      const removed = [...base.ticked].filter((v) => !ticked.has(v)).map(name);
      if (added.length) items.push(`${t("chgFlavors")}: +${added.join(", ")}`);
      if (removed.length) items.push(`${t("chgFlavors")}: -${removed.join(", ")}`);
    }
    if (posterTouched) {
      items.push(`${t("chgPoster")}: ${t("chgPosterFrame", { n: posterFrame })}`);
    }
    return items;
  };

  const save = () => {
    const changes = buildChanges();
    if (changes.length === 0 || !base) return;
    confirm({
      title: t("changesTitle"),
      description: t("changesDesc"),
      body: (
        <ul className="flex flex-col gap-1.5 py-2 text-sm">
          {changes.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-muted-foreground">•</span>
              <span className="break-words">{c}</span>
            </li>
          ))}
        </ul>
      ),
      confirmLabel: t("save"),
      cancelLabel: t("cancel"),
      onConfirm: async () => {
        const body: Record<string, unknown> = {
          title: entry.title,
          description: entry.description,
          categoryId: entry.categoryId,
          isPublic: entry.isPublic,
          domainAclId: aclId,
        };
        if (!setsEqual(ticked, base.ticked)) {
          body.flavorIds = [...ticked];
        }
        if (posterTouched) {
          body.posterFrame = posterFrame;
        }
        await api<void>(`/api/entries/${entry.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        reload();
        toast.success(t("saved"));
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : t("error")),
    });
  };

  const reprocess = async () => {
    try {
      await api<void>(`/api/entries/${entry.id}/reprocess`, { method: "POST" });
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    }
  };

  return (
    <SidebarProvider className="!min-h-0 h-full w-full flex-1 flex overflow-hidden">
      {/* Sidebar Navigation */}
      <Sidebar collapsible="none" className="hidden w-52 shrink-0 border-r bg-muted/20 md:flex">
        <SidebarContent className="p-3">
          <div className="mb-3 px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
            Entry Settings
          </div>
          <SidebarGroup className="p-0">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {sections.map((s) => (
                  <SidebarMenuItem key={s.id}>
                    <SidebarMenuButton
                      isActive={active === s.id}
                      className={
                        active === s.id
                          ? "bg-accent text-accent-foreground font-medium shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }
                      render={
                        <button type="button" onClick={() => setActive(s.id)} />
                      }
                    >
                      {s.icon}
                      <span>{s.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      {/* Mobile Horizontal Section Chips */}
      <div className="flex gap-1.5 overflow-x-auto border-b bg-muted/20 p-2.5 md:hidden">
        {sections.map((s) => (
          <Button
            key={s.id}
            variant={active === s.id ? "default" : "outline"}
            size="sm"
            className="rounded-lg text-xs"
            onClick={() => setActive(s.id)}
          >
            {s.icon} {s.label}
          </Button>
        ))}
      </div>

      <main className="flex flex-1 flex-col h-full min-h-0 overflow-hidden bg-background">
        {/* Top Header */}
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-6 pr-12 bg-background/80 backdrop-blur-xs">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="truncate text-base font-semibold tracking-tight text-foreground">
                {entry.title || t("untitled")}
              </h2>
              <StatusBadge status={entry.status} />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span>{catName}</span>
              <span>•</span>
              <span>{formatDuration(entry.durationMs)}</span>
              <span>•</span>
              <span>{formatBytes(entry.sourceSize)}</span>
              <span>•</span>
              <span>{formatDate(entry.createdAt)}</span>
              {entry.uploaderName ? <span>by {entry.uploaderName}</span> : null}
            </div>
          </div>
        </header>

        {entry.error ? (
          <div className="shrink-0 border-b bg-amber-500/10 px-6 py-2.5 text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-2">
            <InfoIcon className="size-4 shrink-0" />
            <span>{entry.error}</span>
          </div>
        ) : null}

        {/* Scrollable Main Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
          {active === "metadata" ? (
            <div className="space-y-6 max-w-4xl">
              {entry.status === "ready" && entry.posterKey ? (
                preview ? (
                  <div className="relative overflow-hidden rounded-2xl border bg-black/80 shadow-md">
                    <VODPlayer info={preview} publicId={entry.id} autoplay />
                    <button
                      type="button"
                      onClick={() => setPreview(null)}
                      aria-label={t("close")}
                      className="absolute top-3 right-3 grid size-8 place-items-center rounded-full bg-black/60 text-white/90 opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="group relative block w-full overflow-hidden rounded-2xl border bg-black/80 shadow-md text-left"
                    onClick={() => {
                      api<PlayInfo>(`/play/${entry.id}/playinfo.json`)
                        .then(setPreview)
                        .catch((e) => toast.error(e instanceof Error ? e.message : t("error")));
                    }}
                    aria-label={t("entryWatch")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/media/${entry.posterKey}?v=${encodeURIComponent(entry.updatedAt)}`}
                      alt="poster"
                      className="aspect-video max-h-60 w-full object-contain mx-auto transition-transform duration-300 group-hover:scale-102"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent flex items-end p-4">
                      <span className="text-xs font-medium text-white/90 bg-black/40 backdrop-blur-md px-2.5 py-1 rounded-full border border-white/10">
                        {formatDuration(entry.durationMs)}
                      </span>
                    </div>
                    <div className="absolute inset-0 grid place-items-center bg-black/0 transition-colors group-hover:bg-black/30">
                      <span className="grid size-14 place-items-center rounded-full bg-white/90 text-black opacity-0 shadow-lg transition-all group-hover:opacity-100">
                        <PlayIcon className="ml-0.5 size-6 fill-current" />
                      </span>
                    </div>
                  </button>
                )
              ) : null}

              <Card className="rounded-2xl border shadow-xs">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <PencilLineIcon className="size-4 text-primary" />
                    {t("tabMetadata")}
                  </CardTitle>
                  <CardDescription>
                    Configure basic video parameters, category assignment and visibility.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-5 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                      <Label className="text-xs font-medium">{t("labelTitle")}</Label>
                      <Input
                        value={entry.title}
                        className="rounded-lg"
                        onChange={(e) => setEntry({ ...entry, title: e.target.value })}
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label className="text-xs font-medium">{t("labelCategory")}</Label>
                      <Select
                        options={[
                          { value: "none", label: t("none") },
                          ...categories.map((c) => ({ value: String(c.id), label: c.name })),
                        ]}
                        className="w-full rounded-lg"
                        value={entry.categoryId ? String(entry.categoryId) : "none"}
                        onChange={(v) =>
                          setEntry({ ...entry, categoryId: v === "none" ? null : Number(v) })
                        }
                      />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-medium">{t("labelDescription")}</Label>
                    <Textarea
                      rows={4}
                      className="rounded-lg resize-none"
                      value={entry.description}
                      onChange={(e) =>
                        setEntry({ ...entry, description: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-4">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-medium">{t("labelPublic")}</Label>
                      <p className="text-xs text-muted-foreground">
                        Allow video playback across public embeds without authentication.
                      </p>
                    </div>
                    <Switch
                      checked={entry.isPublic}
                      onCheckedChange={(v) => setEntry({ ...entry, isPublic: v })}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {active === "flavors" ? (
            <div className="space-y-4 max-w-4xl">
              <Card className="rounded-2xl border shadow-xs">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base font-medium flex items-center gap-2">
                    <VideoIcon className="size-4 text-primary" />
                    {t("tabFlavors")}
                  </CardTitle>
                  <CardDescription>
                    Enable or disable specific resolution renditions for adaptive bit-rate playback.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="overflow-hidden rounded-xl border">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-16">{t("labelTick")}</TableHead>
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
                            <TableRow key={f.id} className="hover:bg-muted/30">
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
                              <TableCell className="font-medium">{f.name}</TableCell>
                              <TableCell>
                                <Badge variant="secondary" className="text-[10px] font-mono">
                                  {f.codec}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-muted-foreground">{f.height}p</TableCell>
                              <TableCell>
                                {ef ? (
                                  <Badge
                                    variant={ef.status === "done" ? "default" : ef.status === "failed" ? "destructive" : "outline"}
                                    className="capitalize text-xs font-normal"
                                  >
                                    {ef.status}
                                  </Badge>
                                ) : (
                                  <span className="text-xs text-muted-foreground">{t("notTicked")}</span>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {ef?.status === "failed" ? ef.error : ef?.status === "skipped" ? ef.error : ""}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                    <InfoIcon className="size-3.5 shrink-0 text-muted-foreground" />
                    <span>{t("flavorsSaveHint")}</span>
                  </div>
                  {isAdmin ? (
                    <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-3">
                      <div className="space-y-0.5">
                        <Label className="text-sm font-medium">{t("entryReprocess")}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t("reprocessHint")}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 gap-1.5 text-xs rounded-lg"
                        onClick={reprocess}
                      >
                        <RotateCcwIcon className="size-3.5" /> {t("entryReprocess")}
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {active === "poster" ? (
            <div className="max-w-4xl">
              <PosterPicker
                entry={entry}
                frame={posterFrame}
                onFrameChange={(n) => {
                  setPosterFrame(n);
                  setPosterTouched(true);
                }}
              />
            </div>
          ) : null}

          {active === "subtitles" ? (
            <div className="max-w-4xl">
              <SubtitlesTab entry={entry} onChanged={reload} />
            </div>
          ) : null}

          {active === "playback" ? (
            <div className="max-w-4xl">
              <PlaybackTab
                entry={entry}
                aclId={aclId}
                acls={acls}
                onAclChange={setAclId}
              />
            </div>
          ) : null}

          {active === "analytics" ? (
            <div className="max-w-4xl">
              {analytics ? (
                <AnalyticsTab data={analytics} />
              ) : (
                <div className="flex h-48 items-center justify-center rounded-2xl border bg-card text-sm text-muted-foreground">
                  {t("loading")}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Unsaved Changes Bar */}
        {isDirty ? (
          <footer className="flex shrink-0 items-center justify-between gap-4 border-t bg-amber-500/5 dark:bg-amber-500/10 px-6 py-3">
            <div className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
              </span>
              <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                {t("unsavedChanges")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs rounded-lg"
                onClick={() => {
                  if (base) {
                    setEntry({
                      ...entry,
                      title: base.title,
                      description: base.description,
                      categoryId: base.categoryId,
                      isPublic: base.isPublic,
                    });
                    setAclId(base.domainAclId);
                    setTicked(base.ticked);
                  }
                }}
              >
                Reset
              </Button>
              <Button size="sm" className="h-8 gap-1.5 text-xs rounded-lg shadow-sm" onClick={save}>
                <SaveIcon className="size-3.5" /> {t("save")}
              </Button>
            </div>
          </footer>
        ) : null}
      </main>
    </SidebarProvider>
  );
}

function PosterPicker({
  entry,
  frame,
  onFrameChange,
}: {
  entry: EntryDetail;
  frame: number;
  onFrameChange: (n: number) => void;
}) {
  const t = useT();

  if (!entry.spriteKey || entry.spriteFrames === 0) {
    return (
      <Card className="rounded-2xl border shadow-xs">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <ImageIcon className="size-4 text-primary" />
            {t("tabPoster")}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground pb-6">
          {t("noSprite")}
        </CardContent>
      </Card>
    );
  }

  const sprite = `/media/${entry.spriteKey}`;
  const cols = 10;
  const rows = Math.max(1, Math.ceil(entry.spriteFrames / cols));
  const rowStep = rows > 1 ? 100 / (rows - 1) : 0;

  return (
    <Card className="rounded-2xl border shadow-xs">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <ImageIcon className="size-4 text-primary" />
          {t("tabPoster")}
        </CardTitle>
        <CardDescription>
          {t("posterScrubHint")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="relative overflow-hidden rounded-2xl border bg-black/90 shadow-inner flex items-center justify-center p-2">
          <div
            className="aspect-video w-full max-w-2xl rounded-xl border border-white/10"
            style={{
              backgroundImage: `url(${sprite})`,
              backgroundSize: `${cols * 100}% ${rows * 100}%`,
              backgroundPosition: `${(frame % cols) * (100 / (cols - 1))}% ${Math.floor(frame / cols) * rowStep}%`,
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-muted/30 p-4">
          <div className="flex items-center gap-3 flex-1 min-w-[240px]">
            <Label className="text-xs font-medium whitespace-nowrap">
              {t("labelFrame", { n: frame })}
            </Label>
            <Input
              type="range"
              min={0}
              max={entry.spriteFrames - 1}
              value={frame}
              onChange={(e) => onFrameChange(Number(e.target.value))}
              className="flex-1 h-2 cursor-pointer accent-primary"
            />
          </div>
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
    <Card className="rounded-2xl border shadow-xs">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <CaptionsIcon className="size-4 text-primary" />
          {t("tabSubtitles")}
        </CardTitle>
        <CardDescription>
          Manage text tracks and captions for multi-language playback support.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>Language Code</TableHead>
                <TableHead>Display Label</TableHead>
                <TableHead>VTT File Key</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entry.subtitles.map((s) => (
                <TableRow key={s.id} className="hover:bg-muted/30">
                  <TableCell>
                    <Badge variant="outline" className="font-mono text-xs uppercase">
                      {s.lang}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-sm">{s.label}</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{s.vttKey}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:text-destructive"
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
                      <Trash2Icon className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {entry.subtitles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-sm text-muted-foreground">
                    {t("noSubtitles")}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
          <span className="text-xs font-medium text-foreground">Upload Subtitle Track</span>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">{t("labelLang")}</Label>
              <Input
                className="w-28 rounded-lg h-9 text-xs"
                placeholder="e.g. en"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1 min-w-[160px]">
              <Label className="text-xs text-muted-foreground">{t("labelSubtitleLabel")}</Label>
              <Input
                className="rounded-lg h-9 text-xs"
                placeholder="e.g. English (CC)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
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
            <Button
              className="rounded-lg h-9 gap-1.5 text-xs shadow-xs"
              onClick={() => fileRef.current?.click()}
            >
              <UploadIcon className="size-3.5" />
              {t("uploadVtt")}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PlaybackTab({
  entry,
  aclId,
  acls,
  onAclChange,
}: {
  entry: EntryDetail;
  aclId: number | null;
  acls: DomainAcl[];
  onAclChange: (id: number | null) => void;
}) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);

  const embedUrl = `https://${typeof window !== "undefined" ? window.location.host : "localhost"}/embed/${entry.id}`;
  const snippet = `<iframe src="${embedUrl}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;

  return (
    <Card className="rounded-2xl border shadow-xs">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Link2Icon className="size-4 text-primary" />
          {t("tabPlayback")}
        </CardTitle>
        <CardDescription>
          Configure domain whitelist security policies and retrieve embed snippets.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("labelEmbedPolicy")}</Label>
          <Select
            options={[
              { value: "", label: t("allowAll") },
              ...acls.map((a) => ({ value: String(a.id), label: a.title })),
            ]}
            className="w-full max-w-sm rounded-lg"
            value={aclId ? String(aclId) : ""}
            onChange={(v) => onAclChange(v ? Number(v) : null)}
          />
        </div>

        <div className="flex flex-col gap-2.5">
          <Label className="text-xs font-medium">{t("embedSnippet")}</Label>
          <div className="relative overflow-hidden rounded-xl border bg-muted/60 p-4 font-mono text-xs text-foreground/90">
            <pre className="overflow-x-auto whitespace-pre-wrap break-all pr-20">
              {snippet}
            </pre>
            <Button
              variant="outline"
              size="sm"
              className="absolute top-3 right-3 h-8 gap-1.5 text-xs rounded-lg bg-background shadow-xs"
              onClick={() => {
                navigator.clipboard.writeText(snippet);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? (
                <>
                  <CheckIcon className="size-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">{t("copied")}</span>
                </>
              ) : (
                <>
                  <CopyIcon className="size-3.5" />
                  <span>{t("copy")}</span>
                </>
              )}
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
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title} className="rounded-2xl border shadow-xs">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {c.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="text-2xl font-bold tracking-tight text-foreground">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="rounded-2xl border shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t("chartPlays")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SvgChart points={plays} />
        </CardContent>
      </Card>

      <Card className="rounded-2xl border shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t("chartWatch")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SvgChart points={watch} />
        </CardContent>
      </Card>

      <Card className="rounded-2xl border shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">{t("chartBandwidth")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SvgChart points={bytes} />
        </CardContent>
      </Card>
    </div>
  );
}
