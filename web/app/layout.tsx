import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { AuthProvider } from "@/components/auth-provider";
import { Toaster } from "@/components/toaster";
import { UploadNotifications } from "@/components/upload-notifications";
import { DialogProvider } from "@/hooks/use-dialog";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "VOD Admin",
    template: "%s | VOD Admin",
  },
  description: "VOD platform admin panel",
};

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");var dark=t==="dark"||(t!="light"&&!window.matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.classList.toggle("dark",dark)}catch(e){document.documentElement.classList.add("dark")}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <QueryProvider>
          <ThemeProvider>
            <I18nProvider>
              <AuthProvider>
                <DialogProvider>{children}</DialogProvider>
              </AuthProvider>
              <UploadNotifications />
              <Toaster />
            </I18nProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
