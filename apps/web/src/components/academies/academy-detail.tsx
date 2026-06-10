"use client";

import { INVOICE_GROUPING } from "@academiq/contracts";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ReportFieldsEditor } from "@/components/academies/report-fields-editor";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  getAcademy,
  reactivateAcademy,
  suspendAcademy,
  updateAcademy,
} from "@/lib/api";

const inputClass =
  "border-input bg-background w-full rounded-md border px-3 py-2 text-sm";

type Academy = Record<string, unknown>;

/**
 * Academy detail: edit configuration, manage the suspend/reactivate lifecycle, and configure
 * report fields. Currency changes surface the server's warning (existing money is untouched —
 * AC-3.11). Branding fields are editable but flagged reserved (R-BRA-1).
 */
export function AcademyDetail({
  academyId,
  onBack,
}: {
  academyId: string;
  onBack: () => void;
}) {
  const t = useTranslations("academies");
  const [academy, setAcademy] = useState<Academy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    const res = await getAcademy(academyId);
    setAcademy(res.academy);
  }, [academyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function set(key: string, value: unknown) {
    setAcademy((a) => (a ? { ...a, [key]: value } : a));
  }

  async function save() {
    if (academy === null) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const res = await updateAcademy(academyId, {
        name: academy.name as string,
        default_currency: academy.default_currency as string,
        timezone: academy.timezone as string,
        invoice_grouping: academy.invoice_grouping as
          | "PER_GUARDIAN"
          | "PER_STUDENT",
        billing_day: Number(academy.billing_day),
        brand_display_name: (academy.brand_display_name as string) || null,
        brand_logo_url: (academy.brand_logo_url as string) || null,
        subdomain: (academy.subdomain as string) || null,
      });
      setNotice(res.warning ?? t("detail.saved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleSuspend() {
    if (academy === null) return;
    setError(null);
    if (academy.status === "SUSPENDED") {
      await reactivateAcademy(academyId);
    } else {
      await suspendAcademy(academyId);
    }
    await refresh();
  }

  if (academy === null) {
    return <p className="text-muted-foreground text-sm">…</p>;
  }

  const status = academy.status as string;

  return (
    <div className="max-w-2xl space-y-8" data-testid="academy-detail">
      <div className="flex items-center justify-between">
        <div>
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            ← {t("back")}
          </Button>
          <h1 className="mt-1 text-2xl font-semibold">
            {academy.name as string}
          </h1>
          <span
            className="text-muted-foreground text-xs"
            data-testid="detail-status"
          >
            {t(`status.${status}`)}
          </span>
        </div>
        <Button
          type="button"
          variant={status === "SUSPENDED" ? "default" : "destructive"}
          size="sm"
          onClick={() => void toggleSuspend()}
          data-testid="toggle-suspend"
        >
          {status === "SUSPENDED"
            ? t("detail.reactivate")
            : t("detail.suspend")}
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("detail.config")}</h2>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-amber-600">
            {notice}
          </p>
        )}
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("wizard.name")}</span>
          <input
            aria-label={t("wizard.name")}
            className={inputClass}
            value={academy.name as string}
            onChange={(e) => set("name", e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("wizard.currency")}</span>
          <input
            aria-label={t("wizard.currency")}
            className={inputClass}
            maxLength={3}
            value={academy.default_currency as string}
            onChange={(e) =>
              set("default_currency", e.target.value.toUpperCase())
            }
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("wizard.timezone")}</span>
          <input
            aria-label={t("wizard.timezone")}
            className={inputClass}
            value={academy.timezone as string}
            onChange={(e) => set("timezone", e.target.value)}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("wizard.grouping")}</span>
          <select
            aria-label={t("wizard.grouping")}
            className={inputClass}
            value={academy.invoice_grouping as string}
            onChange={(e) => set("invoice_grouping", e.target.value)}
          >
            {INVOICE_GROUPING.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <p className="text-muted-foreground text-xs">{t("wizard.reserved")}</p>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t("wizard.subdomain")}</span>
          <input
            aria-label={t("wizard.subdomain")}
            className={inputClass}
            value={(academy.subdomain as string) ?? ""}
            onChange={(e) => set("subdomain", e.target.value.toLowerCase())}
          />
        </label>
        <Button
          type="button"
          size="sm"
          disabled={saving}
          onClick={() => void save()}
          data-testid="save-config"
        >
          {saving ? t("detail.saving") : t("detail.save")}
        </Button>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">{t("detail.reportFields")}</h2>
        <ReportFieldsEditor academyId={academyId} />
      </section>
    </div>
  );
}
