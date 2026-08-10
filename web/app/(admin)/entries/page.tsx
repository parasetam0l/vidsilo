"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, Trash2 } from "lucide-react";

import { api, type Category, type Entry, type EntryList } from "@/lib/api";
import { useT } from "@/lib/i18n";
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

export default function EntriesPage() {
  const t = useT();
  const [list, setList] = React.useState<EntryList | null>(null);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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
      .catch((e) => setError(e.message));
  }, [q, status, category, page]);

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
    setSelected(new Set());
    setConfirmDelete(false);
    load();
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
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
          <Button
            variant="destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="size-4" /> {t("entriesDeleteN", { n: selected.size })}
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={list != null && list.items.length > 0 && list.items.every((e) => selected.has(e.id))}
                    onCheckedChange={(checked) => {
                      if (checked && list) {
                        setSelected(new Set(list.items.map((e) => e.id)));
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
              {!list ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    {t("loading")}
                  </TableCell>
                </TableRow>
              ) : null}
              {list?.items.map((e: Entry) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(e.id)}
                      onCheckedChange={() => toggleSelect(e.id)}
                    />
                  </TableCell>
                  <TableCell>
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
              {list && list.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    {t("entriesEmpty")}
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

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("entriesDeleteTitle", { n: selected.size })}</AlertDialogTitle>
            <AlertDialogDescription>{t("entriesDeleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={bulkDelete}>{t("delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
