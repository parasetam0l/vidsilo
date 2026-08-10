"use client"

import {
  ChevronsUpDownIcon,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/components/auth-provider"
import { useUploadDialog } from "@/components/upload-dialog"
import { useT } from "@/lib/i18n"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const router = useRouter()
  const t = useT()
  const { user, logout } = useAuth()
  const openUpload = useUploadDialog()

  const navGroups = [
    {
      label: t("navMedia"),
      items: [
        { title: t("navDashboard"), url: "/dashboard", icon: LayoutDashboardIcon },
        { title: t("navEntries"), url: "/entries", icon: FilmIcon },
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
        <SidebarGroup>
          <SidebarMenu className="gap-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === "/upload"}
                render={<button type="button" onClick={openUpload} />}
              >
                <UploadIcon />
                <span>{t("navUpload")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
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
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                >
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
                  <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
              }
            />
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="capitalize">
                {user.username} · {user.role}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>
                <LogOutIcon className="size-4" />
                {t("signOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      ) : null}
    </Sidebar>
  )
}
