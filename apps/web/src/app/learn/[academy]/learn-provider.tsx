"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  AuthForm,
  RedeemForm,
  type AuthMode,
} from "@/components/learn/auth-forms";
import {
  LearnContext,
  type LearnContextValue,
} from "@/components/learn/context";
import {
  SiteFooter,
  SiteHeader,
  SiteWhatsappButton,
} from "@/components/learn/site-chrome";
import { useSitePreview } from "@/components/learn/preview-bridge";
import { SiteTheme } from "@/components/learn/theme";
import { SiteModal } from "@/components/learn/site-modal";
import { resolveSiteName } from "@/lib/learn-brand";
import {
  clearLearnToken,
  getLearnToken,
  learnLogout,
  learnMe,
  type LearnProfile,
  type LearnSiteCommerce,
  type LearnSiteContent,
  type LearnSiteStats,
} from "@/lib/learn-api";

/**
 * State + chrome for one academy's public course site (docs/lms/09).
 *
 * The site CONTENT arrives as a prop — the layout fetched it on the server, so the branded header
 * paints immediately and there is no unbranded flash. Only the learner's own state (token, profile,
 * enrolments) is resolved in the browser, because it is per-visitor and cannot be cached per tenant.
 *
 * Sign-in and redeem exist both as modals here (so a CTA anywhere on the site never loses the
 * visitor's place) and as real pages; both render the same forms from components/learn/auth-forms.
 */

/** Nothing switched on — what an older API build (no `commerce` block) degrades to. */
const NO_COMMERCE: LearnSiteCommerce = {
  free: false,
  free_course: null,
  checkout: false,
  codes: false,
  paid: false,
};

export function LearnProvider({
  academy,
  site: published,
  stats,
  commerce,
  academyName,
  siteUrl,
  children,
}: {
  academy: string;
  site: LearnSiteContent;
  stats: LearnSiteStats;
  commerce?: LearnSiteCommerce;
  academyName: string;
  siteUrl?: string | null;
  children: ReactNode;
}) {
  const t = useTranslations("learn");
  const pathname = usePathname();

  // Inside the site builder's preview frame this is the unsaved draft, updated on every keystroke;
  // everywhere else it is null and the site renders what the server sent (preview-bridge.tsx).
  const draft = useSitePreview();
  const site = draft ?? published;

  const [learner, setLearner] = useState<LearnProfile | null>(null);
  const [enrolled, setEnrolled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [afterAuth, setAfterAuth] = useState<(() => void) | null>(null);
  const [authIntent, setAuthIntent] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!getLearnToken(academy)) {
      setLearner(null);
      setEnrolled(new Set());
      setLoading(false);
      return;
    }
    try {
      const me = await learnMe(academy);
      setLearner(me.learner);
      setEnrolled(new Set(me.enrolled_course_ids));
    } catch {
      clearLearnToken(academy);
      setLearner(null);
      setEnrolled(new Set());
    } finally {
      setLoading(false);
    }
  }, [academy]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    try {
      await learnLogout(academy);
    } catch {
      /* best effort — the local token is cleared either way */
    }
    clearLearnToken(academy);
    setLearner(null);
    setEnrolled(new Set());
  }, [academy]);

  const requireAuth = useCallback(
    (then?: () => void, intent?: string) => {
      if (learner) {
        then?.();
        return;
      }
      setAfterAuth(() => then ?? null);
      setAuthIntent(intent ?? null);
      setAuthMode("login");
    },
    [learner],
  );

  // The handle is an address, not a brand: a site that has neither a brand name nor a real academy
  // name says "the learning platform" in the visitor's language rather than publishing its slug.
  const siteName =
    resolveSiteName(site.brand.name, academyName, academy) ?? t("brand.fallbackName");
  const resolvedCommerce = commerce ?? NO_COMMERCE;

  const value = useMemo<LearnContextValue>(
    () => ({
      academy,
      site,
      stats,
      commerce: resolvedCommerce,
      siteName,
      siteUrl: siteUrl ?? null,
      learner,
      enrolled,
      loading,
      isEnrolled: (id) => enrolled.has(id),
      refresh,
      logout,
      requireAuth,
      openAuth: (mode: AuthMode = "login") => setAuthMode(mode),
      openRedeem: () => requireAuth(() => setRedeemOpen(true)),
    }),
    [
      academy,
      site,
      stats,
      resolvedCommerce,
      siteName,
      siteUrl,
      learner,
      enrolled,
      loading,
      refresh,
      logout,
      requireAuth,
    ],
  );

  // The player is a focus surface: marketing chrome around a lesson video is noise, and the lesson
  // sidebar already carries its own navigation back to the course.
  const bare = pathname?.includes("/watch/") ?? false;

  return (
    <LearnContext.Provider value={value}>
      <SiteTheme color={site.brand.color}>
        {bare ? (
          <main className="min-h-screen">{children}</main>
        ) : (
          <div className="flex min-h-screen flex-col">
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
            {/* Everywhere but the player: a floating CTA over a lesson video is exactly the kind of
                chrome the bare branch exists to remove. */}
            <SiteWhatsappButton />
          </div>
        )}
      </SiteTheme>

      {authMode !== null && (
        <SiteModal
          open
          onClose={() => {
            setAuthMode(null);
            setAuthIntent(null);
          }}
          title={authMode === "login" ? t("auth.signIn") : t("auth.register")}
        >
          <AuthForm
            academy={academy}
            mode={authMode}
            intent={authIntent ?? undefined}
            onModeChange={setAuthMode}
            onDone={async () => {
              setAuthMode(null);
              setAuthIntent(null);
              await refresh();
              const cb = afterAuth;
              setAfterAuth(null);
              // The visitor came here to do something. Signing in finishes that, rather than
              // dropping them on whatever page happened to be behind the dialog.
              cb?.();
            }}
          />
        </SiteModal>
      )}

      {redeemOpen && (
        <SiteModal
          open
          onClose={() => setRedeemOpen(false)}
          title={t("redeem.title")}
        >
          <RedeemForm
            academy={academy}
            onDone={async () => {
              setRedeemOpen(false);
              await refresh();
            }}
          />
        </SiteModal>
      )}
    </LearnContext.Provider>
  );
}
