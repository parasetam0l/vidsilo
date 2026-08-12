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
import { SummaryStrip } from "@/components/summary-strip";
import { Skeleton } from "@/components/ui/skeleton";
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

  const { data: entries = [], isLoading } = useQuery({
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
      <SummaryStrip
        items={[
          { label: t("dashStorage"), value: formatBytes(totalBytes) },
          { label: t("dashEntries"), value: entries.length },
          { label: t("colFiles"), value: totalFiles },
        ]}
      />

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
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell colSpan={3}>
                      <Skeleton className="h-9 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : null}
              {!isLoading && entries.map((e) => {
                const isSystem = e.publicId === "";
                return (
                <React.Fragment key={e.publicId || "system"}>
                  <TableRow
                    tabIndex={isSystem ? undefined : 0}
                    role={isSystem ? undefined : "button"}
                    aria-label={isSystem ? undefined : `${t("actOpen")} ${e.title}`}
                    onKeyDown={
                      isSystem
                        ? undefined
                        : (ev) => {
                            if (ev.key === "Enter" || ev.key === " ") {
                              ev.preventDefault();
                              openEntryDetail(e.publicId);
                            }
                          }
                    }
                    className={
                      isSystem
                        ? "transition-colors hover:bg-muted/40"
                        : "cursor-pointer transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    }
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
              {!isLoading && entries.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3}>
                    <EmptyState icon={HardDriveIcon} title={t("navStorage")} description={t("storageEmpty")} />
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
