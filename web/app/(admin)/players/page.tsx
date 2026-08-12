"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorPlayIcon, PencilIcon, Trash2 } from "lucide-react";

import { api, type Player, type PlayerConfig } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select } from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const positions = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

// App-bar action: opens the create-player dialog (wired by the admin layout).
export function useCreatePlayerAction() {
  const { open } = useDialog();
  return React.useCallback(() => {
    open({
      content: (close) => <PlayerFormContent onClose={close} />,
      size: "md",
      className: "p-0",
      dismissible: false,
      showCloseButton: false,
    });
  }, [open]);
}

export default function PlayersPage() {
  const t = useT();
  const { open, confirm } = useDialog();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: players = [] } = useQuery({
    queryKey: ["players"],
    queryFn: () => api<Player[]>("/api/players"),
  });

  const removePlayer = useMutation({
    mutationFn: (id: number) => api<void>(`/api/players/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("deleted"));
      queryClient.invalidateQueries({ queryKey: ["players"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openEdit(p: Player) {
    open({
      content: (close) => <PlayerFormContent onClose={close} initial={p} />,
      size: "md",
      className: "p-0",
      dismissible: false,
      showCloseButton: false,
    });
  }

  function askRemove(p: Player) {
    confirm({
      title: t("playersDeleteTitle", { name: p.name }),
      description: t("playersDeleteDesc"),
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: () => removePlayer.mutateAsync(p.id),
    });
  }

  const summarize = (c: PlayerConfig) => {
    const parts: string[] = [];
    if (c.accentColor) parts.push(c.accentColor);
    if (c.logoUrl) parts.push(t("playersLogoShort"));
    if (c.showLoader === false) parts.push(t("playersNoLoaderShort"));
    return parts.join(" · ") || "—";
  };

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("playersName")}</TableHead>
                <TableHead>{t("playersDesign")}</TableHead>
                <TableHead className="text-right">{t("playersActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((p) => (
                <TableRow key={p.id} className="hover:bg-muted/40">
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2.5">
                      <MonitorPlayIcon className="size-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">{p.name}</span>
                      {p.isDefault ? (
                        <Badge variant="secondary" className="text-[10px]">
                          {t("playersDefault")}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{summarize(p.config)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {!p.isDefault ? (
                        <>
                          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => openEdit(p)}>
                            <PencilIcon className="size-3.5" /> {t("edit")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 text-xs text-red-600 hover:text-red-700 dark:text-red-400"
                            onClick={() => askRemove(p)}
                          >
                            <Trash2 className="size-3.5" /> {t("delete")}
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">{t("playersLocked")}</span>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {players.length === 0 ? (
            <EmptyState icon={MonitorPlayIcon} description={t("playersEmpty")} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function PlayerFormContent({ onClose, initial }: { onClose: () => void; initial?: Player }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(initial?.name ?? "");
  const cfg = initial?.config ?? {};
  const [accentColor, setAccentColor] = React.useState(cfg.accentColor ?? "");
  const [logoUrl, setLogoUrl] = React.useState(cfg.logoUrl ?? "");
  const [logoHref, setLogoHref] = React.useState(cfg.logoHref ?? "");
  const [logoPosition, setLogoPosition] = React.useState<string>(cfg.logoPosition ?? "top-right");
  const [logoSize, setLogoSize] = React.useState(String(cfg.logoSize ?? 64));
  const [logoOpacity, setLogoOpacity] = React.useState(String(cfg.logoOpacity ?? 0.8));
  const [showLoader, setShowLoader] = React.useState(cfg.showLoader !== false);
  const [autoHideControls, setAutoHideControls] = React.useState(cfg.autoHideControls !== false);
  const [error, setError] = React.useState<string | null>(null);

  const buildConfig = (): PlayerConfig => ({
    accentColor: accentColor.trim() || undefined,
    logoUrl: logoUrl.trim() || undefined,
    logoHref: logoHref.trim() || undefined,
    logoPosition: positions.includes(logoPosition as (typeof positions)[number])
      ? (logoPosition as (typeof positions)[number])
      : "top-right",
    logoSize: Math.max(16, Math.min(512, Number(logoSize) || 64)),
    logoOpacity: Math.max(0, Math.min(1, Number(logoOpacity) || 0.8)),
    showLoader,
    autoHideControls,
  });

  const save = useMutation({
    mutationFn: () =>
      api<Player>(initial ? `/api/players/${initial.id}` : "/api/players", {
        method: initial ? "PATCH" : "POST",
        body: JSON.stringify({ name: name.trim(), config: buildConfig() }),
      }),
    onSuccess: () => {
      toast.success(t("saved"));
      queryClient.invalidateQueries({ queryKey: ["players"] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="flex flex-col gap-4 p-5">
      <DialogHeader>
        <DialogTitle>{initial ? t("playersEditTitle", { name: initial.name }) : t("playersNew")}</DialogTitle>
      </DialogHeader>

      <PlayerPreview config={buildConfig()} />

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium">{t("playersName")}</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg"
          placeholder={t("playersNamePlaceholder")}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium">{t("playersAccent")}</Label>
        <div className="flex items-center gap-3">
          <Input
            type="color"
            value={accentColor || "#ffffff"}
            onChange={(e) => setAccentColor(e.target.value)}
            className="h-9 w-14 cursor-pointer rounded-lg p-1"
          />
          <Input
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="rounded-lg font-mono text-xs"
            placeholder="#ffffff"
          />
        </div>
        <p className="text-xs text-muted-foreground">{t("playersAccentHint")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("playersLogoUrl")}</Label>
          <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} className="rounded-lg text-xs" placeholder="https://…" />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("playersLogoHref")}</Label>
          <Input value={logoHref} onChange={(e) => setLogoHref(e.target.value)} className="rounded-lg text-xs" placeholder="https://…" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("playersLogoPosition")}</Label>
          <Select
            options={positions.map((p) => ({ value: p, label: p }))}
            className="w-full rounded-lg"
            value={logoPosition}
            onChange={setLogoPosition}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("playersLogoSize")}</Label>
          <Input type="number" min={16} max={512} value={logoSize} onChange={(e) => setLogoSize(e.target.value)} className="rounded-lg" />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("playersLogoOpacity")}</Label>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={logoOpacity}
            onChange={(e) => setLogoOpacity(e.target.value)}
            className="rounded-lg"
          />
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-3.5">
          <div>
            <Label className="text-sm font-medium">{t("playersLoader")}</Label>
            <p className="text-xs text-muted-foreground">{t("playersLoaderHint")}</p>
          </div>
          <Switch checked={showLoader} onCheckedChange={setShowLoader} />
        </div>
        <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-3.5">
          <div>
            <Label className="text-sm font-medium">{t("playersAutoHide")}</Label>
            <p className="text-xs text-muted-foreground">{t("playersAutoHideHint")}</p>
          </div>
          <Switch checked={autoHideControls} onCheckedChange={setAutoHideControls} />
        </div>
      </div>

      {error ? <FormError message={error} /> : null}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
          {t("cancel")}
        </Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
          {save.isPending ? t("loading") : t("save")}
        </Button>
      </DialogFooter>
    </div>
  );
}

// PlayerPreview renders a mock of the actual player so design edits (accent,
// logo watermark, loader) are visible live while editing. No video plays.
function PlayerPreview({ config }: { config: PlayerConfig }) {
  const [logoFailed, setLogoFailed] = React.useState(false);

  const accent =
    config.accentColor && /^#[0-9a-fA-F]{3,8}$/.test(config.accentColor) ? config.accentColor : "#ffffff";
  const positionClass = {
    "top-left": "left-3 top-3",
    "top-right": "right-3 top-3",
    "bottom-left": "left-3 bottom-12",
    "bottom-right": "right-3 bottom-12",
  }[config.logoPosition ?? "top-right"];
  const size = config.logoSize ?? 64;
  const opacity = config.logoOpacity ?? 0.8;

  return (
    <div className="relative aspect-video w-full select-none overflow-hidden rounded-xl border bg-black">
      {config.logoUrl ? (
        logoFailed ? (
          <div
            className={`absolute z-10 grid place-items-center rounded border border-dashed border-white/30 bg-white/5 ${positionClass}`}
            style={{ width: size, height: size, opacity }}
          >
            <span className="text-[8px] font-medium tracking-widest text-white/40">LOGO</span>
          </div>
        ) : (
          <div className={`absolute z-10 ${positionClass}`} style={{ width: size, height: size, opacity }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={config.logoUrl}
              src={config.logoUrl}
              alt=""
              className="h-full w-full object-contain"
              draggable={false}
              onLoad={() => setLogoFailed(false)}
              onError={() => setLogoFailed(true)}
            />
          </div>
        )
      ) : null}

      {config.showLoader !== false ? (
        <div
          className="absolute right-3 top-3 z-10 size-7 animate-spin rounded-full border-2 border-white/20"
          style={{ borderTopColor: accent }}
        />
      ) : null}

      <div className="absolute inset-0 grid place-items-center">
        <div className="grid size-14 place-items-center rounded-full text-black" style={{ backgroundColor: accent }}>
          <svg viewBox="0 0 24 24" className="ml-0.5 size-7 fill-current">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
        <div className="relative h-1.5 rounded-full bg-white/25">
          <div className="absolute h-full rounded-full" style={{ width: "35%", backgroundColor: accent }} />
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-white/80">
          <svg viewBox="0 0 24 24" className="size-4 fill-current">
            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          </svg>
          <svg viewBox="0 0 24 24" className="size-4 fill-current opacity-70">
            <path d="M3 9v6h4l5 5V4L7 9H3z" />
          </svg>
          <span className="tabular-nums opacity-80">0:07 / 0:21</span>
          <div className="ml-auto flex items-center gap-2 opacity-80">
            <span className="h-3 w-5 rounded-sm border border-white/60" />
            <span className="h-3 w-5 rounded-sm border border-white/60" />
            <span className="h-3 w-5 rounded-sm border border-white/60" />
          </div>
        </div>
      </div>
    </div>
  );
}
