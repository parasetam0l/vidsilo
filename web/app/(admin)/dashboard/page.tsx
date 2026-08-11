"use client";

import * as React from "react";
import {
  ActivityIcon,
  ArrowRightIcon,
  ClapperboardIcon,
  FilmIcon,
  HardDriveIcon,
  TimerIcon,
  TriangleAlertIcon,
  UploadCloudIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { api, type Dashboard, type Entry } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { formatBytes, formatDuration, formatGb } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
import { useUploadDialog } from "@/components/upload-dialog";
import { useEntryDetailDialog } from "@/components/entry-detail-dialog";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { EntryThumb } from "@/components/entry-thumb";

interface Kpi {
  title: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  tile: string; // icon tile classes
  text: string; // icon/value accent
  blob: string; // decorative gradient blob
  warning?: string;
  spark?: { day: string; bytes: number }[];
}

function padSeries(points: { day: string; bytes: number }[]): { day: string; bytes: number }[] {
  const byDay = new Map(points.map((p) => [p.day, p.bytes]));
  const out: { day: string; bytes: number }[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ day: key, bytes: byDay.get(key) ?? 0 });
  }
  return out;
}

function Sparkline({
  points,
  className,
}: {
  points: { day: string; bytes: number }[];
  className?: string;
}) {
  const width = 88;
  const height = 30;
  const pad = 2;
  points = padSeries(points);
  const values = points.map((p) => p.bytes);
  const max = Math.max(...values, 1);
  const x = (i: number) =>
    pad + (values.length === 1 ? (width - pad * 2) / 2 : (i / (values.length - 1)) * (width - pad * 2));
  const y = (v: number) => pad + (height - pad * 2) - (v / max) * (height - pad * 2);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.bytes).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`h-8 w-[88px] ${className ?? ""}`} aria-hidden>
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
    </svg>
  );
}

const statusColors: Record<string, string> = {
  ready: "bg-emerald-500",
  transcoding: "bg-amber-500",
  probing: "bg-amber-400",
  uploading: "bg-blue-500",
  failed: "bg-red-500",
};

export default function DashboardPage() {
  const t = useT();
  const toast = useToast();
  const openUpload = useUploadDialog();
  const openEntryDetail = useEntryDetailDialog();
  const [data, setData] = React.useState<Dashboard | null>(null);

  const load = React.useCallback(() => {
    api<Dashboard>("/api/dashboard")
      .then(setData)
      .catch((e) => toast.error(e.message));
  }, [toast]);

  React.useEffect(load, [load]);

  // Keep KPIs fresh: refetch on focus and every 60s while visible.
  React.useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 60_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [load]);

  if (!data) {
    return (
      <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const kpis: Kpi[] = [
    {
      title: t("dashEntries"),
      value: String(data.totalEntries),
      hint: t("dashEntriesHint"),
      icon: FilmIcon,
      tile: "bg-blue-500/10 text-blue-500",
      text: "text-blue-500",
      blob: "bg-blue-500/15",
    },
    {
      title: t("dashStorage"),
      value: formatBytes(data.storageUsed),
      hint: t("dashStorageHint"),
      icon: HardDriveIcon,
      tile: "bg-violet-500/10 text-violet-500",
      text: "text-violet-500",
      blob: "bg-violet-500/15",
    },
    {
      title: t("dashBandwidth"),
      value: `${formatGb(data.bandwidthTotalBytes)} GB`,
      hint: t("dashBandwidthHint", { today: formatGb(data.bandwidthTodayBytes) }),
      icon: ActivityIcon,
      tile: "bg-emerald-500/10 text-emerald-500",
      text: "text-emerald-500",
      blob: "bg-emerald-500/15",
      warning: !data.analyticsEnabled ? t("analyticsDisabled") : undefined,
      spark: data.bandwidthSeries,
    },
    {
      title: t("dashQueue"),
      value: String(data.queueDepth),
      hint: t("dashQueueHint"),
      icon: TimerIcon,
      tile: "bg-amber-500/10 text-amber-500",
      text: "text-amber-500",
      blob: "bg-amber-500/15",
    },
  ];

  const totalStatusCount = Object.values(data.entriesByStatus).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
      {data.totalEntries === 0 ? (
        <Card className="relative overflow-hidden border-dashed ">
          <div className="pointer-events-none absolute -top-16 -left-16 size-48 rounded-full bg-primary/10 blur-3xl" />
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary ">
              <ClapperboardIcon className="size-7" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">
                {t("dashWelcomeTitle")}
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                {t("dashWelcomeDesc")}
              </p>
            </div>
            <Button onClick={openUpload}>
              <UploadCloudIcon className="size-4" /> {t("dashUploadFirst")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid auto-rows-min gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card
            key={kpi.title}
            className="relative overflow-hidden transition-shadow hover:shadow-md"
          >
            <div
              className={`pointer-events-none absolute -top-10 -right-10 size-28 rounded-full blur-3xl ${kpi.blob}`}
            />
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                {kpi.title}
                {kpi.warning ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <span className="inline-flex cursor-help text-amber-500">
                            <TriangleAlertIcon className="size-4" />
                          </span>
                        }
                      />
                      <TooltipContent>{kpi.warning}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null}
              </CardTitle>
              <div
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg `}
              >
                <kpi.icon className="size-4.5" />
              </div>
            </CardHeader>
            <CardContent className="relative">
              <div className="flex items-end justify-between gap-3">
                <div className="text-3xl font-semibold tracking-tight tabular-nums">
                  {kpi.value}
                </div>
                {kpi.spark && kpi.spark.length > 0 ? (
                  <Sparkline points={kpi.spark} className={kpi.text} />
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{kpi.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Entries by Status Card */}
        <Card className="relative flex flex-col justify-between overflow-hidden">
          <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-blue-500/10 blur-3xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold tracking-tight">{t("dashByStatus")}</CardTitle>
            <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
              {totalStatusCount} total
            </span>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between space-y-4">
            {Object.keys(data.entriesByStatus).length > 0 ? (
              <div className="space-y-4">
                {/* Segmented status distribution bar */}
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/60 p-0.5">
                  {Object.entries(data.entriesByStatus).map(([status, count]) => {
                    const pct = (count / (totalStatusCount || 1)) * 100;
                    return (
                      <div
                        key={status}
                        style={{ width: `${pct}%` }}
                        className={`h-full transition-all ${statusColors[status] ?? "bg-primary"}`}
                        title={`${status}: ${count} (${pct.toFixed(1)}%)`}
                      />
                    );
                  })}
                </div>

                {/* Structured status rows */}
                <div className="space-y-3 pt-1">
                  {Object.entries(data.entriesByStatus).map(([status, count]) => {
                    const pct = totalStatusCount > 0 ? Math.round((count / totalStatusCount) * 100) : 0;
                    return (
                      <div
                        key={status}
                        className="group flex items-center gap-3 rounded-xl border border-border/40 bg-card/60 p-3 shadow-2xs transition-all hover:bg-muted/40"
                      >
                        <div className="shrink-0">
                          <StatusBadge status={status as never} />
                        </div>
                        <div className="flex flex-1 items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              style={{ width: `${pct}%` }}
                              className={`h-full transition-all ${statusColors[status] ?? "bg-primary"}`}
                            />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 text-xs tabular-nums">
                          <span className="font-bold text-foreground">{count}</span>
                          <span className="text-muted-foreground">({pct}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyState icon={FilmIcon} description={t("dashStatusEmpty")} />
            )}
          </CardContent>
        </Card>

        {/* Recent Uploads Card */}
        <Card className="relative flex flex-col justify-between overflow-hidden">
          <div className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-violet-500/10 blur-3xl" />
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base font-semibold tracking-tight">{t("dashRecent")}</CardTitle>
            <Link
              href="/entries"
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
            >
              <span>View all</span>
              <ArrowRightIcon className="size-3.5" />
            </Link>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col justify-between">
            {(data.recent ?? []).length > 0 ? (
              <div className="space-y-2.5">
                {(data.recent ?? []).map((e: Entry) => (
                  <div
                    key={e.id}
                    onClick={() => openEntryDetail(e.id)}
                    className="group flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-card p-2.5 shadow-2xs transition-all hover:bg-muted/40 hover:border-border cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <EntryThumb posterKey={e.posterKey} updatedAt={e.updatedAt} />
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <span className="font-medium text-sm text-foreground group-hover:text-primary transition-colors truncate">
                          {e.title || t("untitled")}
                        </span>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground truncate">
                          <span>{formatDuration(e.durationMs)}</span>
                          {e.sourceSize ? (
                            <>
                              <span>•</span>
                              <span>{formatBytes(e.sourceSize)}</span>
                            </>
                          ) : null}
                          {e.createdAt ? (
                            <>
                              <span>•</span>
                              <span>{new Date(e.createdAt).toLocaleDateString()}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={e.status} />
                      <ArrowRightIcon className="size-4 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                icon={ClapperboardIcon}
                description={t("dashRecentEmpty")}
                action={
                  <Button variant="link" size="sm" onClick={openUpload}>
                    {t("dashUploadFirst")}
                  </Button>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

