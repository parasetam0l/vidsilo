import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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

// The root layout stays minimal (fonts + theme bootstrap). Section layouts
// mount the providers they need: /admin gets the full stack, /library and
// /login get theme/i18n/toasts, /embed gets only theme + i18n — so public
// pages never load the auth/dialog/upload bundles.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
