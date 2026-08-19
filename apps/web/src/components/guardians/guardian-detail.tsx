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
  UserCircle2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import { FactCard, ProfileCard } from "@/components/ui/profile-card";
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
import { COUNTRIES } from "@/lib/countries";
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
        <p className="text-muted-foreground text-xs">{t("detail.loading")}</p>
      </div>
    );
  }

  function set<K extends keyof GuardianRow>(key: K, value: GuardianRow[K]) {
    setGuardian((g) => (g ? { ...g, [key]: value } : g));
  }

  const canEdit = can("guardian.update");
  const isActive = guardian.deleted_at == null;
  const activeChildren = children.filter((c) => c.deleted_at == null).length;
  const countryName = guardian.country
    ? (COUNTRIES.find((c) => c.code === guardian.country)?.name ?? guardian.country)
    : null;

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
    <div className="space-y-4" data-testid="guardian-detail">

      {/* ── Fact strip ───────────────────────────────────────────────────
          The three things anyone opening a guardian wants: are they live, how do we reach them,
          and what currency do we invoice them in. Previously a row of pills on a grey hero, at
          the same weight as everything else on the page. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <FactCard
          icon={isActive ? Check : ShieldAlert}
          label={t("colStatus")}
          tone={isActive ? "emerald" : "slate"}
          value={isActive ? t("filter.active") : t("filter.inactive")}
          sub={countryName ?? undefined}
        />
        <FactCard
          icon={MessageCircle}
          label={t("colPhone")}
          tone="emerald"
          muted={!guardian.whatsapp_phone}
          value={
            guardian.whatsapp_phone ? (
              <span dir="ltr" className="tabular-nums">
                {guardian.whatsapp_phone}
              </span>
            ) : (
              t("form.none")
            )
          }
        />
        <FactCard
          icon={Coins}
          label={t("colCurrency")}
          tone="gold"
          value={guardian.currency}
          sub={t("detail.billingCurrency")}
        />
      </div>

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      {error && (
        <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
      )}
      {notice && (
        <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />
      )}

      {/* ── Billing contact ──────────────────────────────────────────── */}
      {canEdit && (
        <ProfileCard
          icon={UserCircle2}
          title={t("detail.profileTitle")}
          description={t("detail.profileDesc")}
          tone="emerald"
        >
          <div className="space-y-4">
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
                  dir="ltr"
                  className={cn(inputBase, "py-2.5 ps-10 pe-3.5 tabular-nums")}
                  value={guardian.whatsapp_phone}
                  onChange={(e) => set("whatsapp_phone", e.target.value)}
                />
              </div>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("form.country")}>
                <div className="relative">
                  <Globe className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
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
                  <Coins className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
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
                <FileText className="text-muted-foreground pointer-events-none absolute start-3.5 top-3 size-4" />
                <textarea
                  aria-label={t("form.notes")}
                  className={cn(inputBase, "resize-none py-2.5 ps-10 pe-3.5")}
                  rows={2}
                  placeholder={t("form.notesPlaceholder")}
                  value={guardian.notes ?? ""}
                  onChange={(e) => set("notes", e.target.value)}
                />
              </div>
            </Field>

            <div className="flex justify-end border-t pt-4">
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
          </div>
        </ProfileCard>
      )}

      {/* ── Linked students ──────────────────────────────────────────── */}
      <ProfileCard
        icon={GraduationCap}
        title={t("detail.children")}
        description={t("detail.childrenDesc")}
        tone="violet"
        testId="guardian-children"
        action={
          <div className="flex items-center gap-2">
            <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums">
              {activeChildren}
            </span>
            {can("student.create") && !addingChild && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAddingChild(true)}
                data-testid="add-child"
                className="gap-1"
              >
                <Plus className="size-3" />
                {t("detail.addChild")}
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-3">
          {/* Inline link-student picker */}
          {addingChild && (
            <div className="bg-muted/30 space-y-3 rounded-xl border p-3">
              <p className="text-muted-foreground text-xs font-medium">
                {t("detail.linkStudent")}
              </p>
              <Combobox
                options={studentOptions}
                value={selectedStudentId}
                onChange={setSelectedStudentId}
                placeholder={
                  loadingStudents ? t("detail.linking") : t("detail.searchStudents")
                }
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
              <GraduationCap
                className="text-muted-foreground/30 mb-2 size-8"
                aria-hidden
              />
              <p className="text-muted-foreground text-sm">{t("detail.noChildren")}</p>
            </div>
          ) : (
            <ul className="divide-border/70 divide-y overflow-hidden rounded-xl border">
              {children.map((c) => {
                const active = c.deleted_at == null;
                return (
                  <li
                    key={c.id}
                    data-child={c.id}
                    className="hover:bg-muted/30 flex items-center gap-3 px-4 py-2.5 transition-colors"
                  >
                    <Avatar name={c.full_name} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {c.full_name}
                    </span>
                    {active ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        {t("filter.active")}
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
        </div>
      </ProfileCard>

      {/* ── Danger zone ──────────────────────────────────────────────── */}
      {canEdit && isActive && (
        <ProfileCard
          icon={ShieldAlert}
          title={t("detail.deactivate")}
          description={t("detail.dangerDesc")}
          tone="danger"
          className="border-destructive/25"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* A guardian is the billing anchor for their children — the server refuses to
                deactivate one while a student still hangs off it, so say that BEFORE the click
                rather than as an error after it. */}
            <p
              className={cn(
                "min-w-0 text-xs",
                activeChildren > 0
                  ? "text-destructive font-medium"
                  : "text-muted-foreground",
              )}
            >
              {activeChildren > 0
                ? t("detail.deactivateBlockedCount", { count: activeChildren })
                : t("detail.deactivateSafe")}
            </p>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={activeChildren > 0}
              onClick={() => setConfirmDeactivate(true)}
              data-testid="deactivate-guardian"
              className="shrink-0"
            >
              {t("detail.deactivate")}
            </Button>
          </div>
        </ProfileCard>
      )}

      {/* ── Deactivate confirmation ──────────────────────────────────── */}
      <Modal
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        title={t("detail.deactivateConfirmTitle")}
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmDeactivate(false)}
            >
              {t("detail.deactivateCancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              data-testid="confirm-deactivate-guardian"
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
              {t("detail.deactivateYes")}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t("detail.deactivateConfirmBody")}</p>
      </Modal>
    </div>
  );
}
