"use client";

// Watches the upload store at app level so completion feedback (toast +
// data refresh) fires even when the upload dialog is closed or the user
// navigated to another page mid-upload.
import * as React from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/hooks/use-toast";
import { useUploads } from "@/lib/upload-store";
import { useUrlDownloads } from "@/lib/url-download-store";
import { useUploadDialog } from "@/components/upload-dialog";
import { useT } from "@/lib/i18n";

export function UploadNotifications() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const openUploadDialog = useUploadDialog();
  const jobs = useUploads();
  const urlJobs = useUrlDownloads();
  const doneIds = React.useRef<Set<string>>(new Set());
  const seeded = React.useRef(false);
  const wasActive = React.useRef(false);

  const activeUploads = jobs.filter(
    (j) => j.status === "uploading" || j.status === "queued" || j.status === "interrupted",
  ).length;
  const activeUrls = urlJobs.filter(
    (j) => j.status === "downloading" || j.status === "checking" || j.status === "queued",
  ).length;
  const isCurrentlyActive = activeUploads > 0 || activeUrls > 0;

  React.useEffect(() => {
    if (isCurrentlyActive) {
      wasActive.current = true;
    } else if (
      wasActive.current &&
      !isCurrentlyActive &&
      (jobs.length > 0 || urlJobs.length > 0)
    ) {
      wasActive.current = false;
      toast.success(t("uploadAllComplete"));
      router.refresh();
      openUploadDialog();
    }
  }, [isCurrentlyActive, jobs.length, urlJobs.length, toast, t, router, openUploadDialog]);

  React.useEffect(() => {
    // First run: jobs already done (persisted across refreshes) are history,
    // not news — only toast for completions that happen after mount.
    if (!seeded.current) {
      seeded.current = true;
      for (const job of jobs) {
        if (job.status === "done") doneIds.current.add(job.id);
      }
      return;
    }
    for (const job of jobs) {
      if (job.status === "done" && !doneIds.current.has(job.id)) {
        doneIds.current.add(job.id);
        router.refresh();
      }
    }
  }, [jobs, router]);

  return null;
}
