"use client";

import * as React from "react";
import {
  CheckIcon,
  CircleAlertIcon,
  PlusIcon,
  TimerIcon,
  UploadCloudIcon,
  X,
} from "lucide-react";

import { api, type Category, type UploadConfig } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Uploads run at app level (lib/upload-store) so they survive closing the
// dialog, page navigation and hard refreshes.
export function useUploadDialog() {
  const dialog = useDialog();
  return React.useCallback(() => {
    dialog.open({
      content: () => <UploadDialogContent />,
      size: "2xl",
      dismissible: false,
      showCloseButton: true,
    });
  }, [dialog]);
}

export function UploadDialogContent() {
  const t = useT();
  const toast = useToast();
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

  const pickFiles = () => inputRef.current?.click();

  // Adds files respecting the batch cap; warns when some were dropped.
  const addSelected = (files: File[]) => {
    const added = addFiles(Array.from(files));
    if (files.length > added) {
      toast.error(t("uploadBatchLimit", { n: MAX_BATCH }));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("uploadDialogTitle")}</h2>
          <p className="text-sm text-muted-foreground">
            {jobs.length === 0
              ? t("uploadOrClick", { max: formatBytes(maxSize) })
              : t("uploadFilesSelected", { n: jobs.length })}
          </p>
        </div>
        {jobs.length > 0 ? (
          <Button variant="outline" size="sm" onClick={pickFiles}>
            <PlusIcon className="size-4" /> {t("uploadAddMore")}
          </Button>
        ) : null}
      </div>

      {jobs.length === 0 ? (
        <div
          className={`flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center shadow-sm transition-colors ${
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
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm">
            <UploadCloudIcon className="size-7" />
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
        <div className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1">
          {jobs.map((job) => (
            <UploadJobCard key={job.id} job={job} categories={categories} />
          ))}
        </div>
      ) : null}

      {hasPending ? (
        <Button className="w-full" onClick={startAll} disabled={activeCount === 0}>
          <UploadCloudIcon className="size-4" />
          {t("uploadStartN", { n: activeCount, s: activeCount > 1 ? "s" : "" })}
        </Button>
      ) : jobs.length > 0 ? (
        <p className="text-center text-sm text-muted-foreground">{t("uploadAllComplete")}</p>
      ) : null}
    </div>
  );
}

function UploadJobCard({
  job,
  categories,
}: {
  job: UploadJob;
  categories: Category[];
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
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-3">
          <div
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg shadow-sm ${status.tile}`}
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
            <Button variant="ghost" size="icon" onClick={() => removeJob(job.id)}>
              <X className="size-4" />
            </Button>
          ) : null}
        </div>

        {job.status !== "done" ? (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>{t("labelTitle")}</Label>
              <Input
                className="w-full"
                value={job.title}
                disabled={job.status === "uploading"}
                onChange={(e) => updateJob(job.id, { title: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("labelCategory")}</Label>
              <Select
                value={job.category}
                disabled={job.status === "uploading"}
                onValueChange={(v) => updateJob(job.id, { category: v ?? "" })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("none")} />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("labelDescription")}</Label>
              <Textarea
                rows={2}
                className="w-full"
                value={job.description}
                disabled={job.status === "uploading"}
                onChange={(e) => updateJob(job.id, { description: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-3">
              <Progress value={job.progress} className="flex-1" />
              <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">
                {job.progress}%
              </span>
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
