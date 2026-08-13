import type { MetadataRoute } from "next";

// Static export requires this route to be explicitly static.
export const dynamic = "force-static";

// The app is a private Vidsilo platform: block every crawler from indexing
// anything (mirrored by the X-Robots-Tag header and the noindex meta tag).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
