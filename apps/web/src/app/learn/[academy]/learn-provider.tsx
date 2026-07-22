"use client";

import { GraduationCap, LogOut, Ticket, UserCircle2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  clearLearnToken,
  getLearnToken,
  learnLogin,
  learnLogout,
  learnMe,
  learnRedeem,
  learnRegister,
  setLearnToken,
  type LearnProfile,
} from "@/lib/learn-api";

interface LearnContextValue {
  academy: string;
  learner: LearnProfile | null;
  enrolled: Set<string>;
  loading: boolean;
  isEnrolled: (courseId: string) => boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  requireAuth: (then?: () => void) => void;
  openRedeem: () => void;
}

const LearnContext = createContext<LearnContextValue | null>(null);

export function useLearn(): LearnContextValue {
  const ctx = useContext(LearnContext);
  if (ctx === null) throw new Error("useLearn must be used inside LearnProvider");
  return ctx;
}

const inputCls =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-3";

export function LearnProvider({ academy, children }: { academy: string; children: ReactNode }) {
  const t = useTranslations("learn");

  const [learner, setLearner] = useState<LearnProfile | null>(null);
  const [enrolled, setEnrolled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [afterAuth, setAfterAuth] = useState<(() => void) | null>(null);

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
      /* best effort */
    }
    clearLearnToken(academy);
    setLearner(null);
    setEnrolled(new Set());
  }, [academy]);

  const requireAuth = useCallback(
    (then?: () => void) => {
      if (learner) {
        then?.();
        return;
      }
      setAfterAuth(() => then ?? null);
      setAuthOpen(true);
    },
    [learner],
  );

  const value: LearnContextValue = {
    academy,
    learner,
    enrolled,
    loading,
    isEnrolled: (id) => enrolled.has(id),
    refresh,
    logout,
    requireAuth,
    openRedeem: () => requireAuth(() => setRedeemOpen(true)),
  };

  return (
    <LearnContext.Provider value={value}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <Link href={`/learn/${academy}`} className="flex items-center gap-2 font-semibold">
              <GraduationCap className="text-primary size-5" />
              {t("brand")}
            </Link>
            <div className="ms-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={value.openRedeem}>
                <Ticket /> {t("redeem.cta")}
              </Button>
              {learner ? (
                <>
                  <Link href={`/learn/${academy}/me`}>
                    <Button variant="ghost" size="sm">
                      <UserCircle2 /> {learner.full_name.split(" ")[0]}
                    </Button>
                  </Link>
                  <Button variant="ghost" size="icon-sm" aria-label={t("auth.logout")} onClick={() => void logout()}>
                    <LogOut />
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => requireAuth()}>
                  {t("auth.signIn")}
                </Button>
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </div>

      {authOpen && (
        <AuthModal
          academy={academy}
          onClose={() => setAuthOpen(false)}
          onDone={async () => {
            setAuthOpen(false);
            await refresh();
            const cb = afterAuth;
            setAfterAuth(null);
            cb?.();
          }}
        />
      )}

      {redeemOpen && (
        <RedeemModal
          academy={academy}
          onClose={() => setRedeemOpen(false)}
          onDone={async () => {
            setRedeemOpen(false);
            await refresh();
          }}
        />
      )}
    </LearnContext.Provider>
  );
}

function AuthModal({
  academy,
  onClose,
  onDone,
}: {
  academy: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("learn");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === "login"
          ? await learnLogin(academy, { email, password })
          : await learnRegister(academy, { full_name: fullName, email, password });
      setLearnToken(academy, res.token);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={mode === "login" ? t("auth.signIn") : t("auth.register")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && <AlertBanner variant="error" message={error} />}
        {mode === "register" && (
          <input
            className={inputCls}
            placeholder={t("auth.fullName")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        )}
        <input
          className={inputCls}
          type="email"
          placeholder={t("auth.email")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className={inputCls}
          type="password"
          placeholder={t("auth.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
        <Button type="submit" className="w-full" disabled={busy}>
          {mode === "login" ? t("auth.signIn") : t("auth.register")}
        </Button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground w-full text-center text-sm"
          onClick={() => {
            setMode((m) => (m === "login" ? "register" : "login"));
            setError(null);
          }}
        >
          {mode === "login" ? t("auth.needAccount") : t("auth.haveAccount")}
        </button>
      </form>
    </Modal>
  );
}

function RedeemModal({
  academy,
  onClose,
  onDone,
}: {
  academy: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("learn");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string[] | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await learnRedeem(academy, code.trim());
      // Show the unlocked courses; the parent's onDone refreshes enrollment state on close.
      setSuccess(res.courses.map((c) => c.title));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={t("redeem.title")}>
      {success ? (
        <div className="space-y-4">
          <AlertBanner variant="success" message={t("redeem.unlocked")} />
          <ul className="list-inside list-disc text-sm">
            {success.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
          <Button className="w-full" onClick={onDone}>
            {t("redeem.done")}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {error && <AlertBanner variant="error" message={error} />}
          <p className="text-muted-foreground text-sm">{t("redeem.hint")}</p>
          <input
            className={`${inputCls} text-center font-mono tracking-widest uppercase`}
            placeholder="XXXX-XXXX"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
          />
          <Button type="submit" className="w-full" disabled={busy || !code.trim()}>
            {t("redeem.submit")}
          </Button>
        </form>
      )}
    </Modal>
  );
}
