"use client";

import * as React from "react";

import { getSiteConfig } from "@/lib/site-config";
import { LoadingCircle } from "@/components/loading";

// The root route decides where visitors land based on the library mode:
//   enabled    -> the public library
//   login_only -> the viewer login page (anonymous visitors)
//   disabled   -> the admin dashboard (auth required)
export default function Home() {
  React.useEffect(() => {
    getSiteConfig()
      .then((cfg) => {
        switch (cfg.libraryMode) {
          case "enabled":
            window.location.replace("/library");
            break;
          case "login_only":
            // Viewer login lands in the viewers round; for now the admin
            // login grants library access.
            window.location.replace("/login?next=/library");
            break;
          default:
            window.location.replace("/admin/dashboard");
        }
      })
      .catch(() => window.location.replace("/admin/dashboard"));
  }, []);
  return (
    <div className="grid min-h-screen place-items-center">
      <LoadingCircle />
    </div>
  );
}
