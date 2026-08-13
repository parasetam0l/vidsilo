"use client";

import * as React from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/lib/i18n";
import { Toaster } from "@/components/toaster";

// Library pages get theme + i18n + toasts only — no auth/dialog/upload
// bundles (the player pages toast errors).
export function LibraryProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        {children}
        <Toaster />
      </I18nProvider>
    </ThemeProvider>
  );
}
