"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/components/auth-provider";

import { Separator } from "@/components/ui/separator";
import { useT } from "@/lib/i18n";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";



export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useT();
  const { user, loading } = useAuth();
  const pageTitles: Record<string, string> = {
    "/dashboard": t("navDashboard"),
    "/entries": t("navEntries"),
    "/upload": t("navUpload"),
    "/users": t("navUsers"),
    "/categories": t("navCategories"),
    "/flavors": t("navFlavors"),
    "/settings": t("navSettings"),
  };
  const pageTitle = pageTitles[pathname] ?? t("appTitle");

  // Translatable window title per page: "Dashboard | VOD Admin".
  React.useEffect(() => {
    document.title = `${pageTitle} | ${t("appTitle")}`;
  }, [pageTitle, t]);

  // Unauthenticated visitors are sent to the login page, returning to the
  // page they tried to open after signing in.
  React.useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, pathname, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {t("loading")}
      </div>
    );
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
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
          <div className="flex w-full items-center gap-1 px-4 lg:gap-2">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mx-2 data-[orientation=vertical]:h-4"
            />
            <h1 className="text-base font-medium">{pageTitle}</h1>
          </div>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
