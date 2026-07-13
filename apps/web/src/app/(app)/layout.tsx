import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";

/**
 * The authenticated area. Everything under `(app)` — a route group, so it adds nothing to the
 * URL — renders inside the same shell.
 *
 * This has to be a *layout*, not a per-page wrapper: the App Router keeps a layout mounted across
 * navigations within its segment and swaps only `children`. Previously every page mounted its own
 * <AuthProvider><AppShell>, which put them in the page subtree — so each navigation unmounted and
 * remounted them, blanking the sidebar to a full-screen spinner and re-running /auth/me before any
 * chrome could paint. Here the session is fetched once and the chrome never unmounts.
 *
 * Public surfaces (the landing page, /login, /r/{token} calls, the token-link pages) live outside
 * this group and get no shell — and, importantly, never trigger the session fetch.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AppShell>{children}</AppShell>
    </AuthProvider>
  );
}
