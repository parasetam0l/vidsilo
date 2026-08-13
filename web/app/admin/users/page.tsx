"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, CircleCheckIcon, PencilIcon, Trash2, UsersIcon } from "lucide-react";

import { api, ApiError, displayName, type Role, type User } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { fieldErrors, userSchema, userEditSchema, type FieldErrors } from "@/lib/validators";
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
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const roles: Role[] = ["admin", "editor", "uploader", "viewer"];

const roleBadgeStyles: Record<Role, string> = {
  admin: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  editor: "bg-violet-500/10 text-violet-500 border-violet-500/30",
  uploader: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  viewer: "bg-slate-500/10 text-slate-500 border-slate-500/30",
};

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
  const queryClient = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api<User[]>("/api/users"),
  });

  const removeUser = useMutation({
    mutationFn: (id: number) => api<void>(`/api/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("deleted"));
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

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
      onConfirm: () => removeUser.mutateAsync(u.id),
      onError: (err: unknown) =>
        toast.error(err instanceof Error ? err.message : t("error")),
    });
  }

  const total = users.length;
  const activeCount = users.filter((u) => !u.disabled).length;
  const disabledCount = total - activeCount;
  const adminCount = users.filter((u) => u.role === "admin").length;

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
      {/* Top summary strip */}
      <SummaryStrip
        items={[
          { label: t("sumTotalUsers"), value: total },
          { label: t("sumActiveUsers"), value: activeCount },
          { label: t("usersAdministrators"), value: adminCount },
          ...(disabledCount > 0
            ? [{ label: t("sumDisabledUsers"), value: disabledCount }]
            : []),
        ]}
      />

      <Card className="overflow-hidden py-0 ">
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
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell colSpan={6}>
                      <Skeleton className="h-9 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : null}
              {!isLoading && users.map((u) => {
                const initials = (displayName(u).slice(0, 2) || u.email.slice(0, 2)).toUpperCase();
                return (
                  <TableRow
                    key={u.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`${t("edit")} ${u.email}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openEdit(u);
                      }
                    }}
                    className={`cursor-pointer transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${u.disabled ? "opacity-60" : ""}`}
                    onClick={() => openEdit(u)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8 rounded-lg">
                          <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-foreground">{u.email}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{displayName(u)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize font-medium text-xs ${roleBadgeStyles[u.role]}`}>
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          u.disabled
                            ? "gap-1.5 capitalize bg-red-500/15 text-red-500 border-red-500/30"
                            : "gap-1.5 capitalize bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                        }
                      >
                        {u.disabled ? (
                          <CircleAlertIcon className="size-3" />
                        ) : (
                          <CircleCheckIcon className="size-3" />
                        )}
                        {u.disabled ? t("statusDisabled") : t("statusActive")}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(u.createdAt)}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" aria-label={`${t("edit")} ${u.email}`} onClick={() => openEdit(u)}>
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`${t("delete")} ${u.email}`} onClick={() => askRemove(u)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && users.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6}>
                    <EmptyState icon={UsersIcon} title={t("usersTitle")} description={t("dashEmpty")} />
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
  const queryClient = useQueryClient();
  const editing = !!initial;
  const [email, setEmail] = React.useState(initial?.email ?? "");
  const [nameSurname, setNameSurname] = React.useState(initial?.nameSurname ?? "");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<Role>(initial?.role ?? "viewer");
  const [disabled, setDisabled] = React.useState(initial?.disabled ?? false);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const saveUser = useMutation({
    mutationFn: () =>
      editing
        ? api<User>(`/api/users/${initial.id}`, {
            method: "PATCH",
            body: JSON.stringify({ email, nameSurname, role, disabled, ...(password ? { password } : {}) }),
          })
        : api<User>("/api/users", {
            method: "POST",
            body: JSON.stringify({ email, nameSurname, password, role }),
          }),
    onSuccess: () => {
      toast.success(editing ? t("userUpdated") : t("userCreated"));
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err instanceof ApiError ? err.message : t("error")),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const values = { email, nameSurname, password, role, disabled };
    const errs = fieldErrors(editing ? userEditSchema : userSchema, values);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    saveUser.mutate();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{editing ? t("editUserTitle") : t("newUserTitle")}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4 px-5">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">{t("loginEmail")}</Label>
          <Input
            type="email"
            className="rounded-lg"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setErrors((prev) => ({ ...prev, email: "" }));
            }}
          />
          <FormError message={errors.email} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">{t("colNameSurname")}</Label>
          <Input className="rounded-lg" value={nameSurname} onChange={(e) => setNameSurname(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">{t("loginPassword")}</Label>
          <Input
            type="password"
            className="rounded-lg"
            value={password}
            autoComplete="new-password"
            placeholder={editing ? t("passwordKeep") : undefined}
            onChange={(e) => {
              setPassword(e.target.value);
              setErrors((prev) => ({ ...prev, password: "" }));
            }}
          />
          <FormError message={errors.password} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">{t("colRole")}</Label>
          <Select
            className="rounded-lg"
            options={roles.map((r) => ({ value: r, label: r.toUpperCase() }))}
            value={role}
            onChange={(v) => setRole(v as Role)}
            placeholder={t("colRole")}
          />
        </div>
        {editing ? (
          <div className="flex items-center justify-between rounded-xl border bg-muted/30 p-3">
            <Label className="text-xs font-medium">{t("statusDisabled")}</Label>
            <Switch checked={disabled} onCheckedChange={setDisabled} />
          </div>
        ) : null}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saveUser.isPending}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={saveUser.isPending}>
          {saveUser.isPending ? t("loading") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
