"use client"

import * as React from "react"

export type Theme = "dark" | "light"

const STORAGE_KEY = "theme"
const THEME_CHANGE_EVENT = "theme-change"

const ThemeContext = React.createContext<{
  theme: Theme
  toggle: () => void
  set: (t: Theme) => void
}>({
  theme: "dark",
  toggle: () => {},
  set: () => {},
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

  // Re-assert the class after hydration (the inline bootstrap script runs
  // pre-paint; this guarantees the DOM always matches the snapshot, even
  // after cross-tab storage events).
  React.useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function set(next: Theme) {
    localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }

  function toggle() {
    set(theme === "dark" ? "light" : "dark")
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle, set }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return React.useContext(ThemeContext)
}
