"use client";

import { ClapperboardIcon } from "lucide-react";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { firstIssue, loginSchema } from "@/lib/validators";

import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelect } from "@/components/language-select";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ApiError } from "@/lib/api";

export default function LoginPage() {
  // useSearchParams must sit under a Suspense boundary for the static export.
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginForm() {
  const t = useT();
  const { login, user } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  // Same-origin return path only (no open redirect).
  const rawNext = params.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();

  React.useEffect(() => {
    document.title = `${t("loginTitle")} | ${t("appTitle")}`;
    if (user) router.replace(next);
  }, [user, router, next, t]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const issue = firstIssue(loginSchema, { email, password });
    if (issue) {
      toast.error(issue);
      return;
    }
    setBusy(true);
    try {
      await login(email, password);
      router.replace(next);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : t("loginFailed"));
    } finally {
      setBusy(false);
    }
  }

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
        <span className="text-2xl font-semibold tracking-tight">
          {t("appName")}
        </span>
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <CardTitle className="text-xl">{t("loginTitle")}</CardTitle>
          <CardDescription>{t("loginPrompt")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">{t("loginEmail")}</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">{t("loginPassword")}</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? t("loginSigningIn") : t("loginButton")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
