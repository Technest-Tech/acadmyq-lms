"use client";

import {
  Check,
  Coins,
  FileText,
  Globe,
  GraduationCap,
  MessageCircle,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import {
  ApiError,
  deactivateGuardian,
  getGuardian,
  listStudents,
  type GuardianChild,
  type GuardianRow,
  updateGuardian,
  updateStudent,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  const sizeClass = {
    sm: "size-7 text-[10px]",
    md: "size-9 text-xs",
    lg: "size-14 text-base rounded-2xl",
  }[size];
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm",
        sizeClass,
      )}
      style={{ backgroundColor: `hsl(${nameHue(name)} 52% 44%)` }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-50";

// ── Component ─────────────────────────────────────────────────────────────────

export function GuardianDetail({
  guardianId,
  onBack,
  onSaved,
  onDeactivated,
}: {
  guardianId: string;
  onBack: () => void;
  onSaved?: () => void;
  onDeactivated?: () => void;
}) {
  const t = useTranslations("guardians");
  const { can } = useAuth();

  const [guardian, setGuardian] = useState<GuardianRow | null>(null);
  const [children, setChildren] = useState<GuardianChild[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [studentOptions, setStudentOptions] = useState<ComboboxOption[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [linking, setLinking] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const refresh = useCallback(async () => {
    const res = await getGuardian(guardianId);
    setGuardian(res.guardian);
    setChildren(res.children);
  }, [guardianId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Must be above the guardian === null guard (Rules of Hooks)
  useEffect(() => {
    if (!addingChild) return;
    setSelectedStudentId("");
    setLoadingStudents(true);
    const linked = new Set(children.map((c) => c.id));
    void listStudents({ pageSize: 200 })
      .then(({ rows }) =>
        setStudentOptions(
          rows
            .filter((s) => s.deleted_at == null && !linked.has(s.id))
            .map((s) => ({
              value: s.id,
              label: s.full_name,
              sublabel: s.guardian_name ?? undefined,
            })),
        ),
      )
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setLoadingStudents(false));
  }, [addingChild, children]);

  if (guardian === null) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <div className="border-primary size-7 animate-spin rounded-full border-2 border-t-transparent" />
        <p className="text-muted-foreground text-xs">Loading profile…</p>
      </div>
    );
  }

  function set<K extends keyof GuardianRow>(key: K, value: GuardianRow[K]) {
    setGuardian((g) => (g ? { ...g, [key]: value } : g));
  }

  const canEdit = can("guardian.update");
  const isActive = guardian.deleted_at == null;
  const activeChildren = children.filter((c) => c.deleted_at == null).length;

  async function save() {
    if (guardian === null) return;
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      await updateGuardian(guardianId, {
        full_name: guardian.full_name,
        whatsapp_phone: guardian.whatsapp_phone,
        country: guardian.country,
        currency: guardian.currency,
        notes: guardian.notes,
      });
      setNotice(t("form.saved"));
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function linkStudent() {
    if (!selectedStudentId) return;
    setLinking(true);
    setError(null);
    try {
      await updateStudent(selectedStudentId, { guardian_id: guardianId });
      setAddingChild(false);
      setSelectedStudentId("");
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="guardian-detail">

      {/* ── Profile hero ────────────────────────────────────────────── */}
      <div className="flex items-start gap-4 rounded-2xl border bg-gradient-to-br from-muted/60 to-muted/10 p-5">
        <Avatar name={guardian.full_name} size="lg" />
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold leading-tight">{guardian.full_name}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {isActive ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {t("filter.active")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                <span className="size-1.5 rounded-full bg-slate-400" />
                {t("filter.inactive")}
              </span>
            )}
            {guardian.country && (
              <span className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5 text-xs font-medium ring-1 ring-border">
                <Globe className="size-3 text-muted-foreground" />
                {guardian.country}
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/8 px-2 py-0.5 text-xs font-semibold text-primary">
              <Coins className="size-3" />
              {guardian.currency}
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5">
            <MessageCircle className="size-3.5 shrink-0 text-emerald-500" />
            <span className="font-mono text-xs text-muted-foreground">
              {guardian.whatsapp_phone}
            </span>
          </div>
        </div>
      </div>

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}
      {notice && (
        <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />
      )}

      {/* ── Edit form ────────────────────────────────────────────────── */}
      {canEdit && (
        <section className="space-y-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Profile Details
          </p>

          <Field label={t("form.fullName")}>
            <input
              aria-label={t("form.fullName")}
              className={cn(inputBase, "px-3.5 py-2.5")}
              value={guardian.full_name}
              onChange={(e) => set("full_name", e.target.value)}
            />
          </Field>

          <Field label={t("form.phone")}>
            <div className="relative">
              <MessageCircle className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-emerald-500" />
              <input
                aria-label={t("form.phone")}
                className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                value={guardian.whatsapp_phone}
                onChange={(e) => set("whatsapp_phone", e.target.value)}
              />
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("form.country")}>
              <div className="relative">
                <Globe className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  aria-label={t("form.country")}
                  className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                  maxLength={2}
                  value={guardian.country ?? ""}
                  onChange={(e) => set("country", e.target.value.toUpperCase())}
                />
              </div>
            </Field>
            <Field label={t("form.currency")}>
              <div className="relative">
                <Coins className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  aria-label={t("form.currency")}
                  className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                  maxLength={3}
                  value={guardian.currency}
                  onChange={(e) => set("currency", e.target.value.toUpperCase())}
                />
              </div>
            </Field>
          </div>

          <Field label={t("form.notes")}>
            <div className="relative">
              <FileText className="pointer-events-none absolute start-3.5 top-3 size-4 text-muted-foreground" />
              <textarea
                aria-label={t("form.notes")}
                className={cn(inputBase, "resize-none py-2.5 ps-10 pe-3.5")}
                rows={2}
                placeholder="Optional notes…"
                value={guardian.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
              />
            </div>
          </Field>

          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => void save()}
              data-testid="save-guardian"
              className="gap-1.5"
            >
              {saving ? (
                <>
                  <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                  {t("form.saving")}
                </>
              ) : (
                <>
                  <Check className="size-3.5" />
                  {t("form.save")}
                </>
              )}
            </Button>
          </div>
        </section>
      )}

      {/* ── Students ─────────────────────────────────────────────────── */}
      <section
        className="space-y-3 rounded-2xl border bg-muted/20 p-4"
        data-testid="guardian-children"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GraduationCap className="size-4 text-muted-foreground" aria-hidden />
            <h4 className="text-sm font-semibold">
              {t("detail.children")}
              <span className="ms-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {activeChildren}
              </span>
            </h4>
          </div>
          {can("student.create") && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => setAddingChild(true)}
              data-testid="add-child"
              className="gap-1"
            >
              <Plus className="size-3" />
              {t("detail.addChild")}
            </Button>
          )}
        </div>

        {/* Inline link-student picker */}
        {addingChild && (
          <div className="rounded-xl border bg-background p-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("detail.linkStudent")}
            </p>
            <Combobox
              options={studentOptions}
              value={selectedStudentId}
              onChange={setSelectedStudentId}
              placeholder={loadingStudents ? t("detail.linking") : t("detail.searchStudents")}
              searchPlaceholder={t("detail.searchStudents")}
              disabled={loadingStudents}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => setAddingChild(false)}
                disabled={linking}
              >
                {t("back")}
              </Button>
              <Button
                type="button"
                size="xs"
                disabled={!selectedStudentId || linking}
                onClick={() => void linkStudent()}
                className="gap-1"
              >
                {linking && (
                  <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {linking ? t("detail.linking") : t("detail.addChild")}
              </Button>
            </div>
          </div>
        )}

        {children.length === 0 && !addingChild ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed py-8 text-center">
            <GraduationCap className="mb-2 size-8 text-muted-foreground/30" aria-hidden />
            <p className="text-sm text-muted-foreground">{t("detail.noChildren")}</p>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {children.map((c) => {
              const active = c.deleted_at == null;
              return (
                <li
                  key={c.id}
                  data-child={c.id}
                  className="flex items-center gap-3 rounded-xl border bg-card px-4 py-2.5 transition-colors hover:bg-muted/30"
                >
                  <Avatar name={c.full_name} size="sm" />
                  <span className="flex-1 text-sm font-medium">{c.full_name}</span>
                  {active ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      Active
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800/40 dark:text-slate-400">
                      {t("filter.inactive")}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Danger zone ──────────────────────────────────────────────── */}
      {canEdit && isActive && (
        <section className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4">
          {!confirmDeactivate ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive/60" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-destructive">
                    {t("detail.deactivate")}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {activeChildren > 0
                      ? `Blocked — ${activeChildren} active student${activeChildren > 1 ? "s" : ""} must be deactivated first`
                      : "No active students — safe to deactivate"}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                onClick={() => setConfirmDeactivate(true)}
                data-testid="deactivate-guardian"
              >
                {t("detail.deactivate")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-destructive">Confirm deactivation?</p>
              <p className="text-xs text-muted-foreground">
                This will deactivate the guardian record. This action can be reversed by an admin.
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setConfirmDeactivate(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="xs"
                  onClick={async () => {
                    setError(null);
                    try {
                      await deactivateGuardian(guardianId);
                      onDeactivated?.();
                      onBack();
                    } catch (err) {
                      setError(
                        err instanceof ApiError
                          ? t("detail.deactivateBlocked")
                          : String(err),
                      );
                      setConfirmDeactivate(false);
                    }
                  }}
                >
                  Yes, Deactivate
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
