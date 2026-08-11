"use client";

import * as React from "react";
import {
  ActivityIcon,
  BarChartIcon,
  ClockIcon,
  PlayIcon,
  UsersIcon,
  FilmIcon,
} from "lucide-react";

import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useEntryDetailDialog } from "@/components/entry-detail-dialog";
import { EmptyState } from "@/components/empty-state";
import { SvgChart } from "@/components/svg-chart";
import { padSeries } from "@/lib/charts";
import { formatGb, formatWatchHours } from "@/lib/format";
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

interface Summary {
  totals: { entries: number; plays: number; watchSeconds: number; bytes: number };
  series: { day: string; plays: number; watchSeconds: number; bytes: number; uniqueViewers: number }[];
  topEntries: { publicId: string; title: string; plays: number; watchSeconds: number; bytes: number }[];
}

export default function AnalyticsPage() {
  const t = useT();
  const [data, setData] = React.useState<Summary | null>(null);
  const openEntryDetail = useEntryDetailDialog();

  const load = React.useCallback(() => {
    api<Summary>("/api/analytics/summary").then(setData).catch(() => {});
  }, []);

  React.useEffect(load, [load]);

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!data) {
    return (
      <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const series = data.series ?? [];
  const plays = padSeries(series.map((d) => ({ day: d.day, value: d.plays }))).map(
    (p) => ({ label: p.day, value: p.value }),
  );
  const watch = padSeries(
    series.map((d) => ({ day: d.day, value: Math.round(d.watchSeconds / 60) })),
  ).map((p) => ({ label: p.day, value: p.value }));

  const cards = [
    {
      title: t("statPlays"),
      value: String(data.totals.plays),
      icon: PlayIcon,
      tile: "bg-blue-500/10 text-blue-500",
      blob: "bg-blue-500/15",
    },
    {
      title: t("statViewers"),
      value: String(data.totals.entries),
      icon: UsersIcon,
      tile: "bg-violet-500/10 text-violet-500",
      blob: "bg-violet-500/15",
    },
    {
      title: t("statWatchTime"),
      value: `${formatWatchHours(data.totals.watchSeconds)} h`,
      icon: ClockIcon,
      tile: "bg-emerald-500/10 text-emerald-500",
      blob: "bg-emerald-500/15",
    },
    {
      title: t("statBandwidth"),
      value: `${formatGb(data.totals.bytes)} GB`,
      icon: ActivityIcon,
      tile: "bg-amber-500/10 text-amber-500",
      blob: "bg-amber-500/15",
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <Card
            key={c.title}
            className="relative overflow-hidden shadow-sm transition-shadow hover:shadow-md"
          >
            <div
              className={`pointer-events-none absolute -top-10 -right-10 size-28 rounded-full blur-3xl ${c.blob}`}
            />
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.title}
              </CardTitle>
              <div
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg shadow-sm ${c.tile}`}
              >
                <c.icon className="size-4.5" />
              </div>
            </CardHeader>
            <CardContent className="relative">
              <div className="text-3xl font-semibold tracking-tight tabular-nums">
                {c.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold tracking-tight">{t("chartPlays")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SvgChart points={plays} />
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold tracking-tight">{t("chartWatch")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SvgChart points={watch} />
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden py-0 shadow-sm">
        <CardHeader className="py-4">
          <CardTitle className="text-base font-semibold tracking-tight">{t("analyticsTopEntries")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {(data.topEntries ?? []).length > 0 ? (
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("colEntry")}</TableHead>
                  <TableHead className="text-right">{t("colPlays")}</TableHead>
                  <TableHead className="text-right">{t("colWatchTime")}</TableHead>
                  <TableHead className="text-right">{t("colBandwidth")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.topEntries ?? []).map((e) => (
                  <TableRow key={e.publicId} className="transition-colors hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2.5">
                        <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <FilmIcon className="size-3.5" />
                        </div>
                        <button
                          type="button"
                          className="max-w-full truncate text-left font-medium hover:underline text-foreground"
                          onClick={() => openEntryDetail(e.publicId)}
                        >
                          {e.title || t("untitled")}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-foreground">
                      {e.plays}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatWatchHours(e.watchSeconds)} h
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatGb(e.bytes)} GB
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyState
              icon={BarChartIcon}
              description={t("analyticsEmpty")}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
