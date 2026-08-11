"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth-provider";
import {
  BarChart3Icon,
  CaptionsIcon,
  Check,
  Code2Icon,
  Copy,
  ImageIcon,
  InfoIcon,
  Link2Icon,
  Loader2,
  Loader2Icon,
  PencilLineIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  ShieldIcon,
  Trash2Icon,
  UploadIcon,
  VideoIcon,
  XIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
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
import { EmbedPreview } from "@/components/embed-preview";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const queryClient = useQueryClient();

  // Server truth: the entry + shared reference lists (same query keys the
  // admin pages use, so edits there reflect here immediately).
  const { data: entry } = useQuery({
    queryKey: ["entry", publicId],
    queryFn: () => api<EntryDetail>(`/api/entries/${publicId}`),
    // While the entry is being processed, poll so flavor/status badges and
    // progress update live.
    refetchInterval: (query) => {
      const st = query.state.data?.status;
      return st === "uploading" || st === "probing" || st === "transcoding" ? 5_000 : false;
    },
  });
  // Flavors can only be changed / reprocessed when the entry is idle.
  const entryEditable = entry?.status === "ready" || entry?.status === "failed";
  const { data: flavors = [] } = useQuery({
    queryKey: ["flavors"],
    queryFn: () => api<Flavor[]>("/api/flavors"),
  });
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/api/categories"),
  });
  const { data: acls = [] } = useQuery({
    queryKey: ["acls"],
    queryFn: () => api<DomainAcl[]>("/api/acls"),
  });
  const { data: analytics } = useQuery({
    queryKey: ["entry-analytics", publicId],
    queryFn: () => api<AnalyticsResponse>(`/api/entries/${publicId}/analytics`),
  });

  // Editable draft, initialized from the server entry (and re-synced after
  // every save via query invalidation).
  const [draft, setDraft] = React.useState<{
    title: string;
    description: string;
    categoryId: number | null;
    isPublic: boolean;
    accessDenied: boolean;
  } | null>(null);
  const [ticked, setTicked] = React.useState<Set<number>>(new Set());
  const [aclId, setAclId] = React.useState<number | null>(null);
  const [posterFrame, setPosterFrame] = React.useState(0);
  const [posterTouched, setPosterTouched] = React.useState(false);
  const [preview, setPreview] = React.useState<PlayInfo | null>(null);
  const [active, setActive] = React.useState("metadata");

  // Sync the editable draft whenever the server entry changes (initial load
  // and after every save/reprocess invalidation).
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    if (!entry) return;
    const tick = new Set(
      entry.flavors.filter((f) => f.status !== "skipped").map((f) => f.flavorId),
    );
    setDraft({
      title: entry.title,
      description: entry.description,
      categoryId: entry.categoryId,
      isPublic: entry.isPublic,
      accessDenied: entry.accessDenied,
    });
    setAclId(entry.domainAclId);
    setTicked(tick);
    setPosterFrame(0);
    setPosterTouched(false);
    setPreview(null);
  }, [entry]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const invalidateEntry = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["entry", publicId] });
  }, [queryClient, publicId]);

  const saveEntry = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("draft not loaded");
      const body: Record<string, unknown> = {
        title: draft.title,
        description: draft.description,
        categoryId: draft.categoryId,
        isPublic: draft.isPublic,
        accessDenied: draft.accessDenied,
        domainAclId: aclId,
      };
      if (entry) {
        const baseTick = new Set(
          entry.flavors.filter((f) => f.status !== "skipped").map((f) => f.flavorId),
        );
        if (baseTick.size !== ticked.size || [...ticked].some((v) => !baseTick.has(v))) {
          body.flavorIds = [...ticked];
        }
      }
      if (posterTouched) {
        body.posterFrame = posterFrame;
      }
      return api<void>(`/api/entries/${publicId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entry", publicId] });
      queryClient.invalidateQueries({ queryKey: ["entries"] });
      toast.success(t("saved"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reprocess = useMutation({
    mutationFn: () =>
      api<void>(`/api/entries/${publicId}/reprocess`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entry", publicId] });
      queryClient.invalidateQueries({ queryKey: ["entries"] });
      toast.success(t("reprocessQueued"));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Reprocessing is destructive to the current pipeline state — confirm
  // first, then the entry is queued (status flips to probing).
  const askReprocess = () => {
    confirm({
      title: t("reprocessTitle"),
      description: t("reprocessDesc"),
      confirmLabel: t("entryReprocess"),
      cancelLabel: t("cancel"),
      onConfirm: () => reprocess.mutateAsync(),
      onError: (err: unknown) =>
        toast.error(err instanceof Error ? err.message : t("error")),
    });
  };

  const sections = [
    { id: "metadata", label: t("tabMetadata"), icon: <PencilLineIcon className="size-4" /> },
    { id: "flavors", label: t("tabFlavors"), icon: <VideoIcon className="size-4" /> },
    { id: "poster", label: t("tabPoster"), icon: <ImageIcon className="size-4" /> },
    { id: "subtitles", label: t("tabSubtitles"), icon: <CaptionsIcon className="size-4" /> },
    { id: "security", label: "Security", icon: <ShieldIcon className="size-4" /> },
    { id: "embed", label: "Embed", icon: <Code2Icon className="size-4" /> },
    { id: "analytics", label: t("tabAnalytics"), icon: <BarChart3Icon className="size-4" /> },
  ];

  if (!entry || !draft) {
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

  // Base = the server state; the entry query refetches after every save, so
  // dirty tracking is always relative to what's actually persisted.
  const base = {
    title: entry.title,
    description: entry.description,
    categoryId: entry.categoryId,
    isPublic: entry.isPublic,
    accessDenied: entry.accessDenied,
    domainAclId: entry.domainAclId,
    ticked: new Set(
      entry.flavors.filter((f) => f.status !== "skipped").map((f) => f.flavorId),
    ),
  };

  const setsEqual = (a: Set<number>, b: Set<number>) =>
    a.size === b.size && [...a].every((v) => b.has(v));

  const isDirty = (
    draft.title !== base.title ||
    draft.description !== base.description ||
    draft.categoryId !== base.categoryId ||
    draft.isPublic !== base.isPublic ||
    draft.accessDenied !== base.accessDenied ||
    aclId !== base.domainAclId ||
    posterTouched ||
    !setsEqual(ticked, base.ticked)
  );

  const buildChanges = (): string[] => {
    const items: string[] = [];
    const truncate = (s: string) => (s.length > 50 ? `${s.slice(0, 50)}…` : s);
    if (draft.title !== base.title) {
      items.push(`${t("chgTitle")}: ${base.title || "—"} → ${draft.title || "—"}`);
    }
    if (draft.description !== base.description) {
      items.push(`${t("chgDesc")}: ${truncate(base.description) || "—"} → ${truncate(draft.description)}`);
    }
    if (draft.categoryId !== base.categoryId) {
      const name = (id: number | null) =>
        id == null ? t("none") : categories.find((c) => c.id === id)?.name ?? String(id);
      items.push(`${t("chgCategory")}: ${name(base.categoryId)} → ${name(draft.categoryId)}`);
    }
    if (draft.isPublic !== base.isPublic) {
      items.push(
        `${t("chgVisibility")}: ${base.isPublic ? t("visibilityPublic") : t("visibilityPrivate")} → ${draft.isPublic ? t("visibilityPublic") : t("visibilityPrivate")}`,
      );
    }
    if (draft.accessDenied !== base.accessDenied) {
      items.push(
        `${t("chgVisibility")}: ${base.accessDenied ? t("accessDenied") : t("accessAllowed")} → ${draft.accessDenied ? t("accessDenied") : t("accessAllowed")}`,
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
    if (changes.length === 0) return;
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
      onConfirm: () => saveEntry.mutateAsync(),
      onError: (err) => toast.error(err instanceof Error ? err.message : t("error")),
    });
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
              ) : (
                <div className="flex aspect-video max-h-60 w-full items-center justify-center rounded-2xl border border-border/60 bg-muted/40 mx-auto">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <VideoIcon className="size-8" />
                    <span className="text-xs font-medium">{t("previewUnavailable")}</span>
                  </div>
                </div>
              )}

              <div className="space-y-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs font-medium">{t("labelTitle")}</Label>
                    <Input
                      value={draft.title}
                      className="rounded-lg"
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
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
                      value={draft.categoryId ? String(draft.categoryId) : "none"}
                      onChange={(v) =>
                        setDraft({ ...draft, categoryId: v === "none" ? null : Number(v) })
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-xs font-medium">{t("labelDescription")}</Label>
                  <Textarea
                    rows={4}
                    className="rounded-lg resize-none"
                    value={draft.description}
                    onChange={(e) =>
                      setDraft({ ...draft, description: e.target.value })
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}

          {active === "flavors" ? (
            <div className="space-y-4 max-w-4xl">
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
                              disabled={!entryEditable}
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
                                className={`capitalize text-xs font-normal ${
                                  ef.status === "transcoding"
                                    ? "bg-blue-500/15 text-blue-500 border-blue-500/30"
                                    : ""
                                }`}
                              >
                                {ef.status === "transcoding" ? (
                                  <Loader2Icon className="size-3 animate-spin" />
                                ) : null}
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
               {!entryEditable ? (
                 <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                   <InfoIcon className="size-3.5 shrink-0" />
                   <span>{t("flavorsLockedHint")}</span>
                 </div>
               ) : null}
               {isAdmin && entryEditable ? (
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
                    onClick={askReprocess}
                    disabled={reprocess.isPending}
                  >
                    <RotateCcwIcon className="size-3.5" /> {t("entryReprocess")}
                  </Button>
                </div>
              ) : null}
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
              <SubtitlesTab entry={entry} onChanged={invalidateEntry} />
            </div>
          ) : null}

          {active === "security" ? (
            <div className="max-w-4xl">
              <SecurityTab
                aclId={aclId}
                acls={acls}
                onAclChange={setAclId}
                isPublic={draft.isPublic}
                onPublicChange={(v) => setDraft({ ...draft, isPublic: v })}
                accessDenied={draft.accessDenied}
                onAccessDeniedChange={(v) => setDraft({ ...draft, accessDenied: v })}
              />
            </div>
          ) : null}

          {active === "embed" ? (
            <div className="max-w-4xl">
              <EmbedTab publicId={entry.id} />
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
                  setDraft({
                    title: base.title,
                    description: base.description,
                    categoryId: base.categoryId,
                    isPublic: base.isPublic,
                    accessDenied: base.accessDenied,
                  });
                  setAclId(base.domainAclId);
                  setTicked(new Set(base.ticked));
                  setPosterFrame(0);
                  setPosterTouched(false);
                }}
              >
                {t("reset")}
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
      <div className="text-sm text-muted-foreground py-4">
        {t("noSprite")}
      </div>
    );
  }

  const sprite = `/media/${entry.spriteKey}`;
  const cols = 10;
  const rows = Math.max(1, Math.ceil(entry.spriteFrames / cols));
  const rowStep = rows > 1 ? 100 / (rows - 1) : 0;

  return (
    <div className="space-y-5">
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
    </div>
  );
}

function UploadSubtitleDialog({
  entryId,
  onClose,
  onChanged,
}: {
  entryId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [lang, setLang] = React.useState("en");
  const [label, setLabel] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setIsSubmitting(true);
    const form = new FormData();
    form.append("file", file);
    form.append("lang", lang || "en");
    form.append("label", label || lang || "en");

    try {
      await api(`/api/entries/${entryId}/subtitles`, { method: "POST", body: form });
      toast.success(t("subtitleUploaded") || "Subtitle track uploaded successfully.");
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("error"));
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 p-1">
      <DialogHeader>
        <DialogTitle className="text-base font-semibold">Upload Subtitle Track</DialogTitle>
        <DialogDescription className="text-xs text-muted-foreground">
          Upload a WebVTT (.vtt) caption file to support multi-language playback.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium text-foreground">Subtitle File (.vtt)</Label>
          <input
            ref={fileRef}
            type="file"
            accept=".vtt"
            className="hidden"
            onChange={(e) => {
              const selected = e.target.files?.[0];
              if (selected) setFile(selected);
            }}
          />
          <div
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed p-3.5 transition-colors",
              file
                ? "border-primary/50 bg-primary/5 dark:bg-primary/10"
                : "border-border hover:bg-muted/50"
            )}
          >
            <div className="flex items-center gap-3 overflow-hidden">
              <div
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-lg transition-colors",
                  file ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
                )}
              >
                <CaptionsIcon className="size-4" />
              </div>
              <div className="truncate">
                {file ? (
                  <>
                    <p className="text-xs font-medium text-foreground truncate">{file.name}</p>
                    <p className="text-[11px] text-muted-foreground">{formatBytes(file.size)}</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-medium text-foreground">Click to select .vtt file</p>
                    <p className="text-[11px] text-muted-foreground">WebVTT caption format required</p>
                  </>
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs rounded-lg shrink-0"
            >
              {file ? "Change" : "Browse"}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-foreground">Language Code</Label>
            <Input
              className="rounded-lg text-xs"
              placeholder="e.g. en, es, tr"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium text-foreground">Display Label</Label>
            <Input
              className="rounded-lg text-xs"
              placeholder="e.g. English (CC)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        </div>
      </div>

      <DialogFooter className="gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-lg text-xs"
          onClick={onClose}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="rounded-lg text-xs gap-1.5 min-w-[90px]"
          disabled={!file || isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="size-3.5 animate-spin" />
              Uploading...
            </>
          ) : (
            <>
              <UploadIcon className="size-3.5" />
              Save
            </>
          )}
        </Button>
      </DialogFooter>
    </form>
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
  const dialog = useDialog();
  const toast = useToast();

  const handleOpenUpload = () => {
    dialog.open({
      content: (close) => (
        <UploadSubtitleDialog entryId={entry.id} onClose={close} onChanged={onChanged} />
      ),
      size: "md",
      dismissible: true,
      showCloseButton: true,
    });
  };

  return (
    <div className="space-y-4">
      {/* Top Header Row with Upload Subtitle Button */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-foreground">Subtitles & Captions</h3>
          <p className="text-xs text-muted-foreground">Manage WebVTT caption tracks for multi-language playback.</p>
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 text-xs rounded-lg shadow-xs"
          onClick={handleOpenUpload}
        >
          <PlusIcon className="size-3.5" />
          Upload Subtitle
        </Button>
      </div>

      {/* Subtitles Table */}
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
                      dialog.confirm({
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
    </div>
  );
}

function SecurityTab({
  aclId,
  acls,
  onAclChange,
  isPublic,
  onPublicChange,
  accessDenied,
  onAccessDeniedChange,
}: {
  aclId: number | null;
  acls: DomainAcl[];
  onAclChange: (id: number | null) => void;
  isPublic: boolean;
  onPublicChange: (v: boolean) => void;
  accessDenied: boolean;
  onAccessDeniedChange: (v: boolean) => void;
}) {
  const t = useT();

  return (
    <div className="space-y-4">
      {/* Card 1: Public Toggle */}
      <div
        className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
        onClick={() => onPublicChange(!isPublic)}
      >
        <div className="space-y-0.5 select-none pointer-events-none">
          <Label className="text-sm font-medium">{t("labelPublic")}</Label>
          <p className="text-xs text-muted-foreground">
            Allow video playback across public embeds without authentication.
          </p>
        </div>
        <Switch
          checked={isPublic}
          onCheckedChange={onPublicChange}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Card 2: Deny Access Toggle */}
      <div
        className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/40"
        onClick={() => onAccessDeniedChange(!accessDenied)}
      >
        <div className="space-y-0.5 select-none pointer-events-none">
          <Label className="text-sm font-medium">{t("labelDenyAccess")}</Label>
          <p className="text-xs text-muted-foreground">
            {t("denyAccessHint")}
          </p>
        </div>
        <Switch
          checked={accessDenied}
          onCheckedChange={onAccessDeniedChange}
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Card 3: Embed Security Select */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t("labelEmbedPolicy")}</Label>
          <p className="text-xs text-muted-foreground">
            Configure domain whitelist security policies to restrict where this video can be embedded.
          </p>
        </div>
        <Select
          options={[
            { value: "", label: t("allowAll") },
            ...acls.map((a) => ({ value: String(a.id), label: a.title })),
          ]}
          className="w-full sm:w-56 shrink-0 rounded-lg"
          value={aclId ? String(aclId) : ""}
          onChange={(v) => onAclChange(v ? Number(v) : null)}
        />
      </div>
    </div>
  );
}

function EmbedTab({ publicId }: { publicId: string }) {
  const t = useT();
  const [copiedDirect, setCopiedDirect] = React.useState(false);
  const [copiedSnippet, setCopiedSnippet] = React.useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:8080";
  const directUrl = `${origin}/embed/${publicId}`;
  const snippet = `<iframe src="${directUrl}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;

  const handleCopyDirect = () => {
    navigator.clipboard.writeText(directUrl);
    setCopiedDirect(true);
    setTimeout(() => setCopiedDirect(false), 2000);
  };

  const handleCopySnippet = () => {
    navigator.clipboard.writeText(snippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  return (
    <div className="space-y-5">
      {/* Embedded Video Player Preview */}
      <EmbedPreview publicId={publicId} />

      {/* Gray Area 1: Direct Link */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-muted/40 p-4">
        <div className="flex items-center gap-2">
          <Link2Icon className="size-4 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground">Direct Link</span>
        </div>
        <Input
          readOnly
          value={directUrl}
          className="font-mono text-xs bg-background rounded-lg border shadow-2xs selection:bg-primary/20"
          onFocus={(e) => e.target.select()}
        />
        <div className="flex justify-start">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyDirect}
            className="h-8 gap-1.5 text-xs rounded-lg bg-background shadow-2xs hover:bg-muted/60"
          >
            {copiedDirect ? (
              <>
                <Check className="size-3.5 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">{t("copied")}</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Copy Direct Link</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Gray Area 2: Embed Code */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-muted/40 p-4">
        <div className="flex items-center gap-2">
          <Code2Icon className="size-4 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground">Embed Code</span>
        </div>
        <Textarea
          readOnly
          rows={3}
          value={snippet}
          className="font-mono text-xs bg-background resize-none rounded-lg border shadow-2xs selection:bg-primary/20"
          onFocus={(e) => e.target.select()}
        />
        <div className="flex justify-start">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopySnippet}
            className="h-8 gap-1.5 text-xs rounded-lg bg-background shadow-2xs hover:bg-muted/60"
          >
            {copiedSnippet ? (
              <>
                <Check className="size-3.5 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">{t("copied")}</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Copy Embed Code</span>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
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
