"use client";

import { Eye, EyeOff, UserCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Field, fieldClass } from "@/components/admin/field";
import {
  SectionCard,
  SectionCardFooter,
} from "@/components/admin/section-card";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  type AcademyOwner,
  ApiError,
  getAcademyOwner,
  updateAcademyOwner,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Academy owner credentials (admin panel). Reads the current owner login and lets the admin
 * change the sign-in email and/or reset the password directly (no set-password email).
 * Gated by user.invite + role.assign (server Gate is the real control).
 */
export function AcademyOwnerSection({ academyId }: { academyId: string }) {
  const t = useTranslations("academies.detail");
  const { can } = useAuth();
  const toast = useToast();

  const [owner, setOwner] = useState<AcademyOwner | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await getAcademyOwner(academyId);
      setOwner(res.owner);
      setEmail(res.owner?.email ?? "");
    } catch {
      // Non-fatal: the section just shows the empty state.
    } finally {
      setLoaded(true);
    }
  }, [academyId]);

  useEffect(() => {
    if (can("academy.configure")) void load();
  }, [load, can]);

  if (!can("academy.configure")) return null;

  const emailChanged =
    email.trim().toLowerCase() !== (owner?.email ?? "").toLowerCase();
  const emailValid = EMAIL_RE.test(email.trim());
  const passwordValid = password.length === 0 || password.length >= 8;
  // Something to save, and what's filled in is valid.
  const canSave =
    owner !== null &&
    !busy &&
    (emailChanged || password.length > 0) &&
    emailValid &&
    passwordValid;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (owner === null) return;
    setBusy(true);
    try {
      const patch: { email?: string; password?: string } = {};
      if (emailChanged) patch.email = email.trim().toLowerCase();
      if (password.length > 0) patch.password = password;
      await updateAcademyOwner(academyId, patch);
      toast.success(t("ownerUpdated"));
      setPassword("");
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      icon={UserCircle}
      title={t("ownerSection")}
      description={t("ownerManageHint")}
      testId="academy-owner-section"
    >
      {loaded && owner === null ? (
        <p className="bg-muted/40 text-muted-foreground rounded-lg px-3 py-2.5 text-sm">
          {t("ownerNone")}
        </p>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          {owner !== null && (
            <p className="text-sm font-medium">{owner.full_name}</p>
          )}
          <Field label={t("ownerEmailLabel")}>
            <input
              aria-label={t("ownerEmailLabel")}
              type="email"
              dir="ltr"
              autoComplete="off"
              className={fieldClass}
              value={email}
              disabled={!loaded || owner === null}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={t("ownerNewPassword")}>
            <span className="relative block">
              <input
                aria-label={t("ownerNewPassword")}
                type={showPassword ? "text" : "password"}
                dir="ltr"
                autoComplete="new-password"
                className={cn(fieldClass, "pe-10")}
                placeholder={t("ownerPasswordPlaceholder")}
                value={password}
                disabled={!loaded || owner === null}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={t(
                  showPassword ? "ownerHidePassword" : "ownerShowPassword",
                )}
                className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-0 flex items-center pe-3"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </button>
            </span>
          </Field>
          <SectionCardFooter>
            <Button
              type="submit"
              size="sm"
              disabled={!canSave}
              data-testid="save-owner"
            >
              {busy ? t("ownerSaving") : t("ownerSave")}
            </Button>
          </SectionCardFooter>
        </form>
      )}
    </SectionCard>
  );
}
