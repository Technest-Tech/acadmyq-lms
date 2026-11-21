"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError, updatePerformanceSettings, type PerformanceSettings } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CONDUCT_KINDS } from "./note-form";
import { INPUT_CLASS, PARTS, useDuration } from "./performance-ui";

const REPORT_OPTIONS = [60, 120, 180, 360, 720, 1440];
const LATE_OPTIONS = [0, 5, 10, 15];

/**
 * The academy's evaluation sheet: how much each of the four parts weighs, what a note costs, how
 * many lessons a supervisor should sit in, the two clocks, and the academy's own lists — what a
 * lesson is rated on and the rules a teacher is held to. Saved as one sheet.
 */
export function PerformanceSettingsModal({
  settings,
  onClose,
  onSaved,
}: {
  settings: PerformanceSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("teacherPerformance");
  const dur = useDuration();

  const [weights, setWeights] = useState(settings.weights);
  const [points, setPoints] = useState(settings.points);
  const [visitsTarget, setVisitsTarget] = useState(settings.visits_target);
  const [lateMinutes, setLateMinutes] = useState(settings.late_minutes);
  const [reportMinutes, setReportMinutes] = useState(settings.report_minutes);
  const [criteria, setCriteria] = useState(() => settings.criteria.map((c) => ({ ...c, key: c.id })));
  const [rules, setRules] = useState(() => settings.rules.map((r, i) => ({ key: `r${i}`, value: r })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sum = PARTS.reduce((total, p) => total + (weights[p] || 0), 0);
  const whole = (raw: string, max: number) => Math.min(max, Math.max(0, Math.round(Number(raw) || 0)));

  async function save() {
    if (sum !== 100) {
      setError(t("settings.sumError"));
      return;
    }
    const kept = criteria.filter((c) => c.name.trim() !== "");
    if (kept.length === 0) {
      setError(t("settings.needCriterion"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updatePerformanceSettings({
        weights,
        points,
        visits_target: visitsTarget,
        late_minutes: lateMinutes,
        report_minutes: reportMinutes,
        // A new item has no id yet — the server gives it one that outlives a rename.
        criteria: kept.map((c) => ({ id: c.id, name: c.name.trim() })),
        rules: rules.map((r) => r.value.trim()).filter(Boolean),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t("settings.saveError"));
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("settings.title")}
      description={t("settings.subtitle")}
      size="lg"
      closeLabel={t("close")}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            {t("settings.cancel")}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving} data-testid="settings-save">
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            {t("settings.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-6" data-testid="performance-settings">
        {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

        <Section title={t("settings.weights")} hint={t("settings.weightsHint")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {PARTS.map((p) => (
              <NumberField
                key={p}
                label={t(`part.${p}`)}
                suffix="%"
                value={weights[p]}
                onChange={(raw) => setWeights((w) => ({ ...w, [p]: whole(raw, 100) }))}
                testId={`settings-weight-${p}`}
              />
            ))}
          </div>
          <p
            className={cn("mt-2 text-xs font-semibold tabular-nums", sum === 100 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}
            data-testid="settings-sum"
          >
            {t("settings.sum", { n: sum })}
          </p>
        </Section>

        <Section title={t("settings.points")} hint={t("settings.pointsHint")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {CONDUCT_KINDS.map((k) => (
              <NumberField
                key={k}
                label={t(`note.kinds.${k}`)}
                value={points[k]}
                onChange={(raw) => setPoints((p) => ({ ...p, [k]: whole(raw, 100) }))}
                testId={`settings-points-${k}`}
              />
            ))}
          </div>
        </Section>

        <Section title={t("settings.clocks")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <NumberField
              label={t("settings.visitsTarget")}
              value={visitsTarget}
              onChange={(raw) => setVisitsTarget(whole(raw, 31))}
              testId="settings-visits-target"
            />
            <label className="block text-sm">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">{t("settings.lateMinutes")}</span>
              <select value={lateMinutes} onChange={(e) => setLateMinutes(Number(e.target.value))} className={INPUT_CLASS} data-testid="settings-late">
                {[...new Set([...LATE_OPTIONS, lateMinutes])].sort((a, b) => a - b).map((n) => (
                  <option key={n} value={n}>
                    {t("dur.min", { n })}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground mb-1 block text-xs font-medium">{t("settings.reportWindow")}</span>
              <select value={reportMinutes} onChange={(e) => setReportMinutes(Number(e.target.value))} className={INPUT_CLASS} data-testid="settings-report">
                {[...new Set([...REPORT_OPTIONS, reportMinutes])].sort((a, b) => a - b).map((n) => (
                  <option key={n} value={n}>
                    {dur(n)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Section>

        <Section title={t("settings.criteria")} hint={t("settings.criteriaHint")}>
          <ListEditor
            rows={criteria.map((c) => ({ key: c.key, value: c.name }))}
            placeholder={t("settings.criterionPh")}
            addLabel={t("settings.addCriterion")}
            removeLabel={t("settings.remove")}
            max={12}
            maxLength={80}
            testId="settings-criteria"
            onChange={(key, value) => setCriteria((list) => list.map((c) => (c.key === key ? { ...c, name: value } : c)))}
            onRemove={(key) => setCriteria((list) => list.filter((c) => c.key !== key))}
            onAdd={() => setCriteria((list) => [...list, { id: "", name: "", key: `new${Date.now()}` }])}
          />
        </Section>

        <Section title={t("settings.rules")} hint={t("settings.rulesHint")}>
          <ListEditor
            rows={rules}
            placeholder={t("settings.rulePh")}
            addLabel={t("settings.addRule")}
            removeLabel={t("settings.remove")}
            max={30}
            maxLength={120}
            testId="settings-rules"
            onChange={(key, value) => setRules((list) => list.map((r) => (r.key === key ? { ...r, value } : r)))}
            onRemove={(key) => setRules((list) => list.filter((r) => r.key !== key))}
            onAdd={() => setRules((list) => [...list, { key: `new${Date.now()}`, value: "" }])}
          />
        </Section>
      </div>
    </Modal>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-bold">{title}</h3>
      {hint && <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">{hint}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function NumberField({
  label,
  value,
  suffix,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  suffix?: string;
  onChange: (raw: string) => void;
  testId: string;
}) {
  return (
    <label className="block text-sm">
      <span className="text-muted-foreground mb-1 block text-xs font-medium">{label}</span>
      <span className="relative block">
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(INPUT_CLASS, "tabular-nums", suffix && "pe-8")}
          data-testid={testId}
        />
        {suffix && (
          <span className="text-muted-foreground pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-xs">{suffix}</span>
        )}
      </span>
    </label>
  );
}

function ListEditor({
  rows,
  placeholder,
  addLabel,
  removeLabel,
  max,
  maxLength,
  testId,
  onChange,
  onRemove,
  onAdd,
}: {
  rows: { key: string; value: string }[];
  placeholder: string;
  addLabel: string;
  removeLabel: string;
  max: number;
  maxLength: number;
  testId: string;
  onChange: (key: string, value: string) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="space-y-2" data-testid={testId}>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2">
          <input
            value={row.value}
            onChange={(e) => onChange(row.key, e.target.value)}
            maxLength={maxLength}
            placeholder={placeholder}
            className={INPUT_CLASS}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => onRemove(row.key)} aria-label={removeLabel}>
            <X aria-hidden />
          </Button>
        </div>
      ))}
      {rows.length < max && (
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus aria-hidden />
          {addLabel}
        </Button>
      )}
    </div>
  );
}
