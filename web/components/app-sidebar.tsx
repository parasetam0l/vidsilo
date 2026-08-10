"use client"

import {
  ClapperboardIcon,
  FilmIcon,
  FolderTreeIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react"
import { usePathname, useRouter } from "next/navigation"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAuth } from "@/components/auth-provider"
import { useT } from "@/lib/i18n"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const router = useRouter()
  const t = useT()
  const { user, logout } = useAuth()

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

  async function handleLogout() {
    await logout()
    router.push("/login")
  }

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
      {user ? (
        <SidebarFooter>
          <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
            <Avatar className="size-8">
              <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground text-xs">
                {user.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-medium">{user.username}</span>
              <span className="truncate text-xs text-muted-foreground capitalize">
                {user.role}
              </span>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("signOut")}
                    onClick={handleLogout}
                  >
                    <LogOutIcon className="size-4" />
                  </Button>
                }
              />
              <TooltipContent side="right">{t("signOut")}</TooltipContent>
            </Tooltip>
          </div>
        </SidebarFooter>
      ) : null}
    </Sidebar>
  )
}
