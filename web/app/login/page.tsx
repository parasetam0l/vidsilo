"use client";

import * as React from "react";
import { ClapperboardIcon } from "lucide-react";

import { api, type Viewer } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { fieldErrors, loginSchema, type FieldErrors } from "@/lib/validators";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ViewerLoginPage() {
  const t = useT();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  // Already signed in as a viewer? Straight to the library.
  React.useEffect(() => {
    api<Viewer>("/api/viewer/me")
      .then(() => window.location.replace("/"))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setErrors(fieldErrors(loginSchema, { email, password }));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api<Viewer>("/api/viewer/login", {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      window.location.replace("/");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <Card className="w-full max-w-sm shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ClapperboardIcon className="size-6" />
          </div>
          <CardTitle className="text-lg font-semibold">{t("libraryLoginTitle")}</CardTitle>
          <CardDescription className="text-sm">{t("libraryLoginDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-medium" htmlFor="viewer-email">
                {t("loginEmail")}
              </Label>
              <Input
                id="viewer-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrors((prev) => ({ ...prev, email: "" }));
                }}
                className="rounded-lg"
              />
              <FormError message={errors.email} />
            </div>
            <div className="flex flex-col gap-2">
              <Label className="text-xs font-medium" htmlFor="viewer-password">
                {t("loginPassword")}
              </Label>
              <Input
                id="viewer-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setErrors((prev) => ({ ...prev, password: "" }));
                }}
                className="rounded-lg"
              />
              <FormError message={errors.password} />
            </div>
            {formError ? <FormError message={formError} /> : null}
            <Button type="submit" disabled={busy} className="gap-2">
              {busy ? t("loading") : t("navSignIn")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
