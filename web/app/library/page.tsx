"use client";

import * as React from "react";
import Link from "next/link";

import { api, type CatalogCategory, type CatalogResponse, type Viewer } from "@/lib/api";
import { getSiteConfig } from "@/lib/site-config";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { formatDuration } from "@/lib/format";
import { LoadingCircle } from "@/components/loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ClapperboardIcon, FilmIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { changePasswordSchema, fieldErrors } from "@/lib/validators";

const PAGE_SIZE = 24;

export default function LibraryPage() {
  const t = useT();
  const dialog = useDialog();
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");
  const [category, setCategory] = React.useState<string>("");
  const [sort, setSort] = React.useState("newest");
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<CatalogResponse | null>(null);
  const [categories, setCategories] = React.useState<CatalogCategory[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const loading = data === null && error === null;
  // Refs of the active filters so async responses can detect stale state.
  const filtersRef = React.useRef({ debouncedQ, category, sort });
  const loadingMoreRef = React.useRef(false);
  React.useEffect(() => {
    filtersRef.current = { debouncedQ, category, sort };
  }, [debouncedQ, category, sort]);

  // Gate: when the library is disabled, the site root already redirects —
  // this catches direct visits to /library. In login_only mode anonymous
  // visitors go to the viewer login.
  const [viewer, setViewer] = React.useState<Viewer | null | undefined>(undefined);
  React.useEffect(() => {
    getSiteConfig()
      .then((cfg) => {
        if (cfg.libraryMode === "disabled") {
          window.location.replace("/admin/dashboard");
          return;
        }
        if (cfg.libraryMode !== "login_only") return;
        // login_only: a viewer or staff session is required.
        api<Viewer>("/api/viewer/me")
          .then(setViewer)
          .catch(() =>
            api("/api/auth/me")
              .then(() => setViewer(null))
              .catch(() => window.location.replace("/library/login")),
          );
      })
      .catch(() => {});
  }, []);

  const signOut = () => {
    api("/api/viewer/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => window.location.reload());
  };

  const openChangePassword = () => {
    if (!viewer) return;
    dialog.open({
      content: (close) => <ViewerPasswordContent onClose={close} />,
      size: "sm",
      dismissible: false,
      showCloseButton: false,
    });
  };

  React.useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  React.useEffect(() => {
    api<CatalogCategory[]>("/api/catalog/categories")
      .then(setCategories)
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: "1", limit: String(PAGE_SIZE) });
    if (debouncedQ) params.set("q", debouncedQ);
    if (category) params.set("category", category);
    if (sort === "title") params.set("sort", "title");
    if (sort === "oldest") params.set("sort", "oldest");
    if (sort === "duration") params.set("sort", "duration");
    api<CatalogResponse>(`/api/catalog?${params}`)
      .then((res) => {
        if (!cancelled) {
          setError(null);
          setData(res);
          setPage(1);
        }
      })
      .catch(() => {
        if (!cancelled) setError(t("libraryError"));
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, category, sort, t]);

  const loadMore = () => {
    if (loadingMoreRef.current) return; // one in-flight request at a time
    const snapshot = { ...filtersRef.current, next: page + 1 };
    loadingMoreRef.current = true;
    const params = new URLSearchParams({ page: String(snapshot.next), limit: String(PAGE_SIZE) });
    if (snapshot.debouncedQ) params.set("q", snapshot.debouncedQ);
    if (snapshot.category) params.set("category", snapshot.category);
    if (snapshot.sort === "title") params.set("sort", "title");
    if (snapshot.sort === "oldest") params.set("sort", "oldest");
    if (snapshot.sort === "duration") params.set("sort", "duration");
    api<CatalogResponse>(`/api/catalog?${params}`)
      .then((res) => {
        // Filters changed while the request was in flight: drop the stale
        // page instead of appending it to a different query's results.
        const f = filtersRef.current;
        if (f.debouncedQ !== snapshot.debouncedQ || f.category !== snapshot.category || f.sort !== snapshot.sort) {
          return;
        }
        setData((prev) => (prev ? { ...res, items: [...prev.items, ...res.items] } : res));
        setPage(snapshot.next);
      })
      .catch(() => {})
      .finally(() => {
        loadingMoreRef.current = false;
      });
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = items.length < total;

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/" className="flex items-center gap-2 text-muted-foreground">
          <ClapperboardIcon className="size-5" />
          <span className="text-sm font-medium">{t("appName")}</span>
        </Link>
        <h1 className="ml-2 text-2xl font-semibold">{t("libraryTitle")}</h1>
        <div className="ml-auto flex items-center gap-2">
          {viewer ? (
            <>
              <button
                onClick={openChangePassword}
                className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t("libraryChangePassword")}
              </button>
              <button
                onClick={signOut}
                className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t("librarySignOut")}
              </button>
            </>
          ) : null}
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("librarySearchPlaceholder")}
              aria-label={t("librarySearchPlaceholder")}
              className="h-9 w-48 rounded-md border bg-background pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            aria-label={t("librarySortLabel")}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="newest">{t("librarySortNewest")}</option>
            <option value="oldest">{t("librarySortOldest")}</option>
            <option value="title">{t("librarySortTitle")}</option>
            <option value="duration">{t("librarySortDuration")}</option>
          </select>
        </div>
      </header>

      {categories.length > 0 ? (
        <nav className="mt-4 flex flex-wrap gap-2" aria-label={t("navCategories")}>
          <button
            onClick={() => setCategory("")}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              category === ""
                ? "border-foreground bg-foreground text-background"
                : "hover:bg-muted",
            )}
          >
            {t("libraryAllCategories")}
          </button>
          {categories.map((c) => (
            <React.Fragment key={c.id}>
              <button
                onClick={() => setCategory(String(c.id))}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  category === String(c.id)
                    ? "border-foreground bg-foreground text-background"
                    : "hover:bg-muted",
                )}
              >
                {c.name}
                {c.count > 0 ? (
                  <span className="ml-1 text-xs opacity-60">{c.count}</span>
                ) : null}
              </button>
              {c.children?.map((child) => (
                <button
                  key={child.id}
                  onClick={() => setCategory(String(child.id))}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    category === String(child.id)
                      ? "border-foreground bg-foreground text-background"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {child.name}
                  {child.count > 0 ? (
                    <span className="ml-1 text-xs opacity-60">{child.count}</span>
                  ) : null}
                </button>
              ))}
            </React.Fragment>
          ))}
        </nav>
      ) : null}

      <p className="mt-4 text-sm text-muted-foreground">
        {t("libraryResults", { total, n: total })}
      </p>

      {error ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <FilmIcon className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : loading && items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <LoadingCircle />
          <span className="text-sm text-muted-foreground">{t("loading")}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <FilmIcon className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{t("libraryEmpty")}</p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <Link
                key={item.id}
                href={`/library/play/${item.id}`}
                className="group block overflow-hidden rounded-lg border bg-card transition-shadow hover:shadow-md"
              >
                <div className="relative aspect-video w-full overflow-hidden bg-muted">
                  {item.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.poster}
                      alt={item.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-muted-foreground">
                      <FilmIcon className="size-8" />
                    </div>
                  )}
                  {item.durationMs != null && item.durationMs > 0 ? (
                    <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-xs tabular-nums text-white">
                      {formatDuration(item.durationMs)}
                    </span>
                  ) : null}
                </div>
                <div className="p-2.5">
                  <p className="truncate text-sm font-medium">{item.title}</p>
                  {item.category ? (
                    <p className="truncate text-xs text-muted-foreground">{item.category}</p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
          {hasMore ? (
            <div className="mt-6 flex justify-center">
              <button
                onClick={loadMore}
                className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
              >
                {t("libraryLoadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}

// ViewerPasswordContent lets a signed-in viewer rotate their own password
// (the admin can also do it from /admin/viewers).
function ViewerPasswordContent({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = fieldErrors(changePasswordSchema, {
      currentPassword: current,
      newPassword: next,
      confirm,
    });
    if (Object.keys(errs).length > 0) {
      setError(errs.confirm ?? errs.currentPassword ?? errs.newPassword ?? t("error"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api("/api/viewer/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      onClose();
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={submit}
      noValidate
    >
      <DialogHeader className="px-4 pt-4">
        <DialogTitle>{t("libraryChangePassword")}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4 px-4">
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("currentPassword")}</Label>
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="rounded-lg"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("newPassword")}</Label>
          <Input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="rounded-lg"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium">{t("confirmPassword")}</Label>
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="rounded-lg"
          />
        </div>
        {error ? <FormError message={error} /> : null}
      </div>
      <DialogFooter className="mx-0 mb-0">
        <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={saving || !current || !next}>
          {saving ? t("loading") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
