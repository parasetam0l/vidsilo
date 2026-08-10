"use client";

import * as React from "react";
import { CircleCheckIcon, CircleAlertIcon, ClockIcon, RotateCcwIcon } from "lucide-react";

import { api, type JobActivity } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export default function JobsPage() {
  const t = useT();
  const toast = useToast();
  const [jobs, setJobs] = React.useState<JobActivity[] | null>(null);

  const load = React.useCallback(() => {
    api<JobActivity[]>("/api/jobs")
      .then(setJobs)
      .catch((e) => toast.error(e.message));
  }, [toast]);

  React.useEffect(load, [load]);

  // Jobs change while processing — refresh while the page is visible.
  React.useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function retry(job: JobActivity) {
    try {
      await api<void>(`/api/jobs/${job.id}/retry`, { method: "POST" });
      toast.success(t("jobRetried"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Card className="overflow-hidden py-0 shadow-sm">
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
              {(jobs ?? []).map((j) => (
                <TableRow key={j.id}>
                  <TableCell>
                    <Badge variant="outline">
                      {j.type === "probe" ? t("jobProbe") : t("jobTranscode")}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">
                    {j.entryTitle || "—"}
                  </TableCell>
                  <TableCell>
                    <JobStatusBadge status={j.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {j.attempts}
                  </TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">
                    {j.error || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(j.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    {j.status === "failed" ? (
                      <Button variant="outline" size="sm" onClick={() => retry(j)}>
                        <RotateCcwIcon className="size-3.5" /> {t("jobRetry")}
                      </Button>
                    ) : null}
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
  if (status === "failed") {
    return (
      <Badge variant="outline" className="bg-red-500/15 text-red-500">
        <CircleAlertIcon className="size-3" /> {t("statusFailed")}
      </Badge>
    );
  }
  if (status === "done") {
    return (
      <Badge variant="outline" className="bg-emerald-500/15 text-emerald-500">
        <CircleCheckIcon className="size-3" /> {t("jobDone")}
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={status === "running" ? "bg-blue-500/15 text-blue-500" : "bg-amber-500/15 text-amber-500"}
    >
      <ClockIcon className="size-3" />
      {status === "running" ? t("jobRunning") : t("jobQueued")}
    </Badge>
  );
}
