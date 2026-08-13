"use client";

import * as React from "react";
import { ClapperboardIcon, EyeIcon, EyeOffIcon } from "lucide-react";

import { api, type Viewer } from "@/lib/api";
import { getSiteConfig, useSiteName } from "@/lib/site-config";
import { useT } from "@/lib/i18n";
import { fieldErrors, loginSchema, type FieldErrors } from "@/lib/validators";
import { FormError } from "@/components/form-error";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelect } from "@/components/language-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ViewerLoginPage() {
  const t = useT();
  const siteName = useSiteName();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  // Already signed in as a viewer? Straight to the library.
  React.useEffect(() => {
    api<Viewer>("/api/viewer/me")
      .then(() => window.location.replace("/"))
      .catch(() => {});
  }, []);

  // Site name in the tab title, like the staff login.
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      getSiteConfig()
        .then((cfg) => {
          document.title = `${t("libraryLoginTitle")} | ${cfg.siteName || "VOD App"}`;
        })
        .catch(() => {
          document.title = `${t("libraryLoginTitle")} | VOD App`;
        });
    }, 0);
    return () => window.clearTimeout(id);
  });

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
    <div className="relative flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-4">
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <LanguageSelect />
        <ThemeToggle />
      </div>
      <div className="flex items-center gap-3">
        <div className="flex aspect-square size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ClapperboardIcon className="size-5" />
        </div>
        <span className="text-2xl font-semibold tracking-tight">{siteName}</span>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-xl">{t("libraryLoginTitle")}</CardTitle>
          <CardDescription>{t("libraryLoginDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="viewer-email">{t("loginEmail")}</Label>
              <Input
                id="viewer-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrors((prev) => ({ ...prev, email: "" }));
                }}
              />
              <FormError message={errors.email} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="viewer-password">{t("loginPassword")}</Label>
              <div className="relative">
                <Input
                  id="viewer-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setErrors((prev) => ({ ...prev, password: "" }));
                  }}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t("loginHidePassword") : t("loginShowPassword")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </button>
              </div>
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
