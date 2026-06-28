"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ApiError,
  listAcademies,
  getVideoPlans,
  setVideoAccess,
  type AcademyListItem,
  type VideoTierPlan,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Add an academy to the video platform: pick an academy, choose enable-now vs a trial (with a
 * day count), and a video tier whose options apply. Writes the per-academy video_access override.
 */
export function AddAcademyModal({
  enabledIds,
  onClose,
  onDone,
}: {
  enabledIds: Set<string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("adminVideo");

  const [academies, setAcademies] = useState<AcademyListItem[] | null>(null);
  const [plans, setPlans] = useState<VideoTierPlan[]>([]);
  const [academyId, setAcademyId] = useState("");
  const [mode, setMode] = useState<"enable" | "trial">("trial");
  const [trialDays, setTrialDays] = useState(14);
  const [planId, setPlanId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listAcademies().then((r) => setAcademies(r.academies)).catch(() => setAcademies([]));
    void getVideoPlans().then((r) => setPlans(r.plans)).catch(() => setPlans([]));
  }, []);

  // Lock body scroll + close on Escape while the modal is open.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function submit() {
    if (!academyId) {
      setError(t("add.pickAcademy"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setVideoAccess(academyId, {
        action: mode === "trial" ? "trial" : "enable",
        trial_days: mode === "trial" ? trialDays : null,
        video_plan_id: planId || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("add.failed"));
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl border shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">{t("add.title")}</h2>
            <p className="text-muted-foreground text-xs">{t("add.subtitle")}</p>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground rounded-lg p-1.5" aria-label={t("add.close")}>
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {/* Academy */}
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">{t("add.academyLabel")}</label>
            <select
              value={academyId}
              onChange={(e) => setAcademyId(e.target.value)}
              data-testid="add-academy-select"
              className="bg-background w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">{t("add.academyPlaceholder")}</option>
              {(academies ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {enabledIds.has(a.id) ? ` — ${t("add.alreadyOn")}` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Mode */}
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">{t("add.modeLabel")}</label>
            <div className="flex gap-2">
              {(["trial", "enable"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                    mode === m ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/50",
                  )}
                >
                  {m === "trial" ? t("add.modeTrial") : t("add.modeEnable")}
                </button>
              ))}
            </div>
          </div>

          {/* Trial days */}
          {mode === "trial" && (
            <div>
              <label className="text-muted-foreground mb-1 block text-xs font-medium">{t("add.trialDaysLabel")}</label>
              <input
                type="number"
                min={1}
                max={3650}
                value={Number.isFinite(trialDays) ? trialDays : 1}
                onChange={(e) => setTrialDays(Math.max(1, parseInt(e.target.value || "1", 10)))}
                className="bg-background w-full rounded-lg border px-3 py-2 text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}

          {/* Tier (options) */}
          <div>
            <label className="text-muted-foreground mb-1 block text-xs font-medium">{t("add.tierLabel")}</label>
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              data-testid="add-tier-select"
              className="bg-background w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">{t("add.tierNone")}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p className="text-muted-foreground mt-1 text-[11px]">{t("add.tierHint")}</p>
          </div>

          {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-4">
          <button type="button" onClick={onClose} className="text-muted-foreground hover:bg-muted/50 rounded-lg border px-4 py-2 text-sm font-medium">
            {t("add.cancel")}
          </button>
          <button
            type="button"
            disabled={saving || !academyId}
            onClick={() => void submit()}
            className="bg-primary text-primary-foreground inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            {saving ? t("add.submitting") : t("add.submit")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
