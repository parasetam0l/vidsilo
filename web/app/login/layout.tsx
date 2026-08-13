import { LoginProviders } from "./providers";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <LoginProviders>{children}</LoginProviders>;
}
