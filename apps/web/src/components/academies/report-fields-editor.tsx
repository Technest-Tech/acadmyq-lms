"use client";

import { REPORT_FIELD_TYPE } from "@academiq/contracts";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  addReportField,
  ApiError,
  deleteReportField,
  listReportFields,
  type ReportField,
  updateReportField,
} from "@/lib/api";

const inputClass =
  "border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm";

/** Parse a comma-separated options string into a trimmed, non-empty list. */
function parseOptions(raw: string): string[] {
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/**
 * Per-academy report-field configuration (Sprint 3 §4.2). The Owner (or a Super Admin acting
 * in the academy) adds/edits/reorders/deactivates the custom fields the Sprint 6 attendance
 * screen will render. Mirrors the server rules: a SELECT needs options, and a field that
 * already has report values can only be deactivated, never deleted (deactivate-not-delete).
 */
export function ReportFieldsEditor({ academyId }: { academyId: string }) {
  const t = useTranslations("academies.fields");
  const [fields, setFields] = useState<ReportField[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add-form state.
  const [key, setKey] = useState("");
  const [labelAr, setLabelAr] = useState("");
  const [labelEn, setLabelEn] = useState("");
  const [type, setType] = useState<(typeof REPORT_FIELD_TYPE)[number]>("TEXT");
  const [options, setOptions] = useState("");

  const refresh = useCallback(async () => {
    const res = await listReportFields(academyId);
    setFields(res.reportFields.sort((a, b) => a.sort_order - b.sort_order));
  }, [academyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onAdd(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (type === "SELECT" && parseOptions(options).length === 0) {
      setError(t("selectNeedsOptions"));
      return;
    }
    setBusy(true);
    try {
      await addReportField(academyId, {
        key,
        label_ar: labelAr,
        label_en: labelEn,
        field_type: type,
        options: type === "SELECT" ? parseOptions(options) : null,
        sort_order: (fields?.length ?? 0) + 1,
      });
      setKey("");
      setLabelAr("");
      setLabelEn("");
      setType("TEXT");
      setOptions("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(field: ReportField) {
    setError(null);
    await updateReportField(academyId, field.id, {
      is_active: !field.is_active,
    });
    await refresh();
  }

  async function remove(field: ReportField) {
    setError(null);
    try {
      await deleteReportField(academyId, field.id);
      await refresh();
    } catch (err) {
      // A field with existing values cannot be deleted — only deactivated (AC-3.5).
      setError(err instanceof ApiError ? t("deleteBlocked") : String(err));
    }
  }

  async function move(index: number, delta: number) {
    if (fields === null) return;
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const a = fields[index]!;
    const b = fields[target]!;
    setError(null);
    await Promise.all([
      updateReportField(academyId, a.id, { sort_order: b.sort_order }),
      updateReportField(academyId, b.id, { sort_order: a.sort_order }),
    ]);
    await refresh();
  }

  return (
    <div className="space-y-4" data-testid="report-fields">
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      {fields === null ? (
        <p className="text-muted-foreground text-sm">…</p>
      ) : fields.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-md border" data-testid="field-list">
          {fields.map((field, i) => (
            <li
              key={field.id}
              data-field={field.key}
              data-active={field.is_active}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium">{field.label_en}</span>{" "}
                <span className="text-muted-foreground">
                  ({field.key} · {field.field_type}
                  {field.is_required ? " · *" : ""})
                </span>
                {!field.is_active && (
                  <span className="text-muted-foreground italic">
                    {" "}
                    — {t("deactivate")}d
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={t("moveUp")}
                  disabled={i === 0}
                  onClick={() => void move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  aria-label={t("moveDown")}
                  disabled={i === fields.length - 1}
                  onClick={() => void move(i, 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => void toggleActive(field)}
                >
                  {field.is_active ? t("deactivate") : t("activate")}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  onClick={() => void remove(field)}
                >
                  {t("delete")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="grid grid-cols-2 gap-2 rounded-md border p-3"
        onSubmit={onAdd}
        data-testid="add-field-form"
      >
        <input
          aria-label={t("key")}
          placeholder={t("key")}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className={inputClass}
          required
        />
        <select
          aria-label={t("type")}
          value={type}
          onChange={(e) =>
            setType(e.target.value as (typeof REPORT_FIELD_TYPE)[number])
          }
          className={inputClass}
        >
          {REPORT_FIELD_TYPE.map((ft) => (
            <option key={ft} value={ft}>
              {ft}
            </option>
          ))}
        </select>
        <input
          aria-label={t("labelAr")}
          placeholder={t("labelAr")}
          value={labelAr}
          onChange={(e) => setLabelAr(e.target.value)}
          className={inputClass}
          required
        />
        <input
          aria-label={t("labelEn")}
          placeholder={t("labelEn")}
          value={labelEn}
          onChange={(e) => setLabelEn(e.target.value)}
          className={inputClass}
          required
        />
        {type === "SELECT" && (
          <input
            aria-label={t("options")}
            placeholder={t("options")}
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            className={`${inputClass} col-span-2`}
          />
        )}
        <div className="col-span-2 flex justify-end">
          <Button type="submit" size="sm" disabled={busy}>
            {t("add")}
          </Button>
        </div>
      </form>
    </div>
  );
}
