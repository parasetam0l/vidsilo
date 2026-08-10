"use client";

import * as React from "react";
import { PencilIcon, Trash2, UsersIcon } from "lucide-react";

import { api, ApiError, displayName, type Role, type User } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { firstIssue, userSchema, userEditSchema } from "@/lib/validators";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const roles: Role[] = ["admin", "editor", "uploader", "viewer"];

// App-bar action: opens the create-user dialog (wired by the admin layout).
export function useCreateUserAction() {
  const { open } = useDialog();
  return React.useCallback(() => {
    open({
      content: (close) => <UserFormContent onClose={close} />,
      size: "sm",
      dismissible: false,
      showCloseButton: false,
    });
  }, [open]);
}

export default function UsersPage() {
  const t = useT();
  const { open, confirm } = useDialog();
  const toast = useToast();
  const [users, setUsers] = React.useState<User[]>([]);

  const load = React.useCallback(() => {
    api<User[]>("/api/users")
      .then(setUsers)
      .catch((e) => toast.error(e.message));
  }, [toast]);
  React.useEffect(load, [load]);

  function openEdit(u: User) {
    open({
      content: (close) => <UserFormContent onClose={close} initial={u} />,
      size: "sm",
      dismissible: false,
      showCloseButton: false,
    });
  }

  function askRemove(u: User) {
    confirm({
      title: t("deleteUserTitle"),
      description: t("deleteUserDesc", { email: u.email }),
      variant: "destructive",
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: async () => {
        try {
          await api<void>(`/api/users/${u.id}`, { method: "DELETE" });
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
                <TableHead>{t("colEmail")}</TableHead>
                <TableHead>{t("colName")}</TableHead>
                <TableHead>{t("colRole")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colCreated")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>{displayName(u)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {u.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.disabled ? "destructive" : "outline"}>
                      {u.disabled ? t("statusDisabled") : t("statusActive")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(u.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(u)}>
                      <PencilIcon className="size-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => askRemove(u)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5}>
                    <EmptyState icon={UsersIcon} description={t("dashEmpty")} />
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

function UserFormContent({
  onClose,
  initial,
}: {
  onClose: () => void;
  initial?: User;
}) {
  const t = useT();
  const toast = useToast();
  const editing = !!initial;
  const [email, setEmail] = React.useState(initial?.email ?? "");
  const [nameSurname, setNameSurname] = React.useState(initial?.nameSurname ?? "");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<Role>(initial?.role ?? "viewer");
  const [disabled, setDisabled] = React.useState(initial?.disabled ?? false);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const values = { email, nameSurname, password, role, disabled };
    const issue = firstIssue(editing ? userEditSchema : userSchema, values);
    if (issue) {
      toast.error(issue);
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await api<User>(`/api/users/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify({ email, nameSurname, role, disabled, ...(password ? { password } : {}) }),
        });
        toast.success(t("userUpdated"));
      } else {
        await api<User>("/api/users", {
          method: "POST",
          body: JSON.stringify({ email, nameSurname, password, role }),
        });
        toast.success(t("userCreated"));
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {editing ? t("editUserTitle") : t("newUserTitle")}
        </h2>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("loginEmail")}</Label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("colNameSurname")}</Label>
        <Input value={nameSurname} onChange={(e) => setNameSurname(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("loginPassword")}</Label>
        <Input
          type="password"
          value={password}
          autoComplete="new-password"
          placeholder={editing ? t("passwordKeep") : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("colRole")}</Label>
        <Select value={role} onValueChange={(v) => v && setRole(v as Role)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <Switch checked={disabled} onCheckedChange={setDisabled} />
          <Label>{t("statusDisabled")}</Label>
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? t("loading") : t("save")}
        </Button>
      </div>
    </form>
  );
}
