import { ViewerLoginProviders } from "./providers";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <ViewerLoginProviders>{children}</ViewerLoginProviders>;
}
