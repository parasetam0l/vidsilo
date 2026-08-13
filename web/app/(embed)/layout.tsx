import { EmbedProviders } from "./providers";

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <EmbedProviders>{children}</EmbedProviders>;
}
