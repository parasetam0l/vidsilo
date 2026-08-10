"use client";

import * as React from "react";

import { api, ApiError } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDialog } from "@/hooks/use-dialog";

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
  const [error, setError] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError(t("passwordMismatch"));
      return;
    }
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
      setError(err instanceof ApiError ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {t("changePasswordTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("changePasswordDesc")}</p>
      </div>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      <div className="flex flex-col gap-1.5">
        <Label>{t("currentPassword")}</Label>
        <Input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("newPassword")}</Label>
        <Input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("confirmPassword")}</Label>
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? t("loading") : t("save")}
      </Button>
    </form>
  );
}
