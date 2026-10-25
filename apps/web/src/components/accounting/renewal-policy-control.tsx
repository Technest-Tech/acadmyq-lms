"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import type { RenewalPolicy } from "@/lib/accounting-api";
import { cn } from "@/lib/utils";

const POLICIES: RenewalPolicy[] = ["FREE", "PAY_FIRST"];

/**
 * Renew freely, or pay first (RenewalPolicy on the API): the family card sets it for the whole
 * family, a student's profile for that student alone. Set on the family, a student's own switch
 * cannot loosen it — the control shows it and points at the family's page.
 */
export function RenewalPolicyControl({
  value,
  canEdit,
  onChange,
  inheritedFrom,
}: {
  value: RenewalPolicy;
  canEdit: boolean;
  onChange: (policy: RenewalPolicy) => Promise<void>;
  /** The family pays first: its page is where this is changed. */
  inheritedFrom?: string | null;
}) {
  const t = useTranslations("accounting");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown: RenewalPolicy = inheritedFrom ? "PAY_FIRST" : value;
  const editable = canEdit && !inheritedFrom && !busy;

  async function pick(policy: RenewalPolicy) {
    if (policy === shown) return;
    setBusy(true);
    setError(null);
    try {
      await onChange(policy);
    } catch (err) {
      setError(apiErrorMessage(err, t("renewal.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5" data-testid="renewal-policy">
      <span className="text-sm font-medium">{t("renewal.label")}</span>
      <div role="radiogroup" aria-label={t("renewal.label")} className="bg-background inline-flex rounded-lg border p-0.5">
        {POLICIES.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={shown === p}
            disabled={!editable}
            onClick={() => void pick(p)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed",
              shown === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted disabled:hover:bg-transparent",
            )}
            data-testid={`renewal-${p}`}
          >
            {t(`renewal.${p}`)}
          </button>
        ))}
      </div>
      {busy && <Loader2 className="text-muted-foreground size-3.5 animate-spin" aria-hidden />}
      <p className="text-muted-foreground w-full text-xs">
        {inheritedFrom ? (
          <Link href={`/guardians/${inheritedFrom}`} className="hover:underline">
            {t("renewal.inherited")}
          </Link>
        ) : (
          t(shown === "PAY_FIRST" ? "renewal.payFirstHint" : "renewal.freeHint")
        )}
      </p>
      {error && <p className="text-destructive w-full text-xs">{error}</p>}
    </div>
  );
}
