"use client";

import * as React from "react";
import { PencilIcon, ShieldCheckIcon, ShieldIcon, ShieldXIcon, Trash2 } from "lucide-react";
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
  const [acls, setAcls] = React.useState<DomainAcl[]>([]);

  const load = React.useCallback(() => {
    api<DomainAcl[]>("/api/acls")
      .then(setAcls)
      .catch((e) => toast.error(e.message));
  }, [toast]);
  React.useEffect(load, [load]);

  // Create/edit dialogs dispatch a change event on save; refresh the table.
  React.useEffect(() => {
    const h = () => load();
    window.addEventListener("acls:changed", h);
    return () => window.removeEventListener("acls:changed", h);
  }, [load]);

  function openEdit(a: DomainAcl) {
    open({
      content: (close) => <AclFormContent onClose={close} initial={a} />,
      size: "md",
      dismissible: false,
      showCloseButton: false,
    });
  }

  function askRemove(a: DomainAcl) {
    confirm({
      title: t("aclDeleteTitle"),
      description: t("aclDeleteDesc"),
      variant: "destructive",
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: async () => {
        try {
          await api<void>(`/api/acls/${a.id}`, { method: "DELETE" });
          toast.success(t("deleted"));
          load();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("error"));
          throw err; // keep the dialog open
        }
      },
    });
  }

  const total = acls.length;
  const totalWhitelist = acls.reduce((acc, a) => acc + a.whitelist.length, 0);
  const totalBlocklist = acls.reduce((acc, a) => acc + a.blocklist.length, 0);

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* Top summary strip */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border bg-card px-3.5 py-2 shadow-2xs">
          <ShieldIcon className="size-4 text-primary" />
          <span className="text-xs text-muted-foreground">ACL Profiles:</span>
          <span className="text-sm font-bold text-foreground tabular-nums">{total}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-emerald-500/10 border-emerald-500/20 px-3.5 py-2 shadow-2xs">
          <ShieldCheckIcon className="size-4 text-emerald-500" />
          <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium">Whitelisted Domains:</span>
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{totalWhitelist}</span>
        </div>
        {totalBlocklist > 0 ? (
          <div className="flex items-center gap-2 rounded-xl border bg-red-500/10 border-red-500/20 px-3.5 py-2 shadow-2xs">
            <ShieldXIcon className="size-4 text-red-500" />
            <span className="text-xs text-red-700 dark:text-red-300 font-medium">Blocklisted Domains:</span>
            <span className="text-sm font-bold text-red-600 dark:text-red-400 tabular-nums">{totalBlocklist}</span>
          </div>
        ) : null}
      </div>

      <Card className="overflow-hidden py-0 shadow-sm">
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
              {acls.map((a) => (
                <TableRow key={a.id} className="transition-colors hover:bg-muted/40">
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
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(a)}>
                      <PencilIcon className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => askRemove(a)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {acls.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4}>
                    <EmptyState icon={ShieldIcon} description={t("aclEmpty")} />
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
  const editing = !!initial;
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [whitelist, setWhitelist] = React.useState(initial?.whitelist.join("\n") ?? "");
  const [blocklist, setBlocklist] = React.useState(initial?.blocklist.join("\n") ?? "");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      const body = {
        title,
        whitelist: splitDomains(whitelist),
        blocklist: splitDomains(blocklist),
      };
      if (editing) {
        await api<DomainAcl>(`/api/acls/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast.success(t("aclUpdated"));
      } else {
        await api<DomainAcl>("/api/acls", {
          method: "POST",
          body: JSON.stringify(body),
        });
        toast.success(t("aclCreated"));
      }
      window.dispatchEvent(new Event("acls:changed"));
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
        {editing ? t("aclEditTitle") : t("aclNew")}
      </h2>
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
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" className="rounded-lg text-xs" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button type="submit" className="rounded-lg text-xs" disabled={busy || !title.trim()}>
          {busy ? t("loading") : t("save")}
        </Button>
      </div>
    </form>
  );
}
