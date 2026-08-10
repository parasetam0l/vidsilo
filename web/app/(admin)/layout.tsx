"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { useAuth } from "@/components/auth-provider";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/lib/i18n";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";



export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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
  const pageTitle = pageTitles[pathname] ?? "VOD Admin";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        {t("loading")}
      </div>
    );
  }
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        <a href="/login" className="underline">
          {t("navSignIn")}
        </a>
      </div>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "17rem",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-2 data-vertical:h-4 data-vertical:self-auto"
          />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden md:block">
                <BreadcrumbLink href="/dashboard">{t("appName")}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden md:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{pageTitle}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
