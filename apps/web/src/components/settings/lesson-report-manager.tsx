"use client";

import { ArrowDown, ArrowUp, ClipboardList, LayoutTemplate, MessageSquareText, Pencil, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  addReportField,
  applyLessonReportPreset,
  getLessonReport,
  previewLessonReport,
  saveLessonReportMessage,
  updateReportField,
  type LessonReportSettings,
  type ReportField,
  type ReportFieldInput,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3 disabled:opacity-60";

/** How a field reads to the person building the form — a score is a NUMBER with an "out of". */
type FieldKind = "score" | "number" | "text" | "textarea" | "select";

function kindOf(f: ReportField): FieldKind {
  if (f.field_type === "NUMBER") return f.max_value ? "score" : "number";
  if (f.field_type === "TEXTAREA") return "textarea";
  if (f.field_type === "SELECT" || f.field_type === "RATING") return "select";
  return "text";
}

/** A stable machine key for a new field: from the English label when it has one, else generated. */
function newKey(labelEn: string, taken: Set<string>): string {
  const slug = labelEn.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  let key = /^[a-z]/.test(slug) ? slug : `field_${Date.now().toString(36)}`;
  for (let i = 2; taken.has(key); i++) key = `${key.replace(/_\d+$/, "")}_${i}`;
  return key;
}

/**
 * Settings → Lesson report (the `lesson_report` capability): the form a teacher or supervisor fills
 * after a lesson, and the WhatsApp message its answers are poured into. Starts from a ready-made
 * template (the Quran circle) or from scratch; the preview renders the message server-side, so
 * what you see is exactly what a parent gets.
 */
export function LessonReportManager() {
  const t = useTranslations("settings.lessonReport");
  const locale = useLocale();
  const { session } = useAuth();
  const academyId = session?.academyId ?? "";

  const [settings, setSettings] = useState<LessonReportSettings | null>(null);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [editing, setEditing] = useState<ReportField | "new" | null>(null);
  const [confirmPreset, setConfirmPreset] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const label = (f: ReportField) => (locale === "ar" ? f.label_ar : f.label_en) || f.label_ar;
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const load = useCallback(async () => {
    try {
      const s = await getLessonReport();
      setSettings(s);
      setMessage(s.message);
    } catch (e) {
      fail(e);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(() => (settings?.fields ?? []).filter((f) => f.is_active), [settings]);
  const inactive = useMemo(() => (settings?.fields ?? []).filter((f) => !f.is_active), [settings]);

  // The preview follows the message (and the form: a new field changes what a placeholder says).
  useEffect(() => {
    if (!settings) return;
    const timer = window.setTimeout(() => {
      previewLessonReport(message).then((r) => setPreview(r.text)).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer);
  }, [message, settings]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  /** Put `{token}` where the cursor is, so building the message is mostly tapping. */
  function insert(token: string) {
    const el = textareaRef.current;
    const at = el?.selectionStart ?? message.length;
    const end = el?.selectionEnd ?? at;
    const next = `${message.slice(0, at)}{${token}}${message.slice(end)}`;
    setMessage(next);
    window.requestAnimationFrame(() => {
      el?.focus();
      const caret = at + token.length + 2;
      el?.setSelectionRange(caret, caret);
    });
  }

  /** Move a field one place and renumber the form, patching only the rows whose place changed. */
  function move(index: number, by: -1 | 1) {
    const order = [...active];
    const [field] = order.splice(index, 1);
    if (!field) return;
    order.splice(index + by, 0, field);
    void run(async () => {
      await Promise.all(
        order.map((f, i) => (f.sort_order === i + 1 ? null : updateReportField(academyId, f.id, { sort_order: i + 1 }))),
      );
      await load();
    });
  }

  if (!settings) {
    return error ? (
      <AlertBanner variant="error" message={error} />
    ) : (
      <div className="bg-muted h-64 animate-pulse rounded-2xl" aria-hidden />
    );
  }

  const facts = settings.facts;
  const dirty = message !== settings.message;

  return (
    <div className="space-y-6" data-testid="lesson-report-manager">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      {/* ── Ready-made templates ─────────────────────────────────────────── */}
      <SectionCard
        icon={LayoutTemplate}
        title={t("presetsTitle")}
        description={t("presetsHint")}
        iconClassName="bg-gradient-to-br from-amber-500 to-orange-600"
      >
        <div className="flex flex-wrap gap-2">
          {Object.entries(settings.presets).map(([key, p]) => (
            <Button
              key={key}
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmPreset(key)}
              data-testid={`preset-${key}`}
            >
              {t("usePreset", { name: locale === "ar" ? p.name_ar : p.name_en })}
            </Button>
          ))}
        </div>
      </SectionCard>

      {/* ── The form ─────────────────────────────────────────────────────── */}
      <SectionCard
        icon={ClipboardList}
        title={t("formTitle")}
        description={t("formHint")}
        iconClassName="bg-gradient-to-br from-emerald-500 to-teal-600"
      >
        {active.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noFields")}</p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {active.map((f, i) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5" data-testid={`field-${f.key}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {label(f)}
                    {f.is_required && <span className="text-destructive ms-0.5">*</span>}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {f.section ? `${f.section} · ` : ""}
                    {t(`kinds.${kindOf(f)}`)}
                    {f.max_value ? ` · ${t("outOf", { max: f.max_value })}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button type="button" size="xs" variant="ghost" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={t("moveUp")}>
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button type="button" size="xs" variant="ghost" disabled={busy || i === active.length - 1} onClick={() => move(i, 1)} aria-label={t("moveDown")}>
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => setEditing(f)}>
                    <Pencil className="size-3.5" />
                    {t("edit")}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run(async () => { await updateReportField(academyId, f.id, { is_active: false }); await load(); })}
                  >
                    {t("deactivate")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => setEditing("new")} data-testid="add-field">
            <Plus className="size-3.5" />
            {t("addField")}
          </Button>
        </div>

        {inactive.length > 0 && (
          <details className="mt-4">
            <summary className="text-muted-foreground cursor-pointer text-xs font-medium">
              {t("inactiveTitle", { count: inactive.length })}
            </summary>
            <ul className="mt-2 space-y-1.5">
              {inactive.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground truncate">{label(f)}</span>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(async () => {
                      await updateReportField(academyId, f.id, { is_active: true, sort_order: active.length + 1 });
                      await load();
                    })}
                  >
                    {t("activate")}
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </SectionCard>

      {/* ── The message ──────────────────────────────────────────────────── */}
      <SectionCard
        icon={MessageSquareText}
        title={t("messageTitle")}
        description={t("messageHint")}
        iconClassName="bg-gradient-to-br from-green-500 to-emerald-600"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-xs font-medium">{t("insertFacts")}</p>
              <div className="flex flex-wrap gap-1.5">
                {facts.map((fact) => (
                  <button
                    key={fact}
                    type="button"
                    onClick={() => insert(fact)}
                    className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-300"
                  >
                    {t(`facts.${fact}`)}
                  </button>
                ))}
              </div>
            </div>
            {active.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs font-medium">{t("insertFields")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {active.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => insert(f.key)}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-300"
                    >
                      {label(f)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <textarea
              ref={textareaRef}
              dir="auto"
              rows={18}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("messagePlaceholder", { student: "{student}" })}
              className={cn(inputClass, "resize-y font-mono text-[13px] leading-relaxed")}
              data-testid="lesson-report-message"
            />
            <p className="text-muted-foreground text-xs">{t("emptyLineHint")}</p>
            <div className="flex items-center justify-end gap-2">
              {savedTick && !dirty && <span className="text-xs text-emerald-600">{t("saved")}</span>}
              {dirty && <span className="text-muted-foreground text-xs">{t("unsaved")}</span>}
              <Button
                type="button"
                size="sm"
                disabled={busy || !dirty}
                onClick={() => void run(async () => {
                  await saveLessonReportMessage(message);
                  setSettings((s) => (s ? { ...s, message } : s));
                  setSavedTick(true);
                  window.setTimeout(() => setSavedTick(false), 2500);
                })}
                data-testid="save-message"
              >
                {t("saveMessage")}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-muted-foreground text-xs font-medium">{t("preview")}</p>
            <pre
              dir="auto"
              className="min-h-48 whitespace-pre-wrap break-words rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 font-sans text-sm leading-relaxed dark:border-emerald-800/40 dark:bg-emerald-950/20"
              data-testid="lesson-report-preview"
            >
              {preview || t("previewEmpty")}
            </pre>
          </div>
        </div>
      </SectionCard>

      {editing !== null && (
        <FieldModal
          field={editing === "new" ? null : editing}
          sections={[...new Set(active.map((f) => f.section?.trim()).filter((s): s is string => !!s))]}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            void run(async () => {
              if (editing === "new") {
                const taken = new Set(settings.fields.map((f) => f.key));
                await addReportField(academyId, {
                  ...input,
                  key: newKey(input.label_en ?? "", taken),
                  sort_order: active.length + 1,
                });
              } else {
                await updateReportField(academyId, editing.id, input);
              }
              setEditing(null);
              await load();
            })
          }
        />
      )}

      <Modal
        open={confirmPreset !== null}
        onClose={() => setConfirmPreset(null)}
        title={t("presetConfirmTitle")}
        description={t("presetConfirmBody")}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmPreset(null)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button
              type="button"
              disabled={busy}
              data-testid="confirm-preset"
              onClick={() => {
                const key = confirmPreset;
                if (!key) return;
                void run(async () => {
                  const s = await applyLessonReportPreset(key);
                  setSettings(s);
                  setMessage(s.message);
                  setConfirmPreset(null);
                });
              }}
            >
              {t("presetConfirm")}
            </Button>
          </div>
        }
      >
        <p className="text-muted-foreground text-sm">{t("presetConfirmNote")}</p>
      </Modal>
    </div>
  );
}

/** Add or edit one field of the form. */
function FieldModal({
  field,
  sections,
  busy,
  onClose,
  onSave,
}: {
  field: ReportField | null;
  sections: string[];
  busy: boolean;
  onClose: () => void;
  onSave: (input: ReportFieldInput) => void;
}) {
  const t = useTranslations("settings.lessonReport");
  const [labelAr, setLabelAr] = useState(field?.label_ar ?? "");
  const [labelEn, setLabelEn] = useState(field?.label_en ?? "");
  const [kind, setKind] = useState<FieldKind>(field ? kindOf(field) : "score");
  const [max, setMax] = useState(String(field?.max_value ?? 10));
  const [section, setSection] = useState(field?.section ?? "");
  const [options, setOptions] = useState((field?.options ?? []).join("\n"));
  const [required, setRequired] = useState(field?.is_required ?? false);

  const optionList = options.split("\n").map((o) => o.trim()).filter(Boolean);
  const maxValue = Number(max);
  const valid =
    labelAr.trim() !== "" &&
    (kind !== "score" || (Number.isInteger(maxValue) && maxValue >= 1 && maxValue <= 1000)) &&
    (kind !== "select" || optionList.length > 0);

  function submit() {
    if (!valid) return;
    onSave({
      label_ar: labelAr.trim(),
      label_en: labelEn.trim() || labelAr.trim(),
      field_type: kind === "score" || kind === "number" ? "NUMBER" : kind === "textarea" ? "TEXTAREA" : kind === "select" ? "SELECT" : "TEXT",
      max_value: kind === "score" ? maxValue : null,
      options: kind === "select" ? optionList : null,
      section: section.trim() || null,
      is_required: required,
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={field ? t("field.titleEdit") : t("field.titleNew")}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button type="button" disabled={busy || !valid} onClick={submit} data-testid="save-field">
            {t("field.save")}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs font-medium">
          <span>{t("field.labelAr")}</span>
          <input dir="rtl" value={labelAr} onChange={(e) => setLabelAr(e.target.value)} className={inputClass} data-testid="field-label-ar" />
        </label>
        <label className="space-y-1.5 text-xs font-medium">
          <span>{t("field.labelEn")}</span>
          <input dir="ltr" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} className={inputClass} />
        </label>
        <label className="space-y-1.5 text-xs font-medium">
          <span>{t("field.kind")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as FieldKind)} className={inputClass} data-testid="field-kind">
            {(["score", "text", "textarea", "number", "select"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
        </label>
        {kind === "score" && (
          <label className="space-y-1.5 text-xs font-medium">
            <span>{t("field.max")}</span>
            <input type="number" min={1} max={1000} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} className={inputClass} />
          </label>
        )}
        <label className="space-y-1.5 text-xs font-medium sm:col-span-2">
          <span>{t("field.section")}</span>
          <input dir="auto" list="lesson-report-sections" value={section} onChange={(e) => setSection(e.target.value)} placeholder={t("field.sectionHint")} className={inputClass} />
          <datalist id="lesson-report-sections">
            {sections.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        {kind === "select" && (
          <label className="space-y-1.5 text-xs font-medium sm:col-span-2">
            <span>{t("field.options")}</span>
            <textarea dir="auto" rows={4} value={options} onChange={(e) => setOptions(e.target.value)} placeholder={t("field.optionsHint")} className={cn(inputClass, "resize-y")} />
          </label>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="size-4" />
          {t("field.required")}
        </label>
      </div>
    </Modal>
  );
}
