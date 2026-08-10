"use client";

import * as React from "react";
import { PencilIcon, Save, SlidersHorizontalIcon, Trash2 } from "lucide-react";

import { api, type Flavor } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
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
                <TableRow key={f.id}>
                  <TableCell>
                    <Switch checked={f.enabled} onCheckedChange={() => toggle(f)} />
                  </TableCell>
                  <TableCell className="font-medium">{f.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{f.codec}</Badge>
                  </TableCell>
                  <TableCell>{f.height}p</TableCell>
                  <TableCell className="text-muted-foreground">
                    {f.videoMode === "crf" ? `crf ${f.crf}` : `${f.videoBitrate}k`} · {f.preset}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{f.audioBitrate}k</TableCell>
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
  const [error, setError] = React.useState<string | null>(null);

  const set = (patch: Partial<Flavor>) => setDraft((d) => ({ ...d, ...patch }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
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
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <h2 className="text-lg font-semibold tracking-tight">
        {editing ? t("editFlavorTitle") : t("newFlavorTitle")}
      </h2>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">{t("colName")}</label>
          <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">{t("colFlavor")}</label>
          <Input value={draft.label} onChange={(e) => set({ label: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">{t("colCodec")}</label>
          <Select
            value={draft.codec}
            onValueChange={(v) => set({ codec: (v ?? "h264") as "h264" | "h265" })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="h264">{t("codecH264")}</SelectItem>
              <SelectItem value="h265">{t("codecH265")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">{t("colHeight")} (px)</label>
          <Input
            type="number"
            value={draft.height}
            onChange={(e) => set({ height: Number(e.target.value) })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">{t("videoMode")}</label>
          <Select
            value={draft.videoMode}
            onValueChange={(v) => set({ videoMode: (v ?? "crf") as "crf" | "bitrate" })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="crf">{t("vmodeCrf")}</SelectItem>
              <SelectItem value="bitrate">{t("vmodeBitrate")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {draft.videoMode === "crf" ? (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{t("labelCrf")}</label>
            <Input
              type="number"
              step="0.5"
              value={draft.crf ?? 23}
              onChange={(e) => set({ crf: Number(e.target.value) })}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">{t("labelBitrate")}</label>
            <Input
              type="number"
              value={draft.videoBitrate ?? 0}
              onChange={(e) => set({ videoBitrate: Number(e.target.value) })}
            />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">{t("labelAudioBitrate")}</label>
          <Input
            type="number"
            value={draft.audioBitrate}
            onChange={(e) => set({ audioBitrate: Number(e.target.value) })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">{t("labelPreset")}</label>
          <Select
            value={draft.preset}
            onValueChange={(v) => set({ preset: v ?? "veryfast" })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["ultrafast", "superfast", "veryfast", "faster", "fast", "medium"].map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          <Save className="size-4" /> {busy ? t("loading") : t("saveFlavor")}
        </Button>
      </div>
    </form>
  );
}
