"use client";

import { UserCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError, provisionAcademyOwner } from "@/lib/api";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";

/**
 * Academy owner provisioning (admin panel — Phase 2). Surfaces the idempotent
 * POST /owner endpoint: create the first owner login or re-send their set-password link.
 * Gated by user.invite + role.assign (server Gate is the real control).
 */
export function AcademyOwnerSection({ academyId }: { academyId: string }) {
  const t = useTranslations("academies.detail");
  const { can } = useAuth();
  const toast = useToast();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  if (!can("user.invite") || !can("role.assign")) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await provisionAcademyOwner(academyId, {
        ownerFullName: fullName.trim(),
        ownerEmail: email.trim(),
      });
      toast.success(t("ownerProvisioned"));
      setFullName("");
      setEmail("");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3" data-testid="academy-owner-section">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <UserCircle className="text-muted-foreground size-4" aria-hidden />
        {t("ownerSection")}
      </h2>
      <p className="text-muted-foreground text-sm">{t("ownerHint")}</p>

      <form className="space-y-3" onSubmit={submit}>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("ownerNameLabel")}</span>
          <input
            aria-label={t("ownerNameLabel")}
            className={inputClass}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("ownerEmailLabel")}</span>
          <input
            aria-label={t("ownerEmailLabel")}
            type="email"
            dir="ltr"
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <Button
          type="submit"
          size="sm"
          disabled={busy}
          data-testid="provision-owner"
        >
          {busy ? t("ownerProvisioning") : t("ownerProvision")}
        </Button>
      </form>
    </section>
  );
}
