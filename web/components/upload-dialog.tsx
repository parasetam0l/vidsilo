"use client";

import * as React from "react";
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  DownloadIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  TimerIcon,
  Trash2Icon,
  UploadCloudIcon,
  XIcon,
} from "lucide-react";

import { api, type Category, type UploadConfig } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  MAX_BATCH,
  addFiles,
  clearAllUploads,
  removeJob,
  resetIdle,
  startAll,
  updateJob,
  useUploads,
  type UploadJob,
} from "@/lib/upload-store";
import {
  checkUrls,
  clearAllUrlDownloads,
  removeUrlDownload,
  resetIdleDownloads,
  startDownloads,
  updateUrlDownload,
  useUrlDownloads,
  type UrlDownloadJob,
} from "@/lib/url-download-store";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Uploads run at app level (lib/upload-store, lib/url-download-store) so
// they survive closing the dialog, page navigation and hard refreshes.
export function useUploadDialog() {
  const dialog = useDialog();
  return React.useCallback(() => {
    // No ongoing upload? Reset the dialog to a fresh state.
    resetIdle();
    resetIdleDownloads();
    dialog.open({
      content: (close) => <UploadDialogContent onClose={close} />,
      size: "2xl",
      className: "max-h-[85vh] flex flex-col min-w-0 overflow-hidden",
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
  const urlJobs = useUrlDownloads();
  const [tab, setTab] = React.useState("computer");
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [uploadConfig, setUploadConfig] = React.useState<UploadConfig | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [urlText, setUrlText] = React.useState("");
  const [checking, setChecking] = React.useState(false);
  const [starting, setStarting] = React.useState(false);
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

  const urlActive = urlJobs.some((j) => j.status === "downloading" || j.status === "checking");
  const urlQueued = urlJobs.some((j) => j.status === "queued");
  const allUrlDone = urlJobs.length > 0 && !urlActive && !urlQueued;

  const pickFiles = () => inputRef.current?.click();

  const addSelected = (files: File[]) => {
    const { added, duplicates, overLimit } = addFiles(Array.from(files));
    if (overLimit > 0) {
      toast.error(t("uploadBatchLimit", { n: MAX_BATCH }));
    } else if (duplicates > 0 && added === 0) {
      toast.error(t("uploadDuplicate"));
    }
  };

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

  const handleCheckUrls = async () => {
    setChecking(true);
    try {
      const { added, failed } = await checkUrls(urlText.split("\n"));
      if (added > 0) setUrlText("");
      if (failed > 0) toast.error(t("uploadUrlInvalid"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    } finally {
      setChecking(false);
    }
  };

  const handleStartUrls = () => {
    setStarting(true);
    startDownloads().finally(() => setStarting(false));
  };

  const urlLines = urlText.split("\n").map((l) => l.trim()).filter(Boolean).length;

  const handleCloseAttempt = () => {
    const hasUnstartedFiles = jobs.some((j) => j.status === "queued" || j.status === "interrupted");
    const hasUnstartedUrls = urlJobs.some((j) => j.status === "queued") || urlText.trim().length > 0;
    const isUploading = jobs.some((j) => j.status === "uploading") || urlJobs.some((j) => j.status === "downloading");

    if ((hasUnstartedFiles || hasUnstartedUrls) && !isUploading) {
      confirm({
        title: t("uploadDiscardTitle"),
        description: t("uploadDiscardDesc"),
        variant: "destructive",
        confirmLabel: t("uploadDiscardConfirm"),
        cancelLabel: t("uploadDiscardCancel"),
        onConfirm: () => {
          clearAllUploads();
          clearAllUrlDownloads();
          resetIdle();
          resetIdleDownloads();
          onClose();
        },
      });
    } else {
      if (!isUploading) {
        resetIdle();
        resetIdleDownloads();
      }
      onClose();
    }
  };

  return (
    <div className="flex flex-col max-h-[85vh] w-full min-w-0 overflow-hidden">
      <DialogHeader className="p-5 pb-4 border-b border-border/40 shrink-0 relative pr-12">
        <DialogTitle className="flex items-center gap-2">
          {t("uploadDialogTitle")}
          {(allDone || allUrlDone) && (jobs.length > 0 || urlJobs.length > 0) ? (
            <CircleCheckIcon className="size-4 text-emerald-500" />
          ) : null}
        </DialogTitle>
        <DialogDescription className="text-xs">
          {tab === "computer"
            ? jobs.length === 0
              ? t("uploadOrClick", { max: formatBytes(maxSize) })
              : t("uploadFilesSelected", { n: jobs.length })
            : t("uploadUrlHint")}
        </DialogDescription>
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground rounded-lg"
          onClick={handleCloseAttempt}
        >
          <XIcon className="size-4" />
        </Button>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto p-5 min-h-0 space-y-4">
        <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4 w-full min-w-0">
          <TabsList className="grid w-full grid-cols-2 min-w-0">
            <TabsTrigger value="computer" className="min-w-0 truncate">
              <UploadCloudIcon className="size-4 shrink-0" /> {t("uploadTabComputer")}
            </TabsTrigger>
            <TabsTrigger value="url" className="min-w-0 truncate">
              <DownloadIcon className="size-4 shrink-0" /> {t("uploadTabUrl")}
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: upload from computer */}
          <TabsContent value="computer" className="flex flex-col gap-3 w-full min-w-0 outline-none">
            {jobs.length === 0 ? (
              <div
                className={`flex min-h-44 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                  dragOver ? "border-primary bg-muted/40" : "border-border/60"
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
                <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
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

            {hasPending ? (
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={pickFiles}>
                  <PlusIcon className="size-4" /> {t("uploadAddMore")}
                </Button>
              </div>
            ) : null}

            {jobs.length > 0 ? (
              <div className="flex flex-col gap-3 min-w-0">
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
          </TabsContent>

          {/* Tab 2: download from URL */}
          <TabsContent value="url" className="flex flex-col gap-3 w-full min-w-0 outline-none">
            <Textarea
              rows={4}
              className="w-full min-w-0 max-w-full rounded-lg font-mono text-xs resize-none break-all whitespace-pre-wrap"
              placeholder={t("uploadUrlPlaceholder")}
              value={urlText}
              onChange={(e) => setUrlText(e.target.value)}
            />
            {urlJobs.length > 0 ? (
              <div className="flex flex-col gap-3 min-w-0">
                {urlJobs.map((job) => (
                  <UrlDownloadCard key={job.id} job={job} categories={categories} />
                ))}
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </div>

      {tab === "computer" ? (
        jobs.length === 0 ? (
          <DialogFooter className="px-5 py-3.5 border-t border-border/50 bg-muted/30 shrink-0">
            <Button variant="outline" onClick={handleCloseAttempt}>
              {t("close")}
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter className="px-5 py-3.5 border-t border-border/50 bg-muted/30 shrink-0">
            <Button variant="outline" onClick={handleCloseAttempt}>
              {t("cancel")}
            </Button>
            <Button onClick={startAll} disabled={activeCount === 0}>
              <UploadCloudIcon className="size-4" />
              {t("uploadStartN", { n: activeCount, s: activeCount > 1 ? "s" : "" })}
            </Button>
          </DialogFooter>
        )
      ) : urlJobs.length === 0 ? (
        <DialogFooter className="px-5 py-3.5 border-t border-border/50 bg-muted/30 shrink-0">
          <Button variant="outline" onClick={handleCloseAttempt}>
            {t("close")}
          </Button>
          <Button onClick={handleCheckUrls} disabled={checking || urlLines === 0}>
            {checking ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {t("uploadCheckUrls")}
          </Button>
        </DialogFooter>
      ) : allUrlDone ? (
        <DialogFooter className="px-5 py-3.5 border-t border-border/50 bg-muted/30 shrink-0">
          <Button variant="outline" onClick={handleCloseAttempt}>
            {t("close")}
          </Button>
        </DialogFooter>
      ) : (
        <DialogFooter className="px-5 py-3.5 border-t border-border/50 bg-muted/30 shrink-0">
          <Button variant="outline" onClick={handleCloseAttempt}>
            {t("cancel")}
          </Button>
          <Button onClick={handleStartUrls} disabled={starting || urlActive}>
            {starting || urlActive ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <DownloadIcon className="size-4" />
            )}
            {urlActive ? t("uploadDownloading") : t("uploadStart")}
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
  const [expanded, setExpanded] = React.useState(false);

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
    <Card className="overflow-hidden py-0 border border-border/60 transition-all">
      <CardContent className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${status.tile}`}
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
          <div className="flex items-center gap-1">
            {job.status !== "done" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className={`text-muted-foreground hover:text-foreground ${
                  expanded ? "bg-muted text-foreground" : ""
                }`}
                onClick={() => setExpanded(!expanded)}
                title={expanded ? "Hide details" : "Edit title / category"}
              >
                <PencilIcon className="size-3.5" />
              </Button>
            ) : null}
            {job.status !== "done" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={onRemove}
                title="Remove file"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>

        {job.status === "uploading" ? (
          <div className="flex items-center gap-3 pt-0.5">
            <Progress value={job.progress} className="h-1.5 flex-1" />
            <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">
              {job.progress}%
            </span>
          </div>
        ) : null}

        {expanded && job.status !== "done" ? (
          <div className="flex flex-col gap-2.5 pt-2 border-t border-border/40">
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
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function UrlDownloadCard({
  job,
  categories,
}: {
  job: UrlDownloadJob;
  categories: Category[];
}) {
  const t = useT();
  const [expanded, setExpanded] = React.useState(false);

  const status = {
    done: {
      tile: "bg-emerald-500/10 text-emerald-500",
      icon: <CheckIcon className="size-4" />,
      text: ` — ${t("uploadDone")}`,
    },
    failed: {
      tile: "bg-red-500/10 text-red-500",
      icon: <CircleAlertIcon className="size-4" />,
      text: ` — ${job.error ?? t("error")}`,
    },
    downloading: {
      tile: "bg-blue-500/10 text-blue-500",
      icon: <DownloadIcon className="size-4" />,
      text: ` — ${t("uploadInProgress")}`,
    },
    queued: {
      tile: "bg-amber-500/10 text-amber-500",
      icon: <TimerIcon className="size-4" />,
      text: "",
    },
    checking: {
      tile: "bg-amber-500/10 text-amber-500",
      icon: <Loader2Icon className="size-4 animate-spin" />,
      text: "",
    },
  }[job.status];

  return (
    <Card className="overflow-hidden py-0 border border-border/60 transition-all">
      <CardContent className="flex flex-col gap-2.5 p-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${status.tile}`}
          >
            {status.icon}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{job.title || job.fileName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {job.url}
              {status.text}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {job.status !== "done" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className={`text-muted-foreground hover:text-foreground ${
                  expanded ? "bg-muted text-foreground" : ""
                }`}
                onClick={() => setExpanded(!expanded)}
                title={expanded ? "Hide details" : "Edit title / category"}
              >
                <PencilIcon className="size-3.5" />
              </Button>
            ) : null}
            {job.status === "queued" || job.status === "failed" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => removeUrlDownload(job.id)}
                title="Remove file"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>

        {job.status === "downloading" || job.status === "queued" ? (
          <div className="flex items-center gap-3 pt-0.5">
            <Progress value={job.progress >= 0 ? job.progress : 0} className="h-1.5 flex-1" />
            <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">
              {job.progress >= 0 ? `${job.progress}%` : "…"}
            </span>
          </div>
        ) : null}

        {expanded && job.status !== "done" ? (
          <div className="flex flex-col gap-2.5 pt-2 border-t border-border/40">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">{t("labelTitle")}</Label>
              <Input
                className="h-8 w-full text-sm"
                value={job.title ?? ""}
                disabled={job.status === "downloading"}
                onChange={(e) => updateUrlDownload(job.id, { title: e.target.value })}
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
                value={job.category ?? ""}
                disabled={job.status === "downloading"}
                onChange={(v) => updateUrlDownload(job.id, { category: v ?? "" })}
              />
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
