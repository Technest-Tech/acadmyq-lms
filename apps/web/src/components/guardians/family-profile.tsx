"use client";

import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  Coins,
  ExternalLink,
  FileText,
  Globe,
  GraduationCap,
  Link2,
  MessageCircle,
  Pencil,
  Plus,
  RotateCcw,
  ShieldAlert,
  UserCircle2,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { ChoiceCard, StudentForm } from "@/components/students/student-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import { HeroBadge, PageHero } from "@/components/ui/page-hero";
import { FactCard, ProfileCard } from "@/components/ui/profile-card";
import {
  ApiError,
  deactivateGuardian,
  getGuardian,
  listStudents,
  reactivateGuardian,
  updateGuardian,
  updateStudent,
  type GuardianChild,
  type GuardianRow,
} from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const STUDENT_STATUSES = ["REGULAR", "TRIAL", "TRIAL_BOOKED"] as const;

const inputBase =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-50";

// ── Pieces ────────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const text = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl font-bold text-white shadow-sm",
        size === "sm" ? "size-8 text-[10px]" : "size-10 text-xs",
      )}
      style={{ backgroundColor: `hsl(${nameHue(name)} 52% 44%)` }}
      aria-hidden
    >
      {text}
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
      <label className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        active
          ? "bg-emerald-100 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-950/40 dark:text-emerald-300"
          : "bg-slate-100 text-slate-500 ring-slate-500/15 dark:bg-slate-800/40 dark:text-slate-400",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          active ? "animate-pulse bg-emerald-500" : "bg-slate-400",
        )}
      />
      {label}
    </span>
  );
}

/** One label/value on a child's expanded detail — the read-only counterpart of a field. */
function ChildFact({
  icon: Icon,
  label,
  value,
  muted,
  dir,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  muted?: boolean;
  dir?: "ltr";
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="bg-muted/60 ring-border/60 flex size-8 shrink-0 items-center justify-center rounded-lg ring-1">
        <Icon className="text-muted-foreground size-3.5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-muted-foreground/70 text-[10px] font-semibold uppercase tracking-wide">
          {label}
        </p>
        <p
          className={cn(
            "truncate text-sm font-medium",
            muted && "text-muted-foreground/60 font-normal italic",
          )}
          dir={dir}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

// ── One child ─────────────────────────────────────────────────────────────────

/**
 * A child on the family file: the summary line everyone scans, and — one click down — the
 * details that used to cost a trip to the student's own profile, plus an inline edit of the
 * fields a parent's record is usually corrected from (name, lifecycle, their own WhatsApp).
 */
function ChildRow({
  child,
  canEdit,
  canPrice,
  onSaved,
  onError,
}: {
  child: GuardianChild;
  canEdit: boolean;
  canPrice: boolean;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations("guardians");
  const ts = useTranslations("students");
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(child.full_name);
  const [status, setStatus] = useState(child.status ?? "");
  const [phone, setPhone] = useState(child.whatsapp_phone ?? "");
  const [saving, setSaving] = useState(false);

  const active = child.deleted_at == null;
  const statusLabel =
    child.status &&
    (STUDENT_STATUSES as readonly string[]).includes(child.status)
      ? ts(`studentStatus.${child.status}`)
      : (child.status ?? "");
  const added = child.created_at
    ? new Date(child.created_at).toLocaleDateString(locale, {
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
    : null;

  async function save() {
    setSaving(true);
    try {
      await updateStudent(child.id, {
        full_name: name,
        whatsapp_phone: phone.trim() || null,
        // A deactivated child carries a terminal status (GRADUATED/WITHDRAWN) which the API
        // refuses on a plain edit — only forward one it accepts.
        ...((STUDENT_STATUSES as readonly string[]).includes(status)
          ? { status }
          : {}),
      });
      setEditing(false);
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li
      data-child={child.id}
      className={cn("px-4 py-3", !active && "opacity-70")}
    >
      {/* ── Summary line ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Avatar name={child.full_name} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{child.full_name}</p>
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {child.teacher_name ?? t("detail.noTeacher")}
            {child.plan_label ? ` · ${child.plan_label}` : ""}
          </p>
        </div>
        {statusLabel && active && (
          <span className="bg-muted text-muted-foreground hidden rounded-full px-2 py-0.5 text-[11px] font-medium sm:inline">
            {statusLabel}
          </span>
        )}
        <StatusPill
          active={active}
          label={active ? t("state.active") : t("state.inactive")}
        />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? t("detail.collapse") : t("detail.expand")}
          data-testid={`child-toggle-${child.id}`}
          className="text-muted-foreground hover:bg-muted/60 hover:text-foreground rounded-lg p-1.5 transition-colors"
        >
          <ChevronDown
            className={cn("size-4 transition-transform", open && "rotate-180")}
            aria-hidden
          />
        </button>
      </div>

      {/* ── Details ──────────────────────────────────────────────────── */}
      {open && (
        <div className="mt-3 space-y-3 ps-11">
          {editing ? (
            <div className="bg-muted/30 space-y-3 rounded-xl border p-3">
              <Field label={ts("form.fullName")}>
                <input
                  aria-label={ts("form.fullName")}
                  className={cn(inputBase, "px-3 py-2")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={ts("form.phone")}>
                  <input
                    aria-label={ts("form.phone")}
                    dir="ltr"
                    className={cn(inputBase, "px-3 py-2 tabular-nums")}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
                <Field label={ts("form.status")}>
                  <select
                    aria-label={ts("form.status")}
                    className={cn(inputBase, "px-3 py-2")}
                    value={
                      (STUDENT_STATUSES as readonly string[]).includes(status)
                        ? status
                        : ""
                    }
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {!(STUDENT_STATUSES as readonly string[]).includes(
                      status,
                    ) && <option value="">{status || ts("none")}</option>}
                    {STUDENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {ts(`studentStatus.${s}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={saving}
                  onClick={() => {
                    setEditing(false);
                    setName(child.full_name);
                    setStatus(child.status ?? "");
                    setPhone(child.whatsapp_phone ?? "");
                  }}
                >
                  {t("detail.deactivateCancel")}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  disabled={saving || !name.trim()}
                  onClick={() => void save()}
                  data-testid={`save-child-${child.id}`}
                  className="gap-1"
                >
                  {saving ? (
                    <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
                  ) : (
                    <Check className="size-3" aria-hidden />
                  )}
                  {saving ? t("form.saving") : t("form.save")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ChildFact
                icon={GraduationCap}
                label={t("detail.childTeacher")}
                muted={!child.teacher_name}
                value={child.teacher_name ?? t("detail.noTeacher")}
              />
              {canPrice && (
                <ChildFact
                  icon={BookOpen}
                  label={t("detail.childRate")}
                  muted={child.price_minor == null}
                  value={
                    child.price_minor != null && child.price_currency
                      ? formatMoney(
                          {
                            amount: child.price_minor,
                            currency: child.price_currency,
                          },
                          locale,
                        )
                      : t("detail.noPlan")
                  }
                />
              )}
              <ChildFact
                icon={MessageCircle}
                label={t("detail.childPhone")}
                muted={!child.whatsapp_phone}
                dir="ltr"
                value={child.whatsapp_phone ?? t("form.none")}
              />
              <ChildFact
                icon={CalendarDays}
                label={t("detail.childAddedOn")}
                muted={!added}
                value={added ?? t("form.none")}
              />
            </div>
          )}

          {!editing && (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/students/${child.id}`}
                className="text-primary inline-flex items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline"
              >
                <ExternalLink className="size-3" aria-hidden />
                {t("detail.openStudent")}
              </Link>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    // Seed from the row we are looking at, so a child changed elsewhere since
                    // this page loaded is not re-saved from stale fields.
                    setName(child.full_name);
                    setStatus(child.status ?? "");
                    setPhone(child.whatsapp_phone ?? "");
                    setEditing(true);
                  }}
                  data-testid={`edit-child-${child.id}`}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline"
                >
                  <Pencil className="size-3" aria-hidden />
                  {t("detail.editChild")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * A family's file. The parent used to be a modal holding their own form and a bare list of
 * children's names — which is the wrong shape for the thing an academy actually deals with:
 * "the Hassan family" is a billing contact AND two or three students with their own teachers,
 * terms and lifecycle. So this is a page, like a student's, and its centre of gravity is the
 * children: each one expands to what it would otherwise take a trip to their profile to read,
 * and new children are added — not just linked — right here.
 */
export function FamilyProfile({ guardianId }: { guardianId: string }) {
  const t = useTranslations("guardians");
  const locale = useLocale();
  const router = useRouter();
  const { can } = useAuth();

  const [guardian, setGuardian] = useState<GuardianRow | null>(null);
  const [children, setChildren] = useState<GuardianChild[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<"none" | "add" | "deactivate">("none");

  /**
   * Adding a child is one flow with two ways in: enrol someone new, or move a student who is
   * already on the roster. They used to be two buttons in two places — the big one in the hero
   * and a small "Link existing" in a card header — so the second was easy to miss entirely when
   * the student you wanted was already in the system.
   */
  const [addMode, setAddMode] = useState<"new" | "existing">("new");
  const [studentOptions, setStudentOptions] = useState<ComboboxOption[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [linking, setLinking] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await getGuardian(guardianId);
      setGuardian(res.guardian);
      setChildren(res.children);
    } catch {
      setNotFound(true);
    }
  }, [guardianId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The roster is fetched when the picker is actually shown, not when the modal opens — a user
  // enrolling a new child never pays for a list of 200 students they are not going to look at.
  useEffect(() => {
    if (modal !== "add" || addMode !== "existing") return;
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
              // Which family they sit in today — moving a child OUT of one parent and into
              // another is exactly what this does, so say whose child they are now.
              sublabel: s.guardian_name ?? undefined,
            })),
        ),
      )
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : String(err)),
      )
      .finally(() => setLoadingStudents(false));
  }, [modal, addMode, children]);

  if (notFound) {
    return (
      <div className="space-y-5">
        <BackLink label={t("detail.backToList")} />
        <div className="bg-card text-muted-foreground rounded-2xl border p-10 text-center text-sm">
          {t("detail.notFound")}
        </div>
      </div>
    );
  }

  if (guardian === null) return <FamilyProfileSkeleton />;

  function set<K extends keyof GuardianRow>(key: K, value: GuardianRow[K]) {
    setGuardian((g) => (g ? { ...g, [key]: value } : g));
  }

  const canEdit = can("guardian.update");
  const canEditStudent = can("student.update");
  const canPrice = can("student.set_price");
  const isActive = guardian.deleted_at == null;
  const activeChildren = children.filter((c) => c.deleted_at == null).length;
  const countryName = guardian.country
    ? (COUNTRIES.find((c) => c.code === guardian.country)?.name ??
      guardian.country)
    : null;
  const added = guardian.created_at
    ? new Date(guardian.created_at).toLocaleDateString(locale, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  function flash(message: string) {
    setNotice(message);
    setError(null);
  }

  async function saveGuardian() {
    if (guardian === null) return;
    setError(null);
    setSaving(true);
    try {
      await updateGuardian(guardianId, {
        full_name: guardian.full_name,
        whatsapp_phone: guardian.whatsapp_phone,
        country: guardian.country,
        currency: guardian.currency,
        notes: guardian.notes,
      });
      flash(t("form.saved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Open the add flow. Every entry point lands in the same modal; the argument only decides
   * which of the two ways in is preselected, and the user can switch there.
   */
  function openAdd(mode: "new" | "existing") {
    setAddMode(mode);
    setSelectedStudentId("");
    setModal("add");
  }

  async function linkStudent() {
    if (!selectedStudentId) return;
    setLinking(true);
    setError(null);
    try {
      await updateStudent(selectedStudentId, { guardian_id: guardianId });
      setModal("none");
      setSelectedStudentId("");
      await refresh();
      flash(t("detail.linked"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="space-y-5" data-testid="family-profile">
      <BackLink label={t("detail.backToList")} />

      <PageHero
        latticeId="family-hero-lattice"
        avatarName={guardian.full_name}
        title={guardian.full_name}
        subtitle={guardian.whatsapp_phone}
        badges={
          <>
            <HeroBadge>
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isActive ? "animate-pulse bg-emerald-300" : "bg-white/50",
                )}
              />
              {isActive ? t("state.active") : t("state.inactive")}
            </HeroBadge>
            <HeroBadge tone="gold">
              <Users className="size-3" aria-hidden />
              {t("book.students", { count: activeChildren })}
            </HeroBadge>
          </>
        }
        actions={
          canEditStudent && can("student.create") && isActive ? (
            <Button
              type="button"
              size="lg"
              onClick={() => openAdd("new")}
              data-testid="add-child"
              className="gap-2 border-transparent bg-white px-4 text-emerald-800 shadow-md hover:bg-white/90"
            >
              <Plus className="size-4" aria-hidden />
              {t("detail.addChild")}
            </Button>
          ) : undefined
        }
      />

      {/* ── Fact strip ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FactCard
          icon={Users}
          label={t("detail.familySize")}
          tone="violet"
          value={String(activeChildren)}
          sub={t("detail.familySizeSub")}
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
          sub={countryName ?? undefined}
        />
        <FactCard
          icon={Coins}
          label={t("colCurrency")}
          tone="gold"
          value={guardian.currency}
          sub={t("detail.billingCurrency")}
        />
        <FactCard
          icon={CalendarDays}
          label={t("detail.memberSince")}
          tone="slate"
          muted={!added}
          value={added ?? t("form.none")}
        />
      </div>

      {/* ── Alerts ───────────────────────────────────────────────────── */}
      {error && (
        <AlertBanner
          variant="error"
          message={error}
          onDismiss={() => setError(null)}
        />
      )}
      {notice && (
        <AlertBanner
          variant="success"
          message={notice}
          onDismiss={() => setNotice(null)}
        />
      )}

      {/* ── The children ─────────────────────────────────────────────── */}
      <ProfileCard
        icon={GraduationCap}
        title={t("detail.children")}
        description={t("detail.childrenDesc")}
        tone="violet"
        testId="guardian-children"
        bodyClassName="p-0"
        action={
          canEditStudent && isActive ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openAdd("existing")}
              data-testid="link-child"
              className="gap-1"
            >
              <Link2 className="size-3" aria-hidden />
              {t("detail.addExisting")}
            </Button>
          ) : undefined
        }
      >
        {children.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
            <GraduationCap
              className="text-muted-foreground/30 size-9"
              aria-hidden
            />
            <div>
              <p className="text-muted-foreground text-sm">
                {t("detail.noChildren")}
              </p>
              <p className="text-muted-foreground/70 mt-1 text-xs">
                {t("detail.noChildrenHint")}
              </p>
            </div>
            {can("student.create") && isActive && (
              <Button
                type="button"
                size="sm"
                onClick={() => openAdd("new")}
                data-testid="add-child-empty"
                className="gap-1.5"
              >
                <Plus className="size-3.5" aria-hidden />
                {t("detail.addChild")}
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-border/70 divide-y">
            {children.map((child) => (
              <ChildRow
                key={child.id}
                child={child}
                canEdit={canEditStudent}
                canPrice={canPrice}
                onSaved={() => {
                  void refresh();
                  flash(t("detail.childSaved"));
                }}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </ProfileCard>

      {/* ── Billing contact ──────────────────────────────────────────── */}
      {canEdit && (
        <ProfileCard
          icon={UserCircle2}
          title={t("detail.profileTitle")}
          description={t("detail.profileDesc")}
          tone="emerald"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                    className={cn(
                      inputBase,
                      "py-2.5 ps-10 pe-3.5 tabular-nums",
                    )}
                    value={guardian.whatsapp_phone}
                    onChange={(e) => set("whatsapp_phone", e.target.value)}
                  />
                </div>
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("form.country")}>
                <div className="relative">
                  <Globe className="text-muted-foreground pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2" />
                  <input
                    aria-label={t("form.country")}
                    className={cn(inputBase, "py-2.5 ps-10 pe-3.5")}
                    maxLength={2}
                    value={guardian.country ?? ""}
                    onChange={(e) =>
                      set("country", e.target.value.toUpperCase())
                    }
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
                    onChange={(e) =>
                      set("currency", e.target.value.toUpperCase())
                    }
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
                onClick={() => void saveGuardian()}
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

      {/* ── Danger zone / the way back ───────────────────────────────── */}
      {canEdit && isActive && (
        <ProfileCard
          icon={ShieldAlert}
          title={t("detail.deactivate")}
          description={t("detail.dangerDesc")}
          tone="danger"
          className="border-destructive/25"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* The server refuses while a student still hangs off this parent — say so BEFORE
                the click rather than as an error after it. */}
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
              onClick={() => setModal("deactivate")}
              data-testid="deactivate-guardian"
              className="shrink-0"
            >
              {t("detail.deactivate")}
            </Button>
          </div>
        </ProfileCard>
      )}

      {canEdit && !isActive && (
        <ProfileCard
          icon={RotateCcw}
          title={t("detail.reactivate")}
          description={t("detail.reactivateDesc")}
          tone="slate"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-muted-foreground min-w-0 text-xs">
              {t("detail.reactivateHint")}
            </p>
            <Button
              type="button"
              size="sm"
              data-testid="reactivate-guardian"
              className="shrink-0 gap-1.5"
              onClick={async () => {
                setError(null);
                try {
                  await reactivateGuardian(guardianId);
                  await refresh();
                  flash(t("detail.reactivated"));
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : String(err));
                }
              }}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t("detail.reactivate")}
            </Button>
          </div>
        </ProfileCard>
      )}

      {/* ── Add a child: a new student, or one already on the roster ─── */}
      <Modal
        open={modal === "add"}
        onClose={() => setModal("none")}
        title={t("detail.addChildTitle", { name: guardian.full_name })}
        description={t("detail.addChildDesc")}
        size="md"
        footer={
          // The create form carries its own buttons; only the picker needs a footer.
          addMode === "existing" ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={linking}
                onClick={() => setModal("none")}
              >
                {t("detail.deactivateCancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!selectedStudentId || linking}
                onClick={() => void linkStudent()}
                data-testid="confirm-link-child"
                className="gap-1"
              >
                {linking && (
                  <span className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
                )}
                {linking ? t("detail.linking") : t("detail.moveHere")}
              </Button>
            </>
          ) : undefined
        }
      >
        {modal === "add" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ChoiceCard
                icon={UserPlus}
                title={t("detail.addNew")}
                hint={t("detail.addNewHint")}
                selected={addMode === "new"}
                onSelect={() => setAddMode("new")}
                testId="add-mode-new"
              />
              <ChoiceCard
                icon={Link2}
                title={t("detail.addExisting")}
                hint={t("detail.addExistingHint")}
                selected={addMode === "existing"}
                onSelect={() => setAddMode("existing")}
                testId="add-mode-existing"
              />
            </div>

            {addMode === "new" ? (
              <StudentForm
                fixedGuardianId={guardianId}
                onCancel={() => setModal("none")}
                onCreated={() => {
                  setModal("none");
                  void refresh();
                  flash(t("detail.childAdded"));
                }}
              />
            ) : (
              <div className="space-y-3">
                <Combobox
                  options={studentOptions}
                  value={selectedStudentId}
                  onChange={setSelectedStudentId}
                  placeholder={
                    loadingStudents
                      ? t("detail.linking")
                      : t("detail.searchStudents")
                  }
                  searchPlaceholder={t("detail.searchStudents")}
                  disabled={loadingStudents}
                  data-testid="link-student-picker"
                />
                {/* Moving a child is not the same act as enrolling one — the student keeps
                    their teacher, timetable and price, and only the payer changes. */}
                <p className="text-muted-foreground text-xs">
                  {!loadingStudents && studentOptions.length === 0
                    ? t("detail.noStudentsToLink")
                    : t("detail.linkStudentHint")}
                </p>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Deactivate confirmation ──────────────────────────────────── */}
      <Modal
        open={modal === "deactivate"}
        onClose={() => setModal("none")}
        title={t("detail.deactivateConfirmTitle")}
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setModal("none")}
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
                  router.push("/guardians");
                } catch (err) {
                  setError(
                    err instanceof ApiError
                      ? t("detail.deactivateBlocked")
                      : String(err),
                  );
                  setModal("none");
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

// ── Skeleton ──────────────────────────────────────────────────────────────────

/** The page's shape while it loads — exported so the route's `loading.tsx` shows the same. */
export function FamilyProfileSkeleton() {
  return (
    <div className="space-y-5" data-testid="family-profile-skeleton">
      <div className="bg-muted h-5 w-24 animate-pulse rounded" />
      <div
        className="h-[8.5rem] animate-pulse rounded-2xl shadow-lg"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.30 0.065 163) 0%, oklch(0.38 0.105 168) 48%, oklch(0.32 0.085 196) 100%)",
        }}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="bg-card flex items-start gap-3 rounded-xl border p-3.5 shadow-sm"
          >
            <div className="bg-muted size-9 shrink-0 animate-pulse rounded-xl" />
            <div className="flex-1 space-y-2 py-0.5">
              <div className="bg-muted h-2.5 w-16 animate-pulse rounded" />
              <div className="bg-muted h-3.5 w-24 animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
      <div className="bg-card rounded-2xl border shadow-sm">
        <div className="bg-muted/40 h-16 rounded-t-2xl border-b" />
        <div className="divide-border/70 divide-y">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="bg-muted size-8 animate-pulse rounded-xl" />
              <div className="flex-1 space-y-2">
                <div className="bg-muted h-3 w-32 animate-pulse rounded" />
                <div className="bg-muted h-2.5 w-24 animate-pulse rounded" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function BackLink({ label }: { label: string }) {
  return (
    <Link
      href="/guardians"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
    >
      <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden />
      {label}
    </Link>
  );
}
