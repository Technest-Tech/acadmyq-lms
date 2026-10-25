"use client";

import { Loader2, Pencil, Percent, Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Panel, toMajorText, toMinor } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAcademyDefaults } from "@/lib/academy-defaults";
import { createDiscountPreset, listDiscountPresets, updateDiscountPreset, type DiscountKind, type DiscountPreset } from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** "10%" or "200 EGP" — a preset's (or a discount's) value, as stored (basis points / minor units). */
export function presetValueText(p: { kind: DiscountKind; value: number }, currency: string, locale: string): string {
  if (p.kind === "PERCENT") return `${p.value / 100}%`;
  return currency ? formatMoney({ amount: p.value, currency }, locale) : toMajorText(p.value);
}

/**
 * Discount presets (بنود الخصم, docs/groups/01-ACCOUNTING.md): the discounts an academy gives over
 * and over, defined once — the family card's "Add discount" offers them. Changing or retiring one
 * never touches a discount already given; nothing is deleted. Managing needs
 * `payment_settings.manage`; everyone who reads money sees the list.
 */
export function DiscountPresetsScreen() {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const { currency } = useAcademyDefaults();
  const [data, setData] = useState<{ presets: DiscountPreset[]; can_manage: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<DiscountPreset | "new" | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await listDiscountPresets());
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("presets.loadFailed")));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(p: DiscountPreset) {
    try {
      await updateDiscountPreset(p.id, { is_active: !p.is_active });
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, t("presets.failed")));
    }
  }

  return (
    <Panel
      title={t("presets.title")}
      icon={Percent}
      accent="violet"
      testId="discount-presets"
      action={
        data?.can_manage && editing === null ? (
          <Button type="button" size="xs" className="gap-1" onClick={() => setEditing("new")} data-testid="preset-add">
            <Plus className="size-3.5" aria-hidden />
            {t("presets.add")}
          </Button>
        ) : undefined
      }
    >
      <p className="text-muted-foreground mb-3 text-xs">{t("presets.hint")}</p>
      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
      {editing !== null && (
        <PresetForm
          preset={editing === "new" ? null : editing}
          currency={currency}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice(t("presets.saved"));
            void load();
          }}
        />
      )}
      {data === null && !error && <Loader2 className="text-muted-foreground mx-auto my-6 size-5 animate-spin" aria-hidden />}
      {data !== null && data.presets.length === 0 && editing === null && <p className="text-muted-foreground py-4 text-center text-sm">{t("presets.empty")}</p>}
      {data !== null && data.presets.length > 0 && (
        <ul className="divide-y" data-testid="preset-list">
          {data.presets.map((p) => (
            <li key={p.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm", !p.is_active && "opacity-60")} data-testid={`preset-${p.id}`}>
              <div className="min-w-0">
                <p className="font-medium break-words">
                  <span className="text-violet-700 tabular-nums dark:text-violet-300">{presetValueText(p, currency, locale)}</span> · {p.name}
                  {!p.is_active && <span className="text-muted-foreground ms-1.5 text-xs font-normal">({t("presets.retired")})</span>}
                </p>
                <p className="text-muted-foreground text-xs break-words">{[p.notes, t("presets.uses", { count: p.uses })].filter(Boolean).join(" · ")}</p>
              </div>
              {data.can_manage && (
                <div className="flex gap-1">
                  <Button type="button" size="xs" variant="ghost" className="gap-1" onClick={() => setEditing(p)} data-testid={`preset-edit-${p.id}`}>
                    <Pencil className="size-3" aria-hidden />
                    {t("presets.edit")}
                  </Button>
                  <Button type="button" size="xs" variant="ghost" onClick={() => void toggle(p)} data-testid={`preset-toggle-${p.id}`}>
                    {p.is_active ? t("presets.retire") : t("presets.restore")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function PresetForm({ preset, currency, onCancel, onSaved }: { preset: DiscountPreset | null; currency: string; onCancel: () => void; onSaved: () => void }) {
  const t = useTranslations("accounting");
  const [name, setName] = useState(preset?.name ?? "");
  const [kind, setKind] = useState<DiscountKind>(preset?.kind ?? "PERCENT");
  const [value, setValue] = useState(preset ? (preset.kind === "PERCENT" ? String(preset.value / 100) : toMajorText(preset.value)) : "");
  const [notes, setNotes] = useState(preset?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const n = Number.parseFloat(value.replace(",", "."));
  const valid = name.trim() !== "" && Number.isFinite(n) && n > 0 && (kind !== "PERCENT" || (n <= 100 && Number.isInteger(n)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    const input = { name: name.trim(), kind, value: kind === "PERCENT" ? Math.round(n) : toMinor(value), notes: notes.trim() || null };
    try {
      if (preset) await updateDiscountPreset(preset.id, input);
      else await createDiscountPreset(input);
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, t("presets.failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="bg-muted/30 mb-4 space-y-3 rounded-xl border p-3" data-testid="preset-form">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="text-muted-foreground text-xs">
          {t("presets.name")}
          <input className={cn(fieldClass, "mt-1")} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("family.discountLabelHint")} data-testid="preset-name" />
        </label>
        <label className="text-muted-foreground text-xs">
          {t("family.discountKind.PERCENT")} / {t("family.discountKind.FIXED")}
          <select className={cn(fieldClass, "mt-1")} value={kind} onChange={(e) => setKind(e.target.value as DiscountKind)} data-testid="preset-kind">
            <option value="PERCENT">{t("family.discountKind.PERCENT")}</option>
            <option value="FIXED">{t("family.discountKind.FIXED")}</option>
          </select>
        </label>
        <label className="text-muted-foreground text-xs">
          {kind === "PERCENT" ? t("family.discountValuePercent") : t("family.discountValueFixed")}
          {kind === "FIXED" && currency ? ` (${currency})` : ""}
          <input className={cn(fieldClass, "mt-1")} inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "PERCENT" ? "10" : "100"} data-testid="preset-value" />
        </label>
      </div>
      <label className="text-muted-foreground block text-xs">
        {t("presets.notes")}
        <input className={cn(fieldClass, "mt-1")} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} data-testid="preset-notes" />
      </label>
      {error && <AlertBanner variant="error" message={error} />}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          {t("collect.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={busy || !valid} data-testid="preset-save">
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {t("presets.save")}
        </Button>
      </div>
    </form>
  );
}
