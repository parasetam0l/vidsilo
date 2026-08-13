"use client"

import { MoonIcon, SunIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useTheme } from "@/components/theme-provider"
import { useT } from "@/lib/i18n"

export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const t = useT()
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      aria-label={theme === "dark" ? t("themeSwitchToLight") : t("themeSwitchToDark")}
    >
      {theme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
    </Button>
  )
}
