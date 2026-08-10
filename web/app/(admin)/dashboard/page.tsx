"use client";

import * as React from "react";
import Link from "next/link";

import { api, type Dashboard } from "@/lib/api";
import { formatBytes, formatDuration } from "@/lib/format";
import { StatusBadge } from "@/components/status-badge";
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

export default function DashboardPage() {
  const [data, setData] = React.useState<Dashboard | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    api<Dashboard>("/api/dashboard").then(setData).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="p-4 text-sm text-red-500">{error}</div>;
  if (!data) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  const kpis = [
    {
      title: "Entries",
      value: String(data.totalEntries),
      hint: "total in catalog",
    },
    {
      title: "Storage used",
      value: formatBytes(data.storageUsed),
      hint: "media across all entries",
    },
    {
      title: "Queue depth",
      value: String(data.queueDepth),
      hint: "jobs waiting or running",
    },
    {
      title: "Ready",
      value: String(data.entriesByStatus.ready ?? 0),
      hint: "playable entries",
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="grid auto-rows-min gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {kpi.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight">
                {kpi.value}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{kpi.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Entries by status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.entriesByStatus).map(([status, count]) => (
                <div
                  key={status}
                  className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
                >
                  <StatusBadge status={status as never} />
                  <span className="font-medium">{count}</span>
                </div>
              ))}
              {Object.keys(data.entriesByStatus).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No entries yet — upload your first video.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent uploads</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recent.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <Link
                        href={`/entries?id=${e.id}`}
                        className="hover:underline"
                      >
                        {e.title || "(untitled)"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={e.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDuration(e.durationMs)}
                    </TableCell>
                  </TableRow>
                ))}
                {data.recent.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center text-muted-foreground"
                    >
                      Nothing here yet
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
