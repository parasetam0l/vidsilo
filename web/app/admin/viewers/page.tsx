"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, Trash2, UsersIcon } from "lucide-react";

import { api, displayName, type Viewer, type ViewerList } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/form-error";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { EmptyState } from "@/components/empty-state";
import { SummaryStrip } from "@/components/summary-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// App-bar action: opens the create-viewer dialog (wired by the admin layout).
export function useCreateViewerAction() {
  const { open } = useDialog();
  return React.useCallback(() => {
    open({
      content: (close) => <ViewerFormContent onClose={close} />,
      size: "sm",
      dismissible: false,
      showCloseButton: false,
    });
  }, [open]);
}

export default function ViewersPage() {
  const t = useT();
  const { open, confirm } = useDialog();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["viewers"],
    queryFn: () => api<ViewerList>("/api/viewers?limit=100"),
  });
  const viewers = data?.items ?? [];
  const activeCount = viewers.filter((v) => !v.disabled).length;

  const removeViewer = useMutation({
    mutationFn: (id: number) => api<void>(`/api/viewers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("deleted"));
      queryClient.invalidateQueries({ queryKey: ["viewers"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openEdit(v: Viewer) {
    open({
      content: (close) => <ViewerFormContent onClose={close} initial={v} />,
      size: "sm",
      dismissible: false,
      showCloseButton: false,
    });
  }

  function askRemove(v: Viewer) {
    confirm({
      title: t("viewerDeleteTitle"),
      description: t("viewerDeleteDesc"),
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: () => removeViewer.mutateAsync(v.id),
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
      <SummaryStrip
        items={[
          { label: t("navViewers"), value: viewers.length },
          { label: t("viewerActive"), value: activeCount },
          { label: t("viewerDisabled"), value: viewers.length - activeCount },
        ]}
      />
      <Card className="overflow-hidden py-0">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("viewerColEmail")}</TableHead>
                <TableHead>{t("viewerColName")}</TableHead>
                <TableHead>{t("viewerColStatus")}</TableHead>
                <TableHead>{t("viewerColCreated")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="hover:bg-transparent">
                      <TableCell colSpan={5} className="py-1.5">
                        <Skeleton className="h-5 w-full rounded" />
                      </TableCell>
                    </TableRow>
                  ))
                : viewers.map((v) => (
                    <TableRow
                      key={v.id}
                      className={`cursor-pointer transition-colors hover:bg-muted/40 ${v.disabled ? "opacity-60" : ""}`}
                      onClick={() => openEdit(v)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="size-8 rounded-lg">
                            <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                              {v.email.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-foreground">{v.email}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{displayName(v)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            v.disabled
                              ? "bg-red-500/10 text-red-500 border-red-500/30"
                              : "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                          }
                        >
                          {v.disabled ? t("viewerDisabled") : t("viewerActive")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(v.createdAt)}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(v)} aria-label={t("edit")}>
                          <PencilIcon className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => askRemove(v)} aria-label={t("delete")}>
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
          {!isLoading && viewers.length === 0 ? (
            <EmptyState icon={UsersIcon} description={t("viewerEmpty")} />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function ViewerFormContent({ onClose, initial }: { onClose: () => void; initial?: Viewer }) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [email, setEmail] = React.useState(initial?.email ?? "");
  const [nameSurname, setNameSurname] = React.useState(initial?.nameSurname ?? "");
  const [password, setPassword] = React.useState("");
  const [disabled, setDisabled] = React.useState(initial?.disabled ?? false);
  const [error, setError] = React.useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api<Viewer>(initial ? `/api/viewers/${initial.id}` : "/api/viewers", {
        method: initial ? "PATCH" : "POST",
        body: JSON.stringify({
          email: email.trim(),
          nameSurname: nameSurname.trim(),
          password,
          disabled,
        }),
      }),
    onSuccess: () => {
      toast.success(initial ? t("viewerUpdated") : t("viewerCreated"));
      queryClient.invalidateQueries({ queryKey: ["viewers"] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!save.isPending && email.trim() && (initial || password)) save.mutate();
      }}
      noValidate
    >
      <DialogHeader className="px-4 pt-4">
        <DialogTitle>{initial ? t("viewerEditTitle") : t("viewerNew")}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("viewerColEmail")}</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("viewerNameSurname")}</Label>
          <Input value={nameSurname} onChange={(e) => setNameSurname(e.target.value)} className="rounded-lg" />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("viewerPassword")}</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg"
            placeholder={initial ? t("viewerPasswordHint") : ""}
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-3.5">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">{t("viewerActive")}</Label>
            <p className="text-xs text-muted-foreground">{t("viewerDisabled")}</p>
          </div>
          <Switch checked={!disabled} onCheckedChange={(v) => setDisabled(!v)} />
        </div>
        {error ? <FormError message={error} /> : null}
      </div>
      <DialogFooter className="mx-0 mb-0">
        <Button type="button" variant="ghost" onClick={onClose} disabled={save.isPending}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={save.isPending || !email.trim() || (!initial && !password)}>
          {save.isPending ? t("loading") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
