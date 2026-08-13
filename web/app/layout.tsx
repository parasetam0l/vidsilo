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
    default: "Vidsilo",
    template: "%s | Vidsilo",
  },
  description: "Vidsilo platform admin panel",
  // Private platform: nothing gets indexed (also enforced by robots.txt and
  // the X-Robots-Tag header).
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

const themeInitScript = `(function(){try{var t=localStorage.getItem("theme");var dark=t==="dark"||(t!="light"&&!window.matchMedia("(prefers-color-scheme: light)").matches);document.documentElement.classList.toggle("dark",dark)}catch(e){document.documentElement.classList.add("dark")}})()`;

// The root layout stays minimal (fonts + theme bootstrap). Section layouts
// mount the providers they need: /admin gets the full stack, /library and
// /login get theme/i18n/toasts, /embed gets only theme + i18n — so public
// pages never load the auth/dialog/upload bundles.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline theme script adds the "dark"
    // class to <html> before paint; React must not patch the class during
    // hydration or the page flashes to the wrong theme.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
