"use client"

import * as React from "react"

export type Theme = "dark" | "light"

const STORAGE_KEY = "theme"
const THEME_CHANGE_EVENT = "theme-change"

const ThemeContext = React.createContext<{
  theme: Theme
  toggle: () => void
}>({
  theme: "dark",
  toggle: () => {},
})

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

function resolveTheme(stored: string | null): Theme {
  if (stored === "light" || stored === "dark") return stored
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark"
}

function getSnapshot(): Theme {
  if (typeof window === "undefined") return "dark"
  return resolveTheme(localStorage.getItem(STORAGE_KEY))
}

function subscribe(callback: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, callback)
  window.addEventListener("storage", callback)
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, callback)
    window.removeEventListener("storage", callback)
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = React.useSyncExternalStore<Theme>(
    subscribe,
    getSnapshot,
    () => "dark",
  )

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return React.useContext(ThemeContext)
}
