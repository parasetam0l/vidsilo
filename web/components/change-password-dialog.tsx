"use client";

import * as React from "react";

import { api, ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDialog } from "@/hooks/use-dialog";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { changePasswordSchema, fieldErrors, type FieldErrors } from "@/lib/validators";
import { FormError } from "@/components/form-error";

export function useChangePasswordDialog() {
  const dialog = useDialog();
  return React.useCallback(() => {
    dialog.open({
      content: () => <ChangePasswordContent />,
      size: "sm",
      dismissible: false,
      showCloseButton: true,
    });
  }, [dialog]);
}

function ChangePasswordContent() {
  const t = useT();
  const toast = useToast();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = fieldErrors(changePasswordSchema, {
      currentPassword: current,
      newPassword: next,
      confirm,
    });
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await api<void>("/api/auth/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success(t("passwordChanged"));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{t("changePasswordTitle")}</DialogTitle>
        <DialogDescription>{t("changePasswordDesc")}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label>{t("currentPassword")}</Label>
        <Input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
            setErrors((prev) => ({ ...prev, currentPassword: "" }));
          }}
        />
        <FormError message={errors.currentPassword} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("newPassword")}</Label>
        <Input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => {
            setNext(e.target.value);
            setErrors((prev) => ({ ...prev, newPassword: "" }));
          }}
        />
        <FormError message={errors.newPassword} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("confirmPassword")}</Label>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            setErrors((prev) => ({ ...prev, confirm: "" }));
          }}
        />
        <FormError message={errors.confirm} />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? t("loading") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
