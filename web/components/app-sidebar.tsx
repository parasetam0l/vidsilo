"use client"

import {
  FilmIcon,
  FolderTreeIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  UploadIcon,
  UsersIcon,
  ClapperboardIcon,
} from "lucide-react"
import { usePathname } from "next/navigation"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { useT } from "@/lib/i18n"



export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const t = useT()
  const navGroups = [
    {
      label: t("navMedia"),
      items: [
        { title: t("navDashboard"), url: "/dashboard", icon: LayoutDashboardIcon },
        { title: t("navEntries"), url: "/entries", icon: FilmIcon },
        { title: t("navUpload"), url: "/upload", icon: UploadIcon },
      ],
    },
    {
      label: t("navAdministration"),
      items: [
        { title: t("navUsers"), url: "/users", icon: UsersIcon },
        { title: t("navCategories"), url: "/categories", icon: FolderTreeIcon },
        { title: t("navFlavors"), url: "/flavors", icon: SlidersHorizontalIcon },
        { title: t("navSettings"), url: "/settings", icon: SettingsIcon },
      ],
    },
  ]
  return (
    <Sidebar variant="floating" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<a href="/dashboard" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <ClapperboardIcon className="size-4" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-medium">{t("appName")}</span>
                <span className="text-muted-foreground">{t("appVersion")}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarMenu className="gap-1">
              {group.items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={pathname === item.url}
                    render={<a href={item.url} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  )
}
