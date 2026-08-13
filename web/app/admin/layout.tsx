// Thin server layout: the providers and shell live in the client
// AdminShell so heavy bundles (auth, dialogs, uploads) only load for
// /admin/* pages — not for the public library, login or embeds.
import { AdminShell } from "./admin-shell";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
