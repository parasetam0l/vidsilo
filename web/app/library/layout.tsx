import type { Metadata } from "next";

// Library pages share this metadata (server component, exported statically).
export const metadata: Metadata = {
  title: "Library",
  description: "Browse and watch the public video library.",
};

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
