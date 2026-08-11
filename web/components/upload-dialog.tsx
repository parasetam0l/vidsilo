"use client";

import * as React from "react";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  PlusIcon,
  TimerIcon,
  Trash2Icon,
  UploadCloudIcon,
} from "lucide-react";

import { api, type Category, type UploadConfig } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  MAX_BATCH,
  addFiles,
  removeJob,
  startAll,
  updateJob,
  useUploads,
  type UploadJob,
} from "@/lib/upload-store";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";

// Uploads run at app level (lib/upload-store) so they survive closing the
// dialog, page navigation and hard refreshes.
export function useUploadDialog() {
  const dialog = useDialog();
  return React.useCallback(() => {
    dialog.open({
      content: (close) => <UploadDialogContent onClose={close} />,
      size: "2xl",
      dismissible: false,
      showCloseButton: true,
    });
  }, [dialog]);
}

export function UploadDialogContent({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const { confirm } = useDialog();
  const jobs = useUploads();
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [uploadConfig, setUploadConfig] = React.useState<UploadConfig | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
    api<UploadConfig>("/api/upload-config").then(setUploadConfig).catch(() => {});
  }, []);

  const maxSize = uploadConfig?.maxSizeBytes ?? 8 << 30;
  const activeCount = jobs.filter(
    (j) => j.status === "uploading" || j.status === "queued" || j.status === "interrupted",
  ).length;
  const hasPending = jobs.some((j) => j.status !== "done");
  const allDone = jobs.length > 0 && !hasPending;

  const pickFiles = () => inputRef.current?.click();

  // Adds files respecting the batch cap; warns when some were dropped.
  const addSelected = (files: File[]) => {
    const added = addFiles(Array.from(files));
    if (files.length > added) {
      toast.error(t("uploadBatchLimit", { n: MAX_BATCH }));
    }
  };

  // Removing an in-flight upload stops the transfer (destructive);
  // queued/paused files are discarded immediately.
  const askRemove = (job: UploadJob) => {
    if (job.status === "uploading") {
      confirm({
        title: t("uploadStopTitle"),
        description: t("uploadStopDesc"),
        variant: "destructive",
        confirmLabel: t("uploadStop"),
        cancelLabel: t("cancel"),
        onConfirm: () => removeJob(job.id),
      });
    } else {
      removeJob(job.id);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          {t("uploadDialogTitle")}
          {allDone ? (
            <CircleCheckIcon className="size-4 text-emerald-500" />
          ) : null}
        </DialogTitle>
        {allDone ? (
          <DialogDescription className="text-xs font-medium text-emerald-500">
            {t("uploadAllComplete")}
          </DialogDescription>
        ) : (
          <DialogDescription className="text-xs">
            {jobs.length === 0
              ? t("uploadOrClick", { max: formatBytes(maxSize) })
              : t("uploadFilesSelected", { n: jobs.length })}
          </DialogDescription>
        )}
      </DialogHeader>
      {hasPending ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={pickFiles}>
            <PlusIcon className="size-4" /> {t("uploadAddMore")}
          </Button>
        </div>
      ) : null}

      {jobs.length === 0 ? (
        <div
          className={`flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center shadow-sm transition-colors ${
            dragOver ? "border-primary bg-muted/40" : "border-muted"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            addSelected(Array.from(e.dataTransfer.files));
          }}
          onClick={pickFiles}
        >
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
            <UploadCloudIcon className="size-6" />
          </div>
          <div>
            <p className="font-medium">{t("uploadDragDrop")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("uploadOrClick", { max: formatBytes(maxSize) })}
            </p>
          </div>
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,.mkv,.webm,.m4v,.avi"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) addSelected(Array.from(e.target.files));
          e.target.value = "";
        }}
      />

      {jobs.length > 0 ? (
        <div className="flex max-h-72 flex-col gap-2 overflow-y-auto p-1 pr-2">
          {jobs.map((job) => (
            <UploadJobCard
              key={job.id}
              job={job}
              categories={categories}
              onRemove={() => askRemove(job)}
            />
          ))}
        </div>
      ) : null}

      {hasPending ? (
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={activeCount === 0 && jobs.length === 0}>
            {t("cancel")}
          </Button>
          <Button onClick={startAll} disabled={activeCount === 0}>
            <UploadCloudIcon className="size-4" />
            {t("uploadStartN", { n: activeCount, s: activeCount > 1 ? "s" : "" })}
          </Button>
        </DialogFooter>
      ) : (
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("close")}
          </Button>
        </DialogFooter>
      )}
    </div>
  );
}

function UploadJobCard({
  job,
  categories,
  onRemove,
}: {
  job: UploadJob;
  categories: Category[];
  onRemove: () => void;
}) {
  const t = useT();

  const status = {
    done: {
      tile: "bg-emerald-500/10 text-emerald-500",
      icon: <CheckIcon className="size-4" />,
      text: ` — ${t("uploadDone")}`,
    },
    failed: {
      tile: "bg-red-500/10 text-red-500",
      icon: <CircleAlertIcon className="size-4" />,
      text: t("uploadFailed", { error: job.error ?? "" }),
    },
    uploading: {
      tile: "bg-blue-500/10 text-blue-500",
      icon: <UploadCloudIcon className="size-4" />,
      text: ` — ${t("uploadInProgress")}`,
    },
    queued: {
      tile: "bg-amber-500/10 text-amber-500",
      icon: <TimerIcon className="size-4" />,
      text: "",
    },
    interrupted: {
      tile: "bg-amber-500/10 text-amber-500",
      icon: <TimerIcon className="size-4" />,
      text: ` — ${t("uploadInterrupted")}`,
    },
  }[job.status];

  return (
    <Card className="overflow-hidden py-0 shadow-sm">
      <CardContent className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex size-8 shrink-0 items-center justify-center rounded-lg shadow-sm ${status.tile}`}
          >
            {status.icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{job.fileName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {formatBytes(job.fileSize)}
              {status.text}
            </p>
          </div>
          {job.status !== "done" ? (
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              onClick={onRemove}
            >
              <Trash2Icon className="size-4" />
            </Button>
          ) : null}
        </div>

        {job.status !== "done" ? (
          <>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{t("labelTitle")}</Label>
              <Input
                className="h-8 w-full text-sm"
                value={job.title}
                disabled={job.status === "uploading"}
                onChange={(e) => updateJob(job.id, { title: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{t("labelCategory")}</Label>
              <Select
                options={[
                  { value: "", label: t("none") },
                  ...categories.map((c) => ({ value: String(c.id), label: c.name })),
                ]}
                className="h-8 w-full"
                value={job.category}
                disabled={job.status === "uploading"}
                onChange={(v) => updateJob(job.id, { category: v ?? "" })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{t("labelDescription")}</Label>
              <Textarea
                rows={2}
                className="h-14 w-full text-sm"
                value={job.description}
                disabled={job.status === "uploading"}
                onChange={(e) => updateJob(job.id, { description: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <Progress value={job.progress} className="h-1.5 flex-1" />
              <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">
                {job.progress}%
              </span>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
