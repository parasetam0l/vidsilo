"use client";

// Watches the upload store at app level so completion feedback (toast +
// data refresh) fires even when the upload dialog is closed or the user
// navigated to another page mid-upload.
import * as React from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/hooks/use-toast";
import { useUploads } from "@/lib/upload-store";
import { useT } from "@/lib/i18n";

export function UploadNotifications() {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const jobs = useUploads();
  const doneIds = React.useRef<Set<string>>(new Set());
  const seeded = React.useRef(false);

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
        toast.success(t("uploadDone"));
        router.refresh();
      }
    }
  }, [jobs, router, toast, t]);

  return null;
}
