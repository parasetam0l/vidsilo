"use client";

import * as React from "react";
import { PencilIcon, Save, SlidersHorizontalIcon, Trash2, VideoIcon, CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import { api, type Flavor } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { fieldErrors, flavorSchema, type FieldErrors } from "@/lib/validators";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const blank = (): Flavor => ({
  id: 0,
  name: "",
  label: "",
  codec: "h264",
  height: 480,
  videoMode: "crf",
  crf: 23,
  videoBitrate: null,
  audioBitrate: 128,
  preset: "veryfast",
  enabled: false,
  position: 0,
});

// App-bar action: opens the create-flavor dialog (wired by the admin layout).
export function useCreateFlavorAction() {
  const { open } = useDialog();
  return React.useCallback(() => {
    open({
      content: (close) => <FlavorFormContent onClose={close} initial={blank()} />,
      size: "md",
      dismissible: false,
      showCloseButton: false,
    });
  }, [open]);
}

function openFlavorForm(open: (o: Parameters<ReturnType<typeof useDialog>["open"]>[0]) => string, initial?: Flavor) {
  open({
    content: (close) => <FlavorFormContent onClose={close} initial={initial ?? blank()} />,
    size: "md",
    dismissible: false,
    showCloseButton: false,
  });
}

export default function FlavorsPage() {
  const t = useT();
  const { open, confirm } = useDialog();
  const openEdit = (f: Flavor) => openFlavorForm(open, f);
  const toast = useToast();
  const [flavors, setFlavors] = React.useState<Flavor[]>([]);

  const load = React.useCallback(() => {
    api<Flavor[]>("/api/flavors")
      .then(setFlavors)
      .catch((e) => toast.error(e.message));
  }, [toast]);
  React.useEffect(load, [load]);

  // Create/edit dialogs dispatch a change event on save; refresh the table.
  React.useEffect(() => {
    const h = () => load();
    window.addEventListener("flavors:changed", h);
    return () => window.removeEventListener("flavors:changed", h);
  }, [load]);

  async function toggle(f: Flavor) {
    try {
      await api<Flavor>(`/api/flavors/${f.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...f, enabled: !f.enabled }),
      });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("error"));
    }
  }

  function askRemove(f: Flavor) {
    confirm({
      title: t("deleteFlavorTitle"),
      description: t("deleteFlavorDesc"),
      variant: "destructive",
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: async () => {
        try {
          await api<void>(`/api/flavors/${f.id}`, { method: "DELETE" });
          toast.success(t("deleted"));
          load();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("error"));
          throw err; // keep the dialog open
        }
      },
    });
  }

  const total = flavors.length;
  const enabledCount = flavors.filter((f) => f.enabled).length;
  const disabledCount = total - enabledCount;

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* Top summary strip */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border bg-card px-3.5 py-2 shadow-2xs">
          <SlidersHorizontalIcon className="size-4 text-primary" />
          <span className="text-xs text-muted-foreground">Total Presets:</span>
          <span className="text-sm font-bold text-foreground tabular-nums">{total}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-emerald-500/10 border-emerald-500/20 px-3.5 py-2 shadow-2xs">
          <CheckCircle2Icon className="size-4 text-emerald-500" />
          <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">Enabled for Encoding:</span>
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{enabledCount}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-muted/40 px-3.5 py-2 shadow-2xs">
          <XCircleIcon className="size-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Disabled:</span>
          <span className="text-sm font-bold text-muted-foreground tabular-nums">{disabledCount}</span>
        </div>
      </div>

      <Card className="overflow-hidden py-0 shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("colEnabled")}</TableHead>
                <TableHead>{t("colName")}</TableHead>
                <TableHead>{t("colCodec")}</TableHead>
                <TableHead>{t("colHeight")}</TableHead>
                <TableHead>{t("colVideo")}</TableHead>
                <TableHead>{t("colAudio")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flavors.map((f) => (
                <TableRow
                  key={f.id}
                  className={`transition-colors hover:bg-muted/40 ${!f.enabled ? "opacity-60" : ""}`}
                >
                  <TableCell>
                    <Switch checked={f.enabled} onCheckedChange={() => toggle(f)} />
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8 rounded-lg">
                        <AvatarFallback className="rounded-lg bg-primary/10 text-primary">
                          <VideoIcon className="size-4" />
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-semibold text-foreground">{f.name}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`font-mono text-xs uppercase ${
                        f.codec === "h265"
                          ? "bg-violet-500/10 text-violet-500 border-violet-500/30"
                          : "bg-blue-500/10 text-blue-500 border-blue-500/30"
                      }`}
                    >
                      {f.codec}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{f.height}p</TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {f.videoMode === "crf" ? `crf ${f.crf}` : `${f.videoBitrate}k`} · {f.preset}
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">{f.audioBitrate}k</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(f)}>
                      <PencilIcon className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => askRemove(f)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {flavors.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7}>
                    <EmptyState icon={SlidersHorizontalIcon} description={t("dashEmpty")} />
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

function FlavorFormContent({
  onClose,
  initial,
}: {
  onClose: () => void;
  initial: Flavor;
}) {
  const t = useT();
  const toast = useToast();
  const editing = initial.id !== 0;
  const [draft, setDraft] = React.useState<Flavor>(initial);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const set = (patch: Partial<Flavor>) => setDraft((d) => ({ ...d, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = fieldErrors(flavorSchema, {
      ...draft,
      videoBitrate: draft.videoMode === "bitrate" ? draft.videoBitrate : null,
      crf: draft.videoMode === "crf" ? draft.crf : null,
    });
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const body = {
        ...draft,
        videoBitrate: draft.videoMode === "bitrate" ? draft.videoBitrate : null,
        crf: draft.videoMode === "crf" ? draft.crf : null,
      };
      if (editing) {
        await api<Flavor>(`/api/flavors/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast.success(t("flavorUpdated"));
      } else {
        await api<Flavor>("/api/flavors", {
          method: "POST",
          body: JSON.stringify(body),
        });
        toast.success(t("flavorCreated"));
      }
      window.dispatchEvent(new Event("flavors:changed"));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <h2 className="text-lg font-semibold tracking-tight">
        {editing ? t("editFlavorTitle") : t("newFlavorTitle")}
      </h2>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">{t("colName")}</label>
          <Input className="rounded-lg" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          <FormError message={errors.name} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">{t("colFlavor")}</label>
          <Input className="rounded-lg" value={draft.label} onChange={(e) => set({ label: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">{t("colCodec")}</label>
          <Select
            className="rounded-lg"
            options={[
              { value: "h264", label: t("codecH264") },
              { value: "h265", label: t("codecH265") },
            ]}
            value={draft.codec}
            onChange={(v) => set({ codec: (v ?? "h264") as "h264" | "h265" })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">{t("colHeight")} (px)</label>
          <Input
            className="rounded-lg"
            type="number"
            value={draft.height}
            onChange={(e) => set({ height: Number(e.target.value) })}
          />
          <FormError message={errors.height} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">{t("videoMode")}</label>
          <Select
            className="rounded-lg"
            options={[
              { value: "crf", label: t("vmodeCrf") },
              { value: "bitrate", label: t("vmodeBitrate") },
            ]}
            value={draft.videoMode}
            onChange={(v) => set({ videoMode: (v ?? "crf") as "crf" | "bitrate" })}
          />
        </div>
        {draft.videoMode === "crf" ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">{t("labelCrf")}</label>
            <Input
              className="rounded-lg"
              type="number"
              step="0.5"
              value={draft.crf ?? 23}
              onChange={(e) => set({ crf: Number(e.target.value) })}
            />
            <FormError message={errors.crf} />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium">{t("labelBitrate")}</label>
            <Input
              className="rounded-lg"
              type="number"
              value={draft.videoBitrate ?? 0}
              onChange={(e) => set({ videoBitrate: Number(e.target.value) })}
            />
            <FormError message={errors.videoBitrate} />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">{t("labelAudioBitrate")}</label>
          <Input
            className="rounded-lg"
            type="number"
            value={draft.audioBitrate}
            onChange={(e) => set({ audioBitrate: Number(e.target.value) })}
          />
          <FormError message={errors.audioBitrate} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium">{t("labelPreset")}</label>
          <Select
            className="rounded-lg"
            options={["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"].map((p) => ({
              value: p,
              label: p,
            }))}
            value={draft.preset}
            onChange={(v) => set({ preset: v ?? "veryfast" })}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" className="rounded-lg text-xs" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button type="submit" className="rounded-lg text-xs gap-1.5" disabled={busy}>
          <Save className="size-3.5" /> {busy ? t("loading") : t("saveFlavor")}
        </Button>
      </div>
    </form>
  );
}
