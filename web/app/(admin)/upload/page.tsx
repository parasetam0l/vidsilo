"use client";

import * as React from "react";
import { UploadCloud, X } from "lucide-react";
import * as tus from "tus-js-client";

import { api, type Category } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useRouter } from "next/navigation";

interface PendingUpload {
  file: File;
  title: string;
  description: string;
  category: string;
  upload?: tus.Upload;
  progress: number;
  status: "queued" | "uploading" | "done" | "failed";
  error?: string;
}

export default function UploadPage() {
  const router = useRouter();
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [pending, setPending] = React.useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
  }, []);

  const defaultTitle = (f: File) => f.name.replace(/\.[^.]+$/, "");

  function addFiles(files: FileList | File[]) {
    const next = [...pending];
    for (const file of Array.from(files)) {
      if (next.some((p) => p.file.name === file.name && p.file.size === file.size)) {
        continue;
      }
      next.push({
        file,
        title: defaultTitle(file),
        description: "",
        category: "",
        progress: 0,
        status: "queued",
      });
    }
    setPending(next);
  }

  function removePending(index: number) {
    pending[index].upload?.abort();
    setPending(pending.filter((_, i) => i !== index));
  }

  const updateAt = (i: number, patch: Partial<PendingUpload>) =>
    setPending((prev) => prev.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  function startAll() {
    const next = [...pending];
    next.forEach((p, i) => {
      if (p.status !== "queued") return;
      updateAt(i, { status: "uploading" });
      const upload = new tus.Upload(p.file, {
        endpoint: "/upload/",
        retryDelays: [0, 1000, 3000, 5000],
        chunkSize: 4 * 1024 * 1024,
        metadata: {
          filename: p.file.name,
          title: p.title,
          description: p.description,
          category: p.category || "",
        },
        onProgress: (bytesSent, bytesTotal) => {
          updateAt(i, { progress: Math.round((bytesSent / bytesTotal) * 100) });
        },
        onSuccess: () => {
          updateAt(i, { progress: 100, status: "done" });
          router.refresh();
          router.push("/entries");
        },
        onError: (err) => {
          updateAt(i, { status: "failed", error: err.message });
        },
      });
      updateAt(i, { upload });
      upload.start();
    });
  }

  const activeCount = pending.filter((p) => p.status === "uploading" || p.status === "queued").length;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div
        className={`flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
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
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
      >
        <UploadCloud className="size-10 text-muted-foreground" />
        <div>
          <p className="font-medium">Drag & drop videos here</p>
          <p className="text-sm text-muted-foreground">
            or click to browse — resumable via tus, up to 8 GiB
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,.mkv,.webm,.m4v,.avi"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {pending.length > 0 ? (
        <div className="space-y-3">
          {pending.map((p, i) => (
            <Card key={`${p.file.name}-${p.file.size}`}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{p.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(p.file.size)}
                      {p.status === "done"
                        ? " — done, opening entries…"
                        : p.status === "failed"
                          ? ` — failed: ${p.error}`
                          : ""}
                    </p>
                  </div>
                  {p.status !== "done" ? (
                    <Button variant="ghost" size="icon" onClick={() => removePending(i)}>
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>
                {p.status !== "done" ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="flex flex-col gap-1.5">
                        <Label>Title</Label>
                        <Input
                          value={p.title}
                          disabled={p.status === "uploading"}
                          onChange={(e) => updateAt(i, { title: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label>Category</Label>
                        <Select
                          value={p.category}
                          disabled={p.status === "uploading"}
                          onValueChange={(v) => updateAt(i, { category: v ?? "" })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="None" />
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
                      <Label>Description</Label>
                      <Textarea
                        rows={2}
                        value={p.description}
                        disabled={p.status === "uploading"}
                        onChange={(e) => updateAt(i, { description: e.target.value })}
                      />
                    </div>
                    <Progress value={p.progress} />
                    <p className="text-xs text-muted-foreground">{p.progress}%</p>
                  </>
                ) : null}
              </CardContent>
            </Card>
          ))}
          {activeCount > 0 ? (
            <Button className="w-full" onClick={startAll} disabled={activeCount === 0}>
              <UploadCloud className="size-4" /> Upload {activeCount} file{activeCount > 1 ? "s" : ""}
            </Button>
          ) : (
            <Button className="w-full" onClick={startAll}>
              <UploadCloud className="size-4" /> Start upload
            </Button>
          )}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>How it works</CardTitle>
            <CardDescription>
              Files upload straight to media storage with the tus resumable
              protocol — safe to close and reopen the browser mid-upload.
              After completion, the probe job inspects the source, generates a
              poster + sprite sheet, and the transcode job builds adaptive
              HLS renditions.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
