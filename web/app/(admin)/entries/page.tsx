"use client";

import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  FilmIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  RotateCcw,
  Search,
  Trash2,
  UploadCloudIcon,
} from "lucide-react";

import { api, type Category, type Entry, type EntryList } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { EntryThumb } from "@/components/entry-thumb";
import { useUploadDialog } from "@/components/upload-dialog";
import { useEntryDetailDialog } from "@/components/entry-detail-dialog";
import { useEmbedDialog } from "@/components/embed-dialog";
import { useUploads } from "@/lib/upload-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function EntriesPage() {
  const t = useT();
  const { confirm } = useDialog();
  const toast = useToast();
  const openUpload = useUploadDialog();
  const openEntryDetail = useEntryDetailDialog();
  const openEmbed = useEmbedDialog();
  const [list, setList] = React.useState<EntryList | null>(null);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(20);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
  }, []);

  const load = React.useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    api<EntryList>(`/api/entries?${params}`)
      .then(setList)
      .catch((e) => toast.error(e.message));
  }, [q, status, category, page, limit, toast]);

  React.useEffect(load, [load]);

  // Own uploads: refetch immediately when one completes.
  const uploads = useUploads();
  const doneIds = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    let changed = false;
    for (const u of uploads) {
      if (u.status === "done" && !doneIds.current.has(u.id)) {
        doneIds.current.add(u.id);
        changed = true;
      }
    }
    if (changed) load();
  }, [uploads, load]);

  // Other users' work: refetch while visible so the table stays in sync.
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const catName = (id: number | null) =>
    categories.find((c) => c.id === id)?.name ?? "—";

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Quick allow/deny toggle from the accessibility column: sends the full
  // row body so no other field is touched.
  async function toggleAccess(e: Entry, allowed: boolean) {
    try {
      await api<Entry>(`/api/entries/${e.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: e.title,
          description: e.description,
          categoryId: e.categoryId,
          isPublic: e.isPublic,
          domainAclId: e.domainAclId,
          accessDenied: !allowed,
        }),
      });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("error"));
    }
  }

  async function bulkDelete() {
    await Promise.all(
      [...selected].map((id) =>
        api<void>(`/api/entries/${id}`, { method: "DELETE" }).catch(() => {}),
      ),
    );
    const count = selected.size;
    setSelected(new Set());
    toast.success(t("entriesDeleted", { n: count }));
    load();
  }

  function askBulkDelete() {
    confirm({
      title: t("entriesDeleteTitle", { n: selected.size }),
      description: t("entriesDeleteDesc"),
      variant: "destructive",
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: bulkDelete,
    });
  }

  function askDelete(e: Entry) {
    confirm({
      title: t("entriesDeleteTitle", { n: 1 }),
      description: t("entryDeleteDesc"),
      variant: "destructive",
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: async () => {
        try {
          await api<void>(`/api/entries/${e.id}`, { method: "DELETE" });
          toast.success(t("deleted"));
          load();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("error"));
          throw err;
        }
      },
    });
  }

  async function bulkReprocess() {
    const ids = [...selected];
    await api<{ queued: number }>("/api/entries/reprocess", {
      method: "POST",
      body: JSON.stringify({ publicIds: ids }),
    }).catch((e) => toast.error(e.message));
    setSelected(new Set());
    toast.success(t("entriesReprocessed", { n: ids.length }));
    load();
  }

  function askReprocess() {
    confirm({
      title: t("entriesReprocessTitle", { n: selected.size }),
      description: t("entriesReprocessDesc"),
      confirmLabel: t("entryReprocess"),
      cancelLabel: t("cancel"),
      onConfirm: bulkReprocess,
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t("entriesSearch")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          options={[
            { value: "", label: t("entriesAllStatuses") },
            { value: "uploading", label: t("statusUploading") },
            { value: "probing", label: t("statusProbing") },
            { value: "transcoding", label: t("statusTranscoding") },
            { value: "ready", label: t("statusReady") },
            { value: "failed", label: t("statusFailed") },
          ]}
          className="w-40"
          value={status}
          onChange={(v) => { setStatus(v ?? ""); setPage(1); }}
        />
        <Select
          options={[
            { value: "", label: t("entriesAllCategories") },
            ...categories.map((c) => ({ value: String(c.id), label: c.name })),
          ]}
          className="w-40"
          value={category}
          onChange={(v) => { setCategory(v ?? ""); setPage(1); }}
        />
        {selected.size > 0 ? (
          <>
            <Button variant="outline" onClick={askReprocess}>
              <RotateCcw className="size-4" /> {t("entriesReprocessN", { n: selected.size })}
            </Button>
            <Button variant="destructive" onClick={askBulkDelete}>
              <Trash2 className="size-4" /> {t("entriesDeleteN", { n: selected.size })}
            </Button>
          </>
        ) : null}
      </div>

      <Card className="overflow-hidden py-0 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    checked={list != null && (list.items ?? []).length > 0 && (list.items ?? []).every((e) => selected.has(e.id))}
                    onCheckedChange={(checked) => {
                      if (checked && list) {
                        setSelected(new Set((list.items ?? []).map((e) => e.id)));
                      } else {
                        setSelected(new Set());
                      }
                    }}
                  />
                </TableHead>
                <TableHead>{t("colTitle")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colCategory")}</TableHead>
                <TableHead>{t("colDuration")}</TableHead>
                <TableHead>{t("colSize")}</TableHead>
                <TableHead className="text-right">{t("colUploaded")}</TableHead>
                <TableHead>{t("colAccess")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!list
                ? [1, 2, 3, 4, 5].map((i) => (
                    <TableRow key={i}>
                      {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full max-w-24" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                : null}
              {(list?.items ?? []).map((e: Entry) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(e.id)}
                      onCheckedChange={() => toggleSelect(e.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <EntryThumb posterKey={e.posterKey} updatedAt={e.updatedAt} />
                      <button
                        type="button"
                        className="max-w-full truncate text-left hover:underline"
                        onClick={() => openEntryDetail(e.id)}
                      >
                        {e.title || t("untitled")}
                      </button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={e.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {catName(e.categoryId)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDuration(e.durationMs)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatBytes(e.sourceSize)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(e.createdAt)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <Badge
                        variant={e.isPublic ? "outline" : "secondary"}
                        className="text-[10px] capitalize"
                      >
                        {e.isPublic ? t("visibilityPublic") : t("visibilityPrivate")}
                      </Badge>
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={!e.accessDenied}
                          onCheckedChange={(v) => toggleAccess(e, v)}
                        />
                        <span
                          className={`text-xs ${e.accessDenied ? "font-medium text-destructive" : "text-muted-foreground"}`}
                        >
                          {e.accessDenied ? t("accessDenied") : t("accessAllowed")}
                        </span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <RowActions
                      onOpen={() => openEntryDetail(e.id)}
                      onEmbed={() => openEmbed(e.id)}
                      onDelete={() => askDelete(e)}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {list && (list.items ?? []).length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8}>
                    {list.catalogTotal === 0 ? (
                      <EmptyState
                        icon={FilmIcon}
                        title={t("entriesNoneTitle")}
                        description={t("dashNoEntries")}
                        action={
                          <Button size="sm" onClick={openUpload}>
                            <UploadCloudIcon className="size-4" /> {t("dashUploadFirst")}
                          </Button>
                        }
                      />
                    ) : (
                      <EmptyState icon={FilmIcon} description={t("entriesEmpty")} />
                    )}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {list ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {t("entriesCount", {
              total: list.total,
              page: list.page,
              pages: Math.max(1, Math.ceil(list.total / list.limit)),
            })}
          </span>
          <div className="flex items-center gap-2">
            <Select
              options={[10, 20, 50].map((n) => ({ value: String(n), label: String(n) }))}
              className="h-7 w-20 text-xs"
              value={String(limit)}
              onChange={(v) => {
                setLimit(Number(v ?? 20));
                setPage(1);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="size-4" /> {t("entriesPrev")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page * list.limit >= list.total}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("entriesNext")} <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RowActions({
  onOpen,
  onEmbed,
  onDelete,
}: {
  onOpen: () => void;
  onEmbed: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={t("colActions")}>
            <MoreHorizontalIcon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onOpen}>
            <PencilIcon className="size-4" /> {t("actOpen")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onEmbed}>
            <LinkIcon className="size-4" /> {t("actEmbed")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={onDelete}
            className="text-destructive focus:text-destructive focus:bg-destructive/10"
          >
            <Trash2 className="size-4" /> {t("delete")}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
