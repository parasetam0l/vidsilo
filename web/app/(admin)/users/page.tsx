"use client";

import * as React from "react";
import { Plus, Save, Trash2 } from "lucide-react";

import { api, ApiError, type Role, type User } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const roles: Role[] = ["admin", "editor", "uploader", "viewer"];

export default function UsersPage() {
  const t = useT();
  const { confirm } = useDialog();
  const toast = useToast();
  const [users, setUsers] = React.useState<User[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<Role>("viewer");

  const load = React.useCallback(() => {
    api<User[]>("/api/users").then(setUsers).catch((e) => setError(e.message));
  }, []);
  React.useEffect(load, [load]);

  async function create() {
    setError(null);
    try {
      await api<User>("/api/users", {
        method: "POST",
        body: JSON.stringify({ username, password, role }),
      });
      setCreating(false);
      setUsername("");
      setPassword("");
      toast.success(t("userCreated"));
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "create failed");
    }
  }

  async function update(u: User, patch: { role?: Role; disabled?: boolean }) {
    try {
      await api<User>(`/api/users/${u.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: patch.role ?? u.role, disabled: patch.disabled ?? u.disabled }),
      });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    }
  }

  async function remove(u: User) {
    try {
      await api<void>(`/api/users/${u.id}`, { method: "DELETE" });
      toast.success(t("deleted"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("error"));
    }
  }

  function askRemove(u: User) {
    confirm({
      title: t("deleteUserTitle"),
      description: t("deleteUserDesc", { username: u.username }),
      variant: "destructive",
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: () => remove(u),
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("usersTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("usersSubtitle")}</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> {t("usersNew")}
        </Button>
      </div>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("loginUsername")}</TableHead>
                <TableHead>{t("colRole")}</TableHead>
                <TableHead>{t("colStatus")}</TableHead>
                <TableHead>{t("colCreated")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.username}</TableCell>
                  <TableCell>
                    <Select value={u.role} onValueChange={(v) => update(u, { role: v as Role })}>
                      <SelectTrigger className="w-32">
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
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={!u.disabled}
                        onCheckedChange={(v) => update(u, { disabled: !v })}
                      />
                      <Badge variant={u.disabled ? "destructive" : "outline"}>
                        {u.disabled ? t("statusDisabled") : t("statusActive")}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(u.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => askRemove(u)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("newUserTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-col gap-1.5">
              <Label>{t("loginUsername")}</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("loginPassword")}</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>{t("colRole")}</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
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
            <Button className="w-full" onClick={create}>
              <Save className="size-4" /> {t("create")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
