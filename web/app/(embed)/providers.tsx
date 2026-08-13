"use client";

import * as React from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/lib/i18n";

// The embed surface is the slimmest possible: theme + i18n only, so
// third-party pages embedding /embed/{uuid} never download the auth,
// dialog, upload or toast bundles.
export function EmbedProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>{children}</I18nProvider>
    </ThemeProvider>
  );
}
