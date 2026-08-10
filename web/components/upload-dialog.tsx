"use client";

import * as React from "react";
import { UploadCloud, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { api, type Category } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  addFiles,
  removeJob,
  startAll,
  startJob,
  updateJob,
  useUploads,
  setUploadDoneListener,
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

// openUploadDialog renders the shared upload UI in a dialog. Uploads run at
// app level (lib/upload-store) so they survive closing the dialog, page
// navigation and hard refreshes (resumable via stored tus URLs).
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
  const router = useRouter();
  const toast = useToast();
  const jobs = useUploads();
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
  }, []);

  // When an upload completes, refresh the current page's data.
  React.useEffect(() => {
    setUploadDoneListener(() => {
      router.refresh();
      toast.success(t("uploadDone"));
    });
    return () => setUploadDoneListener(null);
  }, [router, toast, t]);

  const activeCount = jobs.filter(
    (j) => j.status === "uploading" || j.status === "queued" || j.status === "interrupted",
  ).length;
  const hasPending = jobs.some((j) => j.status !== "done");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("uploadDialogTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("uploadOrClick")}</p>
      </div>

      <div
        className={`flex min-h-56 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
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
          addFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud className="size-10 text-muted-foreground" />
        <p className="font-medium">{t("uploadDragDrop")}</p>
        <p className="text-sm text-muted-foreground">{t("uploadOrClick")}</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,.mkv,.webm,.m4v,.avi"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </div>

      {jobs.length > 0 ? (
        <div className="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1">
          {jobs.map((job) => (
            <Card key={job.id} className="shadow-sm">
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{job.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(job.fileSize)}
                      {job.status === "done"
                        ? ` — ${t("uploadDone")}`
                        : job.status === "failed"
                          ? t("uploadFailed", { error: job.error ?? "" })
                          : job.status === "interrupted"
                            ? ` — ${t("uploadInterrupted")}`
                            : ""}
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
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label>{t("labelTitle")}</Label>
                        <Input
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
                          <SelectTrigger>
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
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label>{t("labelDescription")}</Label>
                      <Textarea
                        rows={2}
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
                      {job.status === "queued" || job.status === "interrupted" ? (
                        <Button size="sm" onClick={() => startJob(job.id)}>
                          <UploadCloud className="size-4" /> {t("uploadStart")}
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}

      {hasPending ? (
        <Button className="w-full" onClick={startAll} disabled={activeCount === 0}>
          <UploadCloud className="size-4" />
          {t("uploadStartN", { n: activeCount, s: activeCount > 1 ? "s" : "" })}
        </Button>
      ) : null}
    </div>
  );
}
