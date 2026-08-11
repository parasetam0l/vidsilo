"use client";

import * as React from "react";
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

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
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
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2.5">
                      <Avatar className="size-7 rounded-lg">
                        <AvatarFallback className="rounded-lg">
                          <ShieldIcon className="size-3.5" />
                        </AvatarFallback>
                      </Avatar>
                      {a.title}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.whitelist.length > 0 ? a.whitelist.join(", ") : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {a.blocklist.length > 0 ? a.blocklist.join(", ") : "—"}
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
        <Label>{t("aclColTitle")}</Label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("aclColWhitelist")}</Label>
        <Textarea
          rows={3}
          placeholder={t("aclDomainsPlaceholder")}
          value={whitelist}
          onChange={(e) => setWhitelist(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("aclColBlocklist")}</Label>
        <Textarea
          rows={3}
          placeholder={t("aclDomainsPlaceholder")}
          value={blocklist}
          onChange={(e) => setBlocklist(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={busy || !title.trim()}>
          {busy ? t("loading") : t("save")}
        </Button>
      </div>
    </form>
  );
}
