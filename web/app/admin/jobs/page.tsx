"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CircleCheckIcon,
  CircleAlertIcon,
  CircleSlashIcon,
  CircleStopIcon,
  ClockIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  FilmIcon,
  ImageIcon,
  ListChecksIcon,
  Loader2Icon,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import { api, type JobActivity } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { useDialog } from "@/hooks/use-dialog";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function JobsPage() {
  const t = useT();
  const toast = useToast();
  const { confirm } = useDialog();
  const queryClient = useQueryClient();

  // Jobs change while processing — poll every 5s while the page is visible.
  const { data: jobs = null } = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api<JobActivity[]>("/api/jobs"),
    refetchInterval: () =>
      document.visibilityState === "visible" ? 5_000 : false,
  });

  const act = async (jobId: number, action: string) => {
    try {
      await api<void>(`/api/jobs/${jobId}/${action}`, { method: "POST" });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    }
  };

  async function retry(job: JobActivity) {
    await act(job.id, "retry");
    toast.success(t("jobRetried"));
  }

  function askCancel(job: JobActivity) {
    confirm({
      title: t("jobAbortTitle"),
      description: t("jobAbortDesc"),
      variant: "destructive",
      confirmLabel: t("jobAbort"),
      cancelLabel: t("cancel"),
      onConfirm: () => act(job.id, "cancel"),
      onError: (err: unknown) =>
        toast.error(err instanceof Error ? err.message : t("error")),
    });
  }

  const list = jobs ?? [];
  const total = list.length;
  const running = list.filter((j) => j.status === "running").length;
  const queued = list.filter((j) => j.status === "queued").length;
  const failed = list.filter((j) => j.status === "failed").length;
  const done = list.filter((j) => j.status === "done").length;

  const kpis = [
    {
      title: "Total Jobs",
      value: String(total),
      hint: t("jobsDoneCount", { n: done }),
      icon: ListChecksIcon,
      tile: "bg-blue-500/10 text-blue-500",
      blob: "bg-blue-500/15",
    },
    {
      title: t("jobRunning"),
      value: String(running),
      hint: t("jobsActiveEncoding"),
      icon: Loader2Icon,
      tile: "bg-emerald-500/10 text-emerald-500",
      blob: "bg-emerald-500/15",
    },
    {
      title: t("jobQueued"),
      value: String(queued),
      hint: t("jobsWaitingPool"),
      icon: ClockIcon,
      tile: "bg-amber-500/10 text-amber-500",
      blob: "bg-amber-500/15",
    },
    {
      title: t("statusFailed"),
      value: String(failed),
      hint: t("jobsRequiresAttention"),
      icon: CircleAlertIcon,
      tile: "bg-red-500/10 text-red-500",
      blob: "bg-red-500/15",
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {jobs === null
          ? [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)
          : kpis.map((kpi) => (
              <Card key={kpi.title} className="relative overflow-hidden  transition-shadow hover:shadow-md">
                <div className={`pointer-events-none absolute -top-10 -right-10 size-28 rounded-full blur-3xl ${kpi.blob}`} />
                <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
                  <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${kpi.tile}`}>
                    <kpi.icon className={`size-4.5 ${kpi.title === t("jobRunning") && running > 0 ? "animate-spin" : ""}`} />
                  </div>
                </CardHeader>
                <CardContent className="relative">
                  <div className="text-3xl font-semibold tracking-tight tabular-nums">{kpi.value}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{kpi.hint}</p>
                </CardContent>
              </Card>
            ))}
      </div>

      <Card className="overflow-hidden py-0 ">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("colType")}</TableHead>
                <TableHead>{t("colEntry")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colAttempts")}</TableHead>
                <TableHead>{t("colError")}</TableHead>
                <TableHead>{t("colCreated")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs === null
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
              {(jobs ?? []).map((j) => (
                <TableRow key={j.id} className="transition-colors hover:bg-muted/40">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8 rounded-lg">
                        <AvatarFallback className="rounded-lg bg-primary/10 text-primary">
                          <FilmIcon className="size-4" />
                        </AvatarFallback>
                      </Avatar>
                      <Badge variant="outline" className="font-mono text-xs uppercase">
                        {j.type === "probe" ? t("jobProbe") : t("jobTranscode")}
                      </Badge>
                      {j.label ? (
                        <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                          {j.label}
                        </Badge>
                      ) : null}
                      {j.type === "probe" && j.progress ? (
                        <Badge variant="outline" className="gap-1 font-mono text-xs text-amber-600 dark:text-amber-400 border-amber-500/30">
                          <ImageIcon className="size-3" />
                          {t("jobPosterSprite")}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="line-clamp-2 max-w-[250px] min-w-0 whitespace-normal break-words">
                      {j.entryTitle || "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={j.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {j.attempts}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-xs font-mono text-muted-foreground">
                    {j.error || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {formatDate(j.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {j.status === "queued" ? (
                        j.paused ? (
                          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shadow-2xs" onClick={() => act(j.id, "resume")}>
                            <PlayIcon className="size-3.5" /> {t("jobResume")}
                          </Button>
                        ) : (
                          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shadow-2xs" onClick={() => act(j.id, "pause")}>
                            <PauseIcon className="size-3.5" /> {t("jobPause")}
                          </Button>
                        )
                      ) : null}
                      {j.status === "queued" || j.status === "running" ? (
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive shadow-2xs" onClick={() => askCancel(j)}>
                          <CircleStopIcon className="size-3.5" /> {t("jobAbort")}
                        </Button>
                      ) : null}
                      {j.status === "failed" || j.status === "cancelled" ? (
                        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs shadow-2xs" onClick={() => retry(j)}>
                          <RotateCcwIcon className="size-3.5" /> {t("jobRetry")}
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {jobs && jobs.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7}>
                    <EmptyState icon={ClockIcon} description={t("jobsEmpty")} />
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

function JobStatusBadge({ status }: { status: JobActivity["status"] }) {
  const t = useT();
  if (status === "cancelled") {
    return (
      <Badge variant="outline" className="gap-1.5 bg-zinc-500/15 text-zinc-500 border-zinc-500/30">
        <CircleSlashIcon className="size-3" /> {t("jobCancelled")}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge variant="outline" className="gap-1.5 bg-red-500/15 text-red-500 border-red-500/30">
        <CircleAlertIcon className="size-3" /> {t("statusFailed")}
      </Badge>
    );
  }
  if (status === "done") {
    return (
      <Badge variant="outline" className="gap-1.5 bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
        <CircleCheckIcon className="size-3" /> {t("jobDone")}
      </Badge>
    );
  }
  if (status === "running") {
    return (
      <Badge variant="outline" className="gap-1.5 bg-blue-500/15 text-blue-500 border-blue-500/30">
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex size-2 rounded-full bg-blue-500" />
        </span>
        {t("jobRunning")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1.5 bg-amber-500/15 text-amber-500 border-amber-500/30">
      <ClockIcon className="size-3" />
      {t("jobQueued")}
    </Badge>
  );
}
