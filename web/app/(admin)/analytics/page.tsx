"use client";

import * as React from "react";
import { BarChartIcon } from "lucide-react";

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
      <div className="flex flex-1 flex-col gap-4 p-4">
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
    { title: t("statPlays"), value: String(data.totals.plays) },
    { title: t("statViewers"), value: String(data.totals.entries) },
    { title: t("statWatchTime"), value: `${formatWatchHours(data.totals.watchSeconds)} h` },
    { title: t("statBandwidth"), value: `${formatGb(data.totals.bytes)} GB` },
  ];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="grid gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.title} className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{c.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{t("chartPlays")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SvgChart points={plays} />
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">{t("chartWatch")}</CardTitle>
          </CardHeader>
          <CardContent>
            <SvgChart points={watch} />
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden py-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">{t("analyticsTopEntries")}</CardTitle>
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
                  <TableRow key={e.publicId}>
                    <TableCell className="font-medium">
                      <button
                        type="button"
                        className="max-w-full truncate text-left hover:underline"
                        onClick={() => openEntryDetail(e.publicId)}
                      >
                        {e.title || t("untitled")}
                      </button>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {e.plays}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatWatchHours(e.watchSeconds)} h
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
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
