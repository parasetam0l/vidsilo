"use client";

import * as React from "react";
import Link from "next/link";

import { api, type CatalogCategory, type CatalogResponse, type Viewer } from "@/lib/api";
import { getSiteConfig, useSiteName } from "@/lib/site-config";
import { useT } from "@/lib/i18n";
import { formatDuration } from "@/lib/format";
import { LoadingCircle } from "@/components/loading";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSelect } from "@/components/language-select";
import { ClapperboardIcon, FilmIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 24;

export default function LibraryPage() {
  const t = useT();
  const siteName = useSiteName();
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

  // Tab title: the configured site name (VOD App by default).
  React.useEffect(() => {
    if (!siteName) return;
    const id = window.setTimeout(() => {
      document.title = siteName;
    }, 0);
    return () => window.clearTimeout(id);
  }, [siteName]);

  // Gate: when the library is disabled, the site root already redirects —
  // this catches direct visits to /library. In login_only mode anonymous
  // visitors go to the viewer login.
  const [viewer, setViewer] = React.useState<Viewer | null | undefined>(undefined);
  React.useEffect(() => {
    getSiteConfig()
      .then((cfg) => {
        if (cfg.libraryMode === "disabled") {
          window.location.replace("/admin/login");
          return;
        }
        if (cfg.libraryMode !== "login_only") return;
        // login_only: a viewer or staff session is required.
        api<Viewer>("/api/viewer/me")
          .then(setViewer)
          .catch(() =>
            api("/api/auth/me")
              .then(() => setViewer(null))
              .catch(() => window.location.replace("/login")),
          );
      })
      .catch(() => {});
  }, []);

  const signOut = () => {
    api("/api/viewer/logout", { method: "POST" })
      .catch(() => {})
      .finally(() => window.location.reload());
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
    <main className="min-h-screen w-full">
      {/* Top bar: brand + session controls only (search/sort live below) */}
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ClapperboardIcon className="size-4" />
            </div>
            <span className="flex flex-col leading-none">
              <span className="text-sm font-semibold text-foreground">{siteName}</span>
              <span className="mt-0.5 text-xs text-muted-foreground">{t("appVersion")}</span>
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2">
            {viewer ? (
              <>
                <Avatar className="size-8 rounded-lg">
                  <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                    {viewer.email.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <Button variant="ghost" size="sm" onClick={signOut} className="h-8 gap-1.5 text-xs">
                  {t("librarySignOut")}
                </Button>
              </>
            ) : null}
            <LanguageSelect />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        {/* Toolbar: search + sort above the categories (e-commerce style) */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-md">
            <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("librarySearchPlaceholder")}
              aria-label={t("librarySearchPlaceholder")}
              className="h-9 w-full pl-8 text-sm"
            />
          </div>
          <div className="ml-auto">
            <Select
              options={[
                { value: "newest", label: t("librarySortNewest") },
                { value: "oldest", label: t("librarySortOldest") },
                { value: "title", label: t("librarySortTitle") },
                { value: "duration", label: t("librarySortDuration") },
              ]}
              className="h-9 w-auto text-sm"
              value={sort}
              onChange={setSort}
              aria-label={t("librarySortLabel")}
            />
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-6 md:flex-row">
          {/* Category sidebar: top + sub categories, click to filter */}
          <aside className="w-full shrink-0 md:w-52">
            {categories.length > 0 ? (
              <nav
                className="flex gap-1 overflow-x-auto pb-1 md:sticky md:top-20 md:flex-col md:gap-0.5 md:overflow-visible md:rounded-xl md:border md:bg-card md:p-1.5"
                aria-label={t("navCategories")}
              >
                <button
                  onClick={() => setCategory("")}
                  className={cn(
                    "flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                    category === ""
                      ? "bg-accent font-medium text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span className="truncate">{t("libraryAllCategories")}</span>
                  <span className="shrink-0 text-xs opacity-60 tabular-nums">{total}</span>
                </button>
                {categories.map((c) => (
                  <React.Fragment key={c.id}>
                    <button
                      onClick={() => setCategory(String(c.id))}
                      className={cn(
                        "flex items-center justify-between gap-2 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm transition-colors",
                        category === String(c.id)
                          ? "bg-accent font-medium text-accent-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <span className="truncate">{c.name}</span>
                      {c.count > 0 ? (
                        <span className="shrink-0 text-xs opacity-60 tabular-nums">{c.count}</span>
                      ) : null}
                    </button>
                    {c.children?.map((child) => (
                      <button
                        key={child.id}
                        onClick={() => setCategory(String(child.id))}
                        className={cn(
                          "flex items-center justify-between gap-2 whitespace-nowrap rounded-lg py-1.5 pl-7 pr-2.5 text-sm transition-colors",
                          category === String(child.id)
                            ? "bg-accent font-medium text-accent-foreground"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                      >
                        <span className="truncate">{child.name}</span>
                        {child.count > 0 ? (
                          <span className="shrink-0 text-xs opacity-60 tabular-nums">{child.count}</span>
                        ) : null}
                      </button>
                    ))}
                  </React.Fragment>
                ))}
              </nav>
            ) : null}
            {/* Video count under the category card */}
            <div className="mt-2 flex items-center gap-1.5 rounded-xl border bg-card px-3 py-2 text-xs text-muted-foreground">
              <FilmIcon className="size-3.5 shrink-0" />
              <span>{t("libraryResults", { total, n: total })}</span>
            </div>
          </aside>

          {/* Catalog */}
          <div className="min-w-0 flex-1">
            {error ? (
              <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
                <FilmIcon className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            ) : loading && items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-24">
                <LoadingCircle />
                <span className="text-sm text-muted-foreground">{t("loading")}</span>
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
                <FilmIcon className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {q || category ? t("libraryNoResults") : t("libraryEmpty")}
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xxl:grid-cols-4">
                  {items.map((item) => (
                    <Link
                      key={item.id}
                      href={`/play/${item.id}`}
                      className="group block overflow-hidden rounded-xl border bg-card shadow-xs transition-shadow hover:shadow-md"
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
                        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                        {item.category ? (
                          <p className="truncate text-xs text-muted-foreground">{item.category}</p>
                        ) : null}
                      </div>
                    </Link>
                  ))}
                </div>
                {hasMore ? (
                  <div className="mt-6 flex justify-center">
                    <Button variant="outline" onClick={loadMore} className="h-8 gap-1.5 text-xs">
                      {t("libraryLoadMore")}
                    </Button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
