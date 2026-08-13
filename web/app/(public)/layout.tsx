import type { Metadata } from "next";

import { LibraryProviders } from "./providers";

// Library pages share this metadata (server component, exported statically)
// and a lean provider stack (theme/i18n/toasts — no admin bundles).
export const metadata: Metadata = {
  title: "Library",
  description: "Browse and watch the public video library.",
};

export default function LibraryLayout({ children }: { children: React.ReactNode }) {
  return <LibraryProviders>{children}</LibraryProviders>;
}
