"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PencilIcon, ShieldIcon, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import { api, type DomainAcl } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/empty-state";
import { SummaryStrip } from "@/components/summary-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// App-bar action: opens the create-ACL dialog (wired by the admin layout).
export function useCreateAclAction() {
  const { open } = useDialog();
  return React.useCallback(() => {
    open({
      content: (close) => <AclFormContent onClose={close} />,
      size: "md",
      dismissible: false,
      showCloseButton: false,
    });
  }, [open]);
}

export default function DomainAclsPage() {
  const t = useT();
  const { open, confirm } = useDialog();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: acls = [], isLoading } = useQuery({
    queryKey: ["acls"],
    queryFn: () => api<DomainAcl[]>("/api/acls"),
  });

  function openEdit(a: DomainAcl) {
    open({
      content: (close) => <AclFormContent onClose={close} initial={a} />,
      size: "md",
      dismissible: false,
      showCloseButton: false,
    });
  }

  const removeAcl = useMutation({
    mutationFn: (id: number) => api<void>(`/api/acls/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("deleted"));
      queryClient.invalidateQueries({ queryKey: ["acls"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function askRemove(a: DomainAcl) {
    confirm({
      title: t("aclDeleteTitle"),
      description: t("aclDeleteDesc"),
      variant: "destructive",
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: () => removeAcl.mutateAsync(a.id),
      onError: (err: unknown) =>
        toast.error(err instanceof Error ? err.message : t("error")),
    });
  }

  const total = acls.length;
  const totalWhitelist = acls.reduce((acc, a) => acc + a.whitelist.length, 0);
  const totalBlocklist = acls.reduce((acc, a) => acc + a.blocklist.length, 0);

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
      {/* Top summary strip */}
      <SummaryStrip
        items={[
          { label: t("sumTotalAcls"), value: total },
          { label: t("aclColWhitelist"), value: totalWhitelist },
          { label: t("aclColBlocklist"), value: totalBlocklist },
        ]}
      />

      <Card className="overflow-hidden py-0 ">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("aclColTitle")}</TableHead>
                <TableHead>{t("aclColWhitelist")}</TableHead>
                <TableHead>{t("aclColBlocklist")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell colSpan={4}>
                      <Skeleton className="h-9 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : null}
              {!isLoading && acls.map((a) => (
                <TableRow
                  key={a.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`${t("edit")} ${a.title}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEdit(a);
                    }
                  }}
                  className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => openEdit(a)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8 rounded-lg">
                        <AvatarFallback className="rounded-lg bg-primary/10 text-primary">
                          <ShieldIcon className="size-4" />
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-semibold text-foreground">{a.title}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {a.whitelist.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {a.whitelist.map((d, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 text-xs font-mono"
                          >
                            {d}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.blocklist.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {a.blocklist.map((d, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30 text-xs font-mono"
                          >
                            {d}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="icon" aria-label={`${t("edit")} ${a.title}`} onClick={() => openEdit(a)}>
                      <PencilIcon className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={`${t("delete")} ${a.title}`} onClick={() => askRemove(a)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && acls.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4}>
                    <EmptyState icon={ShieldIcon} title={t("navDomainAcls")} description={t("aclEmpty")} />
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

// splitDomains parses a comma/newline separated textarea into clean domains.
function splitDomains(v: string): string[] {
  return v
    .split(/[\n,]/)
    .map((d) => d.trim())
    .filter(Boolean);
}

function AclFormContent({
  onClose,
  initial,
}: {
  onClose: () => void;
  initial?: DomainAcl;
}) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const editing = !!initial;
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [whitelist, setWhitelist] = React.useState(initial?.whitelist.join("\n") ?? "");
  const [blocklist, setBlocklist] = React.useState(initial?.blocklist.join("\n") ?? "");

  const saveAcl = useMutation({
    mutationFn: () => {
      const body = {
        title,
        whitelist: splitDomains(whitelist),
        blocklist: splitDomains(blocklist),
      };
      return editing
        ? api<DomainAcl>(`/api/acls/${initial.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
        : api<DomainAcl>("/api/acls", {
            method: "POST",
            body: JSON.stringify(body),
          });
    },
    onSuccess: () => {
      toast.success(editing ? t("aclUpdated") : t("aclCreated"));
      queryClient.invalidateQueries({ queryKey: ["acls"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    saveAcl.mutate();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <DialogHeader className="px-4 pt-4">
        <DialogTitle>{editing ? t("aclEditTitle") : t("aclNew")}</DialogTitle>
      </DialogHeader>
<div className="flex flex-col gap-4 px-4">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium">{t("aclColTitle")}</Label>
        <Input className="rounded-lg" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium">{t("aclColWhitelist")}</Label>
        <Textarea
          rows={3}
          className="rounded-lg font-mono text-xs resize-none"
          placeholder={t("aclDomainsPlaceholder")}
          value={whitelist}
          onChange={(e) => setWhitelist(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-medium">{t("aclColBlocklist")}</Label>
        <Textarea
          rows={3}
          className="rounded-lg font-mono text-xs resize-none"
          placeholder={t("aclDomainsPlaceholder")}
          value={blocklist}
          onChange={(e) => setBlocklist(e.target.value)}
        />
      </div>
      </div>
<DialogFooter className="mx-0 mb-0">
        <Button type="button" variant="outline" onClick={onClose} disabled={saveAcl.isPending}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={saveAcl.isPending || !title.trim()}>
          {saveAcl.isPending ? t("loading") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
