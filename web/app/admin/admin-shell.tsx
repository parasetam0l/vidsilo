"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { PageLoader } from "@/components/loading";
import { useUploadDialog } from "@/components/upload-dialog";
import { useCreateUserAction } from "@/app/admin/users/page";
import { useCreateCategoryAction } from "@/app/admin/categories/page";
import { useCreateFlavorAction } from "@/app/admin/flavors/page";
import { useCreateAclAction } from "@/app/admin/domain-acls/page";
import { useCreatePlayerAction } from "@/app/admin/players/page";
import { useCreateViewerAction } from "@/app/admin/viewers/page";
import { useAuth } from "@/components/auth-provider";
import { getSiteConfig } from "@/lib/site-config";
import { PlusIcon, UploadCloudIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

import { Separator } from "@/components/ui/separator";
import { useT } from "@/lib/i18n";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

import { QueryProvider } from "@/components/query-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/components/auth-provider";
import { DialogProvider } from "@/hooks/use-dialog";
import { Toaster } from "@/components/toaster";
import { UploadNotifications } from "@/components/upload-notifications";
import { AnalyticsRange } from "@/components/analytics-range";

// AdminProviders mounts everything the admin pages need. This lives here —
// not in the root layout — so the public pages stay lean.
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ThemeProvider>
        <I18nProvider>
          <AuthProvider>
            <DialogProvider>
              <AdminLayoutBody>{children}</AdminLayoutBody>
              <UploadNotifications />
            </DialogProvider>
          </AuthProvider>
          <Toaster />
        </I18nProvider>
      </ThemeProvider>
    </QueryProvider>
  );
}

function AdminLayoutBody({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const { user, loading } = useAuth();
  const openUpload = useUploadDialog();
  const createUser = useCreateUserAction();
  const createCategory = useCreateCategoryAction();
  const createFlavor = useCreateFlavorAction();
  const createAcl = useCreateAclAction();
  const createPlayer = useCreatePlayerAction();
  const createViewer = useCreateViewerAction();

  // The staff login renders inside the providers but without the sidebar
  // chrome and without the auth gate (it must show while unauthenticated).
  const isLogin = pathname === "/admin/login";

  // Per-page app-bar action (page title lives in this header already).
  const action =
    pathname === "/admin/entries"
      ? { label: t("navUpload"), icon: <UploadCloudIcon className="size-4" />, onClick: openUpload }
      : pathname === "/admin/users"
        ? { label: t("usersNew"), icon: <PlusIcon className="size-4" />, onClick: createUser }
        : pathname === "/admin/categories"
          ? { label: t("newCategory"), icon: <PlusIcon className="size-4" />, onClick: createCategory }
          : pathname === "/admin/flavors"
            ? { label: t("flavorsNew"), icon: <PlusIcon className="size-4" />, onClick: createFlavor }
            : pathname === "/admin/domain-acls"
              ? { label: t("aclNew"), icon: <PlusIcon className="size-4" />, onClick: createAcl }
              : pathname === "/admin/players"
                ? { label: t("playersNew"), icon: <PlusIcon className="size-4" />, onClick: createPlayer }
                : pathname === "/admin/viewers"
                  ? { label: t("viewerNew"), icon: <PlusIcon className="size-4" />, onClick: createViewer }
                  : null;
  const pageTitles: Record<string, string> = {
    "/admin/dashboard": t("navDashboard"),
    "/admin/entries": t("navEntries"),
    "/admin/upload": t("navUpload"),
    "/admin/users": t("navUsers"),
    "/admin/jobs": t("navJobs"),
    "/admin/analytics": t("navAnalytics"),
    "/admin/categories": t("navCategories"),
    "/admin/flavors": t("navFlavors"),
    "/admin/domain-acls": t("navDomainAcls"),
    "/admin/players": t("navPlayers"),
    "/admin/viewers": t("navViewers"),
    "/admin/storage": t("navStorage"),
    "/admin/settings": t("navSettings"),
  };
  const pageTitle = pageTitles[pathname] ?? t("appTitle");

  // Translatable window title per page: "Dashboard | Vidsilo Admin".
  // The <title> element is React-managed (RSC payload) and gets re-asserted
  // on re-renders (e.g. the auth loading transition), so re-apply the title
  // after every commit, deferred past React's head sync. The site name comes
  // from the cached site-config (defaults to the app title on first paint).
  React.useEffect(() => {
    if (isLogin) return;
    const id = window.setTimeout(() => {
      getSiteConfig()
        .then((cfg) => {
          document.title = `${pageTitle} | ${cfg.siteName || t("appTitle")}`;
        })
        .catch(() => {
          document.title = `${pageTitle} | ${t("appTitle")}`;
        });
    }, 0);
    return () => window.clearTimeout(id);
  });

  // Unauthenticated visitors are sent to the staff login, returning to the
  // page they tried to open after signing in.
  React.useEffect(() => {
    if (isLogin) return;
    if (!loading && !user) {
      router.replace(`/admin/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, pathname, router, isLogin]);

  if (isLogin) {
    return <>{children}</>;
  }
  if (loading || !user) {
    return <PageLoader />;
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "17rem",
          "--header-height": "3.5rem",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
          <div className="flex w-full items-center gap-1 px-4 lg:gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mx-2 h-4 self-center"
            />
            <h1 className="text-base font-medium">{pageTitle}</h1>
            {pathname === "/admin/analytics" ? (
              <React.Suspense fallback={null}>
                <AnalyticsRange />
              </React.Suspense>
            ) : action ? (
              <Button className="ml-auto" onClick={action.onClick}>
                {action.icon} {action.label}
              </Button>
            ) : null}
          </div>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
