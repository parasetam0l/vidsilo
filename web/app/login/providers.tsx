"use client";

import * as React from "react";

import { ThemeProvider } from "@/components/theme-provider";
import { I18nProvider } from "@/lib/i18n";
import { AuthProvider } from "@/components/auth-provider";
import { Toaster } from "@/components/toaster";

// Sign-in pages need auth (the login form calls the auth provider), theme
// and i18n — nothing else from the admin stack.
export function LoginProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AuthProvider>
          {children}
          <Toaster />
        </AuthProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
