"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import {
  exitAcademy as apiExitAcademy,
  getMe,
  logout as apiLogout,
  setLocale as apiSetLocale,
  type Session,
} from "@/lib/api";

interface AuthValue {
  session: Session | null;
  loading: boolean;
  /** True only when the resolved session grants the capability code. */
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  changeLocale: (locale: "ar" | "en") => Promise<void>;
  exitAcademy: () => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return value;
}

/**
 * Client-side session holder (Sprint 2 §6.1). Fetches /auth/me once on mount; the
 * resolved role + permission set drive every nav item and affordance. Identity is the
 * Sanctum cookie, but authority is whatever the server says *now* — so a refresh()
 * re-reads it (a revoked role disappears without a re-login, §3.7). A failed fetch means
 * no valid session → the consumer redirects to /login.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      setSession(await getMe());
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const can = useCallback(
    (permission: string) => session?.permissions.includes(permission) ?? false,
    [session],
  );

  const signOut = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // logging out is best-effort; clear local state regardless
    }
    setSession(null);
    router.replace("/login");
  }, [router]);

  const changeLocale = useCallback(async (locale: "ar" | "en") => {
    await apiSetLocale(locale);
    setSession((prev) => (prev ? { ...prev, locale } : prev));
  }, []);

  const exitAcademy = useCallback(async () => {
    await apiExitAcademy();
    await refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        can,
        refresh,
        signOut,
        changeLocale,
        exitAcademy,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
