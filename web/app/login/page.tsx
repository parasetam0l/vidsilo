"use client";

import { ClapperboardIcon } from "lucide-react";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";

import { ThemeToggle } from "@/components/theme-toggle";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApiError } from "@/lib/api";

export default function LoginPage() {
  const t = useT();
  const { login, user } = useAuth();
  const router = useRouter();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (user) router.replace("/dashboard");
  }, [user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      router.replace("/dashboard");
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Sign in failed — try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-1 items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex aspect-square size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ClapperboardIcon className="size-5" />
          </div>
          <CardTitle className="text-xl">{t("loginTitle")}</CardTitle>
          <CardDescription>{t("loginSubtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="username">{t("loginUsername")}</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
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
                required
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
