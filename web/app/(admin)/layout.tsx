"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppSidebar } from "@/components/app-sidebar";
import { PageLoader } from "@/components/loading";
import { useUploadDialog } from "@/components/upload-dialog";
import { useCreateUserAction } from "@/app/(admin)/users/page";
import { useCreateCategoryAction } from "@/app/(admin)/categories/page";
import { useCreateFlavorAction } from "@/app/(admin)/flavors/page";
import { useCreateAclAction } from "@/app/(admin)/domain-acls/page";
import { useCreatePlayerAction } from "@/app/(admin)/players/page";
import { useAuth } from "@/components/auth-provider";
import { PlusIcon, UploadCloudIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const openUpload = useUploadDialog();
  const createUser = useCreateUserAction();
  const createCategory = useCreateCategoryAction();
  const createFlavor = useCreateFlavorAction();
  const createAcl = useCreateAclAction();
  const createPlayer = useCreatePlayerAction();

  // Per-page app-bar action (page title lives in this header already).
  const action =
    pathname === "/entries"
      ? { label: t("navUpload"), icon: <UploadCloudIcon className="size-4" />, onClick: openUpload }
      : pathname === "/users"
        ? { label: t("usersNew"), icon: <PlusIcon className="size-4" />, onClick: createUser }
        : pathname === "/categories"
          ? { label: t("newCategory"), icon: <PlusIcon className="size-4" />, onClick: createCategory }
          : pathname === "/flavors"
            ? { label: t("flavorsNew"), icon: <PlusIcon className="size-4" />, onClick: createFlavor }
            : pathname === "/domain-acls"
              ? { label: t("aclNew"), icon: <PlusIcon className="size-4" />, onClick: createAcl }
              : pathname === "/players"
                ? { label: t("playersNew"), icon: <PlusIcon className="size-4" />, onClick: createPlayer }
                : null;
  const pageTitles: Record<string, string> = {
    "/dashboard": t("navDashboard"),
    "/entries": t("navEntries"),
    "/upload": t("navUpload"),
    "/users": t("navUsers"),
    "/jobs": t("navJobs"),
    "/analytics": t("navAnalytics"),
    "/categories": t("navCategories"),
    "/flavors": t("navFlavors"),
    "/domain-acls": t("navDomainAcls"),
    "/players": t("navPlayers"),
    "/storage": t("navStorage"),
    "/settings": t("navSettings"),
  };
  const pageTitle = pageTitles[pathname] ?? t("appTitle");

  // Translatable window title per page: "Dashboard | VOD Admin".
  // The <title> element is React-managed (RSC payload) and gets re-asserted
  // on re-renders (e.g. the auth loading transition), so re-apply the title
  // after every commit, deferred past React's head sync.
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      document.title = `${pageTitle} | ${t("appTitle")}`;
    }, 0);
    return () => window.clearTimeout(id);
  });

  // Unauthenticated visitors are sent to the login page, returning to the
  // page they tried to open after signing in.
  React.useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [loading, user, pathname, router]);

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
            {action ? (
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
