"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, FilmIcon, Search, Trash2 } from "lucide-react";

import { api, type Category, type Entry, type EntryList } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

export default function EntriesPage() {
  const t = useT();
  const { confirm } = useDialog();
  const toast = useToast();
  const [list, setList] = React.useState<EntryList | null>(null);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
  }, []);

  const load = React.useCallback(() => {
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    if (category) params.set("category", category);
    api<EntryList>(`/api/entries?${params}`)
      .then(setList)
      .catch((e) => toast.error(e.message));
  }, [q, status, category, page, toast]);

  React.useEffect(load, [load]);

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

  function askDelete() {
    confirm({
      title: t("entriesDeleteTitle", { n: selected.size }),
      description: t("entriesDeleteDesc"),
      variant: "destructive",
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: bulkDelete,
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
        <Select value={status} onValueChange={(v) => { setStatus(v ?? ""); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("entriesAllStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t("entriesAllStatuses")}</SelectItem>
            <SelectItem value="uploading">uploading</SelectItem>
            <SelectItem value="probing">probing</SelectItem>
            <SelectItem value="transcoding">transcoding</SelectItem>
            <SelectItem value="ready">ready</SelectItem>
            <SelectItem value="failed">failed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={(v) => { setCategory(v ?? ""); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("entriesAllCategories")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t("entriesAllCategories")}</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected.size > 0 ? (
          <Button variant="destructive" onClick={askDelete}>
            <Trash2 className="size-4" /> {t("entriesDeleteN", { n: selected.size })}
          </Button>
        ) : null}
      </div>

      <Card className="overflow-hidden shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50 [&_th:first-child]:rounded-tl-xl [&_th:last-child]:rounded-tr-xl">
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
                    <Link href={`/entries?id=${e.id}`} className="hover:underline">
                      {e.title || t("untitled")}
                    </Link>
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
                  <TableCell className="text-right text-muted-foreground">
                    {formatDate(e.createdAt)}
                  </TableCell>
                </TableRow>
              ))}
              {list && (list.items ?? []).length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="py-10">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <FilmIcon className="size-6 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">{t("entriesEmpty")}</p>
                    </div>
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
          <div className="flex gap-2">
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
