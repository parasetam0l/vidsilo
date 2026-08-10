import type { NextConfig } from "next";

// Static export for the Go binary (Docker sets NEXT_OUTPUT=export);
// plain dev server (with API/upload/media proxying) otherwise.
const isExport = process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = {
  ...(isExport ? { output: "export" as const } : {}),
  ...(!isExport
    ? {
        async rewrites() {
          return [
            { source: "/api/:path*", destination: "http://localhost:8090/api/:path*" },
            { source: "/upload/:path*", destination: "http://localhost:8090/upload/:path*" },
            { source: "/media/:path*", destination: "http://localhost:8090/media/:path*" },
            { source: "/play/:path*", destination: "http://localhost:8090/play/:path*" },
            { source: "/embed/:path*", destination: "http://localhost:8090/embed/:path*" },
          ];
        },
      }
    : {}),
};

export default nextConfig;
