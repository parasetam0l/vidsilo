"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArchiveIcon,
  CaptionsIcon,
  ClapperboardIcon,
  FilmIcon,
  HardDriveIcon,
  ImageIcon,
  ServerIcon,
} from "lucide-react";

import { api, type StorageEntry, type StorageEntryFile } from "@/lib/api";
import { useT, type MessageKey } from "@/lib/i18n";
import { useEntryDetailDialog } from "@/components/entry-detail-dialog";
import { StatusBadge } from "@/components/status-badge";
import { formatBytes } from "@/lib/format";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const subRowIcons: Record<StorageEntryFile["label"], React.ReactNode> = {
  source: <FilmIcon className="size-3.5" />,
  poster: <ImageIcon className="size-3.5" />,
  flavors: <ClapperboardIcon className="size-3.5" />,
  subtitles: <CaptionsIcon className="size-3.5" />,
  other: <ArchiveIcon className="size-3.5" />,
  system: <ServerIcon className="size-3.5" />,
};

const subRowLabels: Record<StorageEntryFile["label"], MessageKey> = {
  source: "storageSubSource",
  poster: "storageSubPoster",
  flavors: "storageSubFlavors",
  subtitles: "storageSubSubtitles",
  other: "storageSubOther",
  system: "storageSystem",
};

const systemSubLabels: Record<string, MessageKey> = {
  uploads: "storageSystemUploads",
  logs: "storageSystemLogs",
  cache: "storageSystemCache",
  other: "storageSubOther",
};

export default function StoragePage() {
  const t = useT();
  const openEntryDetail = useEntryDetailDialog();

  const { data: entries = [] } = useQuery({
    queryKey: ["storage-files"],
    queryFn: () => api<StorageEntry[]>("/api/storage/files"),
    refetchInterval: () =>
      document.visibilityState === "visible" ? 60_000 : false,
  });

  const totalBytes = entries.reduce((acc, e) => acc + e.totalBytes, 0);
  const totalFiles = entries.reduce(
    (acc, e) => acc + e.files.reduce((a, f) => a + f.count, 0),
    0,
  );

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
      {/* Top summary strip */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border bg-card px-3.5 py-2 shadow-2xs">
          <HardDriveIcon className="size-4 text-primary" />
          <span className="text-xs text-muted-foreground">Total Storage:</span>
          <span className="text-sm font-bold text-foreground tabular-nums">{formatBytes(totalBytes)}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-blue-500/10 border-blue-500/20 px-3.5 py-2 shadow-2xs">
          <FilmIcon className="size-4 text-blue-500" />
          <span className="text-xs text-blue-700 dark:text-blue-300 font-medium">Entries with Media:</span>
          <span className="text-sm font-bold text-blue-600 dark:text-blue-400 tabular-nums">{entries.length}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-emerald-500/10 border-emerald-500/20 px-3.5 py-2 shadow-2xs">
          <ArchiveIcon className="size-4 text-emerald-500" />
          <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">Total Files:</span>
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{totalFiles}</span>
        </div>
      </div>

      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("colEntry")} / File</TableHead>
                <TableHead>{t("colFiles")}</TableHead>
                <TableHead className="text-right">{t("colSize")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => {
                const isSystem = e.publicId === "";
                return (
                <React.Fragment key={e.publicId || "system"}>
                  <TableRow
                    className={isSystem ? "transition-colors hover:bg-muted/40" : "cursor-pointer transition-colors hover:bg-muted/40"}
                    onClick={isSystem ? undefined : () => openEntryDetail(e.publicId)}
                  >
                    <TableCell className="py-1.5 font-medium">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="size-6 rounded-md">
                          <AvatarFallback className="rounded-md bg-zinc-500/10 text-zinc-500">
                            <ServerIcon className="size-3" />
                          </AvatarFallback>
                        </Avatar>
                        <span className="max-w-[220px] truncate text-sm font-semibold text-foreground">
                          {isSystem ? t("storageSystem") : e.title || t("untitled")}
                        </span>
                        {!isSystem ? <StatusBadge status={e.status} /> : null}
                      </div>
                    </TableCell>
                    <TableCell className="py-1.5 text-xs text-muted-foreground tabular-nums">
                      {e.files.reduce((a, f) => a + f.count, 0)}
                    </TableCell>
                    <TableCell className="py-1.5 text-right text-sm font-semibold tabular-nums">
                      {formatBytes(e.totalBytes)}
                    </TableCell>
                  </TableRow>
                  {e.files.map((f) => (
                    <TableRow key={`${f.label}-${f.name ?? ""}`} className="hover:bg-muted/30">
                      <TableCell className="py-1">
                        <span
                          className="flex items-center gap-2 text-xs text-muted-foreground"
                          style={{ paddingLeft: 40 }}
                        >
                          <span className="text-muted-foreground/70">{subRowIcons[f.label]}</span>
                          {f.label === "flavors"
                            ? `${t("storageSubFlavors")} · ${f.name}`
                            : f.label === "system" && f.name
                              ? t(systemSubLabels[f.name] ?? "storageSubOther")
                              : t(subRowLabels[f.label])}
                        </span>
                      </TableCell>
                      <TableCell className="py-1 text-xs text-muted-foreground tabular-nums">
                        {f.count}
                      </TableCell>
                      <TableCell className="py-1 text-right text-xs text-muted-foreground tabular-nums">
                        {formatBytes(f.bytes)}
                      </TableCell>
                    </TableRow>
                  ))}
                </React.Fragment>
                );
              })}
              {entries.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3}>
                    <EmptyState icon={HardDriveIcon} description={t("storageEmpty")} />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
