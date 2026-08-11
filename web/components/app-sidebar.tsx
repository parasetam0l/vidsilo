"use client"

import {
  BarChartIcon,
  ChevronsUpDownIcon,
  ClapperboardIcon,
  KeyRoundIcon,
  FilmIcon,
  FolderTreeIcon,
  LanguagesIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  Loader2Icon,
  LogOutIcon,
  MoonIcon,
  SettingsIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  SunIcon,
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useAuth } from "@/components/auth-provider"
import { useChangePasswordDialog } from "@/components/change-password-dialog"
import { useTheme } from "@/components/theme-provider"
import { useDialog } from "@/hooks/use-dialog"
import { useUploadDialog } from "@/components/upload-dialog"
import { useUploads } from "@/lib/upload-store"
import { useUrlDownloads } from "@/lib/url-download-store"
import { useQuery } from "@tanstack/react-query"
import { api, displayName, type StorageUsage } from "@/lib/api"
import { formatBytes } from "@/lib/format"
import { Progress } from "@/components/ui/progress"
import { locales, useI18n, useT } from "@/lib/i18n"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const router = useRouter()
  const t = useT()
  const { confirm } = useDialog()
  const { user, logout } = useAuth()
  const { theme, set: setTheme } = useTheme()
  const { locale, setLocale } = useI18n()
  const openChangePassword = useChangePasswordDialog()

  const navGroups = [
    {
      label: t("navMedia"),
      items: [
        { title: t("navDashboard"), url: "/dashboard", icon: LayoutDashboardIcon },
        { title: t("navEntries"), url: "/entries", icon: FilmIcon },
        { title: t("navCategories"), url: "/categories", icon: FolderTreeIcon },
      ],
    },
    {
      label: t("navAdministration"),
      items: [
        { title: t("navUsers"), url: "/users", icon: UsersIcon },
        { title: t("navJobs"), url: "/jobs", icon: ListChecksIcon },
        { title: t("navAnalytics"), url: "/analytics", icon: BarChartIcon },
        { title: t("navFlavors"), url: "/flavors", icon: SlidersHorizontalIcon },
        { title: t("navDomainAcls"), url: "/domain-acls", icon: ShieldIcon },
        { title: t("navSettings"), url: "/settings", icon: SettingsIcon },
      ],
    },
  ]

  async function handleLogout() {
    await logout()
    router.push("/login")
  }

  function askLogout() {
    confirm({
      title: t("signOutTitle"),
      description: t("signOutDesc"),
      confirmLabel: t("signOut"),
      cancelLabel: t("cancel"),
      onConfirm: handleLogout,
    })
  }

  const initials = user
    ? (displayName(user).slice(0, 2) || user.email.slice(0, 2)).toUpperCase()
    : ""

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
          <UploadProgressCard />
          <StorageUsageCard />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
                >
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground rounded-lg text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">{displayName(user)}</span>
                    <span className="truncate text-xs text-muted-foreground capitalize">
                      {user.role}
                    </span>
                  </div>
                  <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground" />
                </button>
              }
            />
            <DropdownMenuContent side="top" align="start" className="w-60">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex items-center gap-2 font-normal">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-sidebar-primary text-sidebar-primary-foreground rounded-lg text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-sm font-medium">{displayName(user)}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user.email} · {user.role}
                    </span>
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={openChangePassword}>
                  <KeyRoundIcon className="size-4" />
                  {t("changePassword")}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {theme === "dark" ? (
                      <MoonIcon className="size-4" />
                    ) : (
                      <SunIcon className="size-4" />
                    )}
                    {t("appearance")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent sideOffset={8}>
                    <DropdownMenuRadioGroup
                      value={theme}
                      onValueChange={(v) => setTheme(v as "dark" | "light")}
                    >
                      <DropdownMenuRadioItem value="light">
                        <SunIcon className="size-4" /> {t("lightMode")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="dark">
                        <MoonIcon className="size-4" /> {t("darkMode")}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <LanguagesIcon className="size-4" />
                    {t("langLabel")}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent sideOffset={8}>
                    <DropdownMenuRadioGroup value={locale} onValueChange={setLocale}>
                      {locales.map((l) => (
                        <DropdownMenuRadioItem key={l} value={l}>
                          <span className="uppercase">{l}</span>
                          <span className="text-muted-foreground">
                            {l === "en" ? t("langEnglish") : l}
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={askLogout}>
                  <LogOutIcon className="size-4" />
                  {t("signOut")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      ) : null}
    </Sidebar>
  )
}

// UploadProgressCard shows an ongoing upload/download with a circular
// progress ring above the user card; clicking reopens the upload dialog.
// The sidebar lives across page changes, so the card always reflects the
// current state.
function UploadProgressCard() {
  const t = useT()
  const openUpload = useUploadDialog()
  const uploads = useUploads()
  const urlJobs = useUrlDownloads()

  const activeUploads = uploads.filter((j) =>
    j.status === "uploading" || j.status === "queued" || j.status === "interrupted",
  )
  const activeUrls = urlJobs.filter((j) =>
    j.status === "downloading" || j.status === "queued" || j.status === "checking",
  )
  const total = activeUploads.length + activeUrls.length
  if (total === 0) return null

  const sum = activeUploads.reduce((acc, j) => acc + (j.progress || 0), 0)
  const urlUnknown = activeUrls.some((j) => j.progress < 0)
  const percent = Math.round(sum / Math.max(1, total))

  return (
    <button
      type="button"
      onClick={openUpload}
      className="mb-1 flex w-full items-center gap-2.5 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/40 px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent"
    >
      <ProgressRing percent={percent} indeterminate={urlUnknown} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">
          {t("uploadsInProgress", { n: total, s: total > 1 ? "s" : "" })}
        </p>
        <p className="truncate text-[11px] text-muted-foreground">
          {activeUploads.length > 0
            ? `${percent}%`
            : activeUrls.length > 0
              ? t("uploadDownloading")
              : ""}
        </p>
      </div>
    </button>
  )
}

function ProgressRing({
  percent,
  indeterminate,
}: {
  percent: number
  indeterminate: boolean
}) {
  const r = 13
  const c = 2 * Math.PI * r
  return (
    <div className="relative size-8 shrink-0">
      <svg viewBox="0 0 32 32" className="size-8 -rotate-90">
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          strokeWidth="3.5"
          className="stroke-sidebar-border"
        />
        {!indeterminate ? (
          <circle
            cx="16"
            cy="16"
            r={r}
            fill="none"
            strokeWidth="3.5"
            strokeLinecap="round"
            className="stroke-primary transition-all duration-300"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - percent / 100)}
          />
        ) : null}
      </svg>
      {indeterminate ? (
        <Loader2Icon className="absolute inset-0 m-auto size-4 animate-spin text-primary" />
      ) : null}
    </div>
  )
}

// StorageUsageCard shows permanent disk usage above the user card, below
// the upload status. Local drivers render a usage bar (used/total/free);
// S3 has no capacity so it shows the used size and object count instead.
function StorageUsageCard() {
  const t = useT()
  const { data } = useQuery({
    queryKey: ["storage-usage"],
    queryFn: () => api<StorageUsage>("/api/storage/usage"),
    refetchInterval: () =>
      document.visibilityState === "visible" ? 60_000 : false,
  })

  if (!data || data.totalBytes <= 0) {
    if (!data) return null
    // S3: no known capacity — used size + object count, no bar.
    return (
      <div className="mb-1 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/40 px-2.5 py-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium">{t("navStorage")}</span>
          <span className="font-mono text-muted-foreground">
            {formatBytes(data.usedBytes)}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {t("storageObjects", { n: data.objectCount })}
        </p>
      </div>
    )
  }

  const pct = Math.round((data.usedBytes / data.totalBytes) * 100)
  return (
    <div className="mb-1 rounded-lg border border-sidebar-border/60 bg-sidebar-accent/40 px-2.5 py-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{t("navStorage")}</span>
        <span className="font-mono text-muted-foreground">
          {formatBytes(data.usedBytes)}
        </span>
      </div>
      <Progress value={pct} className="mt-1.5 h-1.5" />
      <p className="mt-1 text-[11px] text-muted-foreground">
        {t("storageUsageLine", {
          pct,
          total: formatBytes(data.totalBytes),
          free: formatBytes(data.freeBytes),
        })}
      </p>
    </div>
  )
}
