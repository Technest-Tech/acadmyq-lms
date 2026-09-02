"use client";

import { SUBSCRIPTION_STATUS } from "@academiq/contracts";
import {
  BookCheck,
  CalendarClock,
  GraduationCap,
  MapPin,
  MessageCircle,
  Plus,
  ShieldCheck,
  UserCheck,
  UserCircle2,
  Zap,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Octagram } from "@/components/ornaments";
import { Button } from "@/components/ui/button";
import {
  type ColumnDef,
  DataTable,
  type FilterDef,
} from "@/components/ui/data-table";
import {
  listStudents,
  listTeachers,
  type StudentRow,
  type TeacherRow,
} from "@/lib/api";
import { COUNTRIES } from "@/lib/countries";
import { type ExcelColumn } from "@/lib/export-excel";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** The four stages a student record moves through — the server's `students.status`. */
const STUDENT_STAGES = [
  "REGULAR",
  "TRIAL",
  "TRIAL_BOOKED",
  "DEACTIVATED",
] as const;

function countryCell(code: string | null): { flag: string; code: string; name: string } | null {
  if (!code) return null;
  const c = COUNTRIES.find((x) => x.code === code);
  return c ? { flag: c.flag, code: c.code, name: c.name } : { flag: "", code, name: code };
}

/** Short, unambiguous date — "12 Mar 2026". Never a bare "12/03", which reads two ways. */
function shortDate(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

// ── Avatars ────────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * The student's mark. A stable hue per name means the same face appears in the same colour on
 * every visit, so a long roll becomes scannable by colour before a single name is read; the gold
 * ring is the frame's own hairline at avatar scale.
 */
function StudentAvatar({ name }: { name: string }) {
  const hue = nameHue(name);
  return (
    <div
      className="ring-gold/25 flex size-10 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold text-white shadow-sm ring-1"
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 58% 50%), hsl(${(hue + 32) % 360} 56% 40%))`,
      }}
      aria-hidden
    >
      {initialsOf(name)}
    </div>
  );
}

/** The teacher's mark, one size down — a person, not another badge. */
function PersonChip({ name, icon: Icon }: { name: string; icon: typeof GraduationCap }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="bg-primary/10 text-primary ring-primary/15 flex size-6 shrink-0 items-center justify-center rounded-lg text-[9px] font-bold ring-1">
        {initialsOf(name) || <Icon className="size-3" aria-hidden />}
      </span>
      <span className="truncate text-sm">{name}</span>
    </span>
  );
}

function Dash() {
  return <span className="text-muted-foreground/35">—</span>;
}

// ── Status badges ──────────────────────────────────────────────────────────────

function SubBadge({ status }: { status: string | null }) {
  const t = useTranslations("students");
  if (!status) {
    return (
      <span className="text-muted-foreground/60 inline-flex items-center gap-1.5 rounded-full border border-dashed px-2.5 py-0.5 text-xs">
        {t("list.noSubscription")}
      </span>
    );
  }
  const styles: Record<string, string> = {
    ACTIVE:
      "bg-emerald-100 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-950/40 dark:text-emerald-300",
    PAUSED:
      "bg-amber-100 text-amber-700 ring-amber-600/15 dark:bg-amber-950/40 dark:text-amber-300",
    ENDED:
      "bg-slate-100 text-slate-500 ring-slate-500/15 dark:bg-slate-800/40 dark:text-slate-400",
  };
  const dots: Record<string, string> = {
    ACTIVE: "bg-emerald-500 animate-pulse",
    PAUSED: "bg-amber-500",
    ENDED: "bg-slate-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        styles[status] ?? "bg-muted text-muted-foreground ring-transparent",
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", dots[status] ?? "bg-muted-foreground")}
      />
      {t(`subStatus.${status}`)}
    </span>
  );
}

/** The stage badge — only shown when the student is NOT a plain enrolled record. */
function StageBadge({ status }: { status: string | null }) {
  const t = useTranslations("students");
  if (status === "TRIAL_BOOKED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
        <CalendarClock className="size-2.5" />
        {t("trialBadge.scheduled")}
      </span>
    );
  }
  if (status === "TRIAL") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        <span className="size-1.5 rounded-full bg-amber-500" />
        {t("trialBadge.trial")}
      </span>
    );
  }
  if (status === "DEACTIVATED") {
    return (
      <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
        {t("studentStatus.DEACTIVATED")}
      </span>
    );
  }
  return null;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function StudentsList({
  onNew,
  onOpen,
  onConfirmEnroll,
  onCancelTrial,
  refreshToken,
  filterPreset,
  pendingRowId,
  onPrefetch,
}: {
  onNew: () => void;
  onOpen: (id: string, name: string) => void;
  onConfirmEnroll?: (id: string, name: string, teacherId?: string) => void;
  onCancelTrial?: (id: string, name: string) => void;
  refreshToken?: number;
  /** Set by the segment tiles above the table — see `student-manager`. */
  filterPreset?: { values: Record<string, string>; token: number };
  /** The row whose profile is currently opening — it shows a spinner. */
  pendingRowId?: string | null;
  /** Warm a student's profile route on hover so the click lands on a loaded page. */
  onPrefetch?: (id: string) => void;
}) {
  const t = useTranslations("students");
  const locale = useLocale();
  const { can, session } = useAuth();
  const isTeacher = session?.role === "TEACHER";
  const canPrice = can("student.set_price");
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);

  useEffect(() => {
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, []);

  const priceSuffix = useMemo(
    () => ({
      PER_HOUR: t("subscription.perHourShort"),
      PER_MONTH: t("subscription.perMonthShort"),
      PER_SESSION: t("subscription.perSessionShort"),
    }),
    [t],
  );

  const columns = useMemo<ColumnDef<StudentRow>[]>(
    () => {
      /**
       * One column per QUESTION, not one per database field: who is this (with the parent who
       * pays and the stage they're at), who teaches them, what are they on, what does it cost,
       * how do we reach them, since when. The old layout spent seven columns answering six
       * questions and left the parent and the phone stranded in columns of their own.
       */
      const cols: ColumnDef<StudentRow>[] = [
        {
          key: "name",
          header: t("list.colStudent"),
          sortKey: "name",
          headerClassName: "min-w-64",
          hideOnCard: true,
          render: (r) => (
            <div className="flex items-center gap-3">
              <StudentAvatar name={r.full_name} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">{r.full_name}</span>
                  <StageBadge status={r.status} />
                </div>
                {/* The parent under the child: on a roll of minors, the guardian IS part of the
                    student's identity, and folding it in here buys back a whole column. */}
                <div className="text-muted-foreground mt-0.5 flex items-center gap-1 text-xs">
                  {isTeacher ? null : r.is_self_guardian ? (
                    <>
                      <ShieldCheck className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{t("list.selfGuardian")}</span>
                    </>
                  ) : r.guardian_name ? (
                    <>
                      <UserCircle2 className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{r.guardian_name}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ),
        },
        {
          key: "teacher",
          header: t("colTeacher"),
          headerClassName: "min-w-40",
          render: (r) =>
            r.teacher_name ? (
              <PersonChip name={r.teacher_name} icon={GraduationCap} />
            ) : (
              <span className="text-muted-foreground/70 inline-flex items-center gap-1.5 text-xs italic">
                <GraduationCap className="size-3.5 shrink-0 opacity-50" aria-hidden />
                {t("list.unassigned")}
              </span>
            ),
        },
        {
          key: "status",
          header: t("colSubscription"),
          headerClassName: "min-w-44",
          render: (r) => (
            <div className="space-y-1">
              <SubBadge status={r.subscription_status} />
              {/* What the badge doesn't say: which package, and running since when. */}
              {(r.plan_label || r.start_date) && (
                <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                  {r.plan_label && (
                    <span className="truncate font-medium">{r.plan_label}</span>
                  )}
                  {r.plan_label && r.start_date && (
                    <Octagram className="text-gold/50 size-1.5 shrink-0" />
                  )}
                  {r.start_date && (
                    <span className="whitespace-nowrap tabular-nums">
                      {t("teacher.since", {
                        date: shortDate(r.start_date, locale) ?? "",
                      })}
                    </span>
                  )}
                </div>
              )}
            </div>
          ),
        },
      ];

      // The rate column belongs to whoever may set it. A role denied pricing (SUPERVISOR) has the
      // figure blanked by the API anyway, so showing the column would print a row of dashes and
      // offer a sort the server refuses.
      if (!isTeacher && canPrice) {
        cols.push({
          key: "price",
          header: t("colRate"),
          sortKey: "price",
          className: "text-end",
          headerClassName: "min-w-28",
          render: (r) =>
            r.price_minor != null && r.price_currency ? (
              <div className="text-end leading-tight">
                <div className="font-semibold tabular-nums">
                  {formatMoney(
                    { amount: r.price_minor, currency: r.price_currency },
                    locale,
                  )}
                  <span className="text-muted-foreground ms-0.5 text-[10px] font-normal">
                    {priceSuffix[
                      (r.price_basis ?? "PER_HOUR") as keyof typeof priceSuffix
                    ] ?? ""}
                  </span>
                </div>
                {r.sessions_per_month != null && (
                  <div className="text-muted-foreground text-[10px] tabular-nums">
                    {t("list.sessionsPerMonth", { n: r.sessions_per_month })}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-end">
                <Dash />
              </div>
            ),
        });
      }

      cols.push({
        key: "contact",
        header: isTeacher ? t("colCountry") : t("colContact"),
        headerClassName: "min-w-40",
        render: (r) => {
          const c = countryCell(r.country);
          if (!c && !r.whatsapp_phone) return <Dash />;
          return (
            <div className="space-y-0.5 leading-tight">
              {!isTeacher && r.whatsapp_phone && (
                <span
                  dir="ltr"
                  className="inline-flex items-center gap-1.5 text-sm tabular-nums"
                >
                  <MessageCircle
                    className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden
                  />
                  {r.whatsapp_phone}
                </span>
              )}
              {c && (
                <div
                  className="text-muted-foreground flex items-center gap-1.5 text-[11px]"
                  title={c.name}
                >
                  {c.flag ? (
                    <span aria-hidden>{c.flag}</span>
                  ) : (
                    <MapPin className="size-3 shrink-0" aria-hidden />
                  )}
                  <span className="truncate">{c.name}</span>
                </div>
              )}
            </div>
          );
        },
      });

      cols.push({
        key: "created_at",
        header: t("colAdded"),
        sortKey: "created_at",
        headerClassName: "min-w-28",
        render: (r) => (
          <span className="text-muted-foreground whitespace-nowrap text-xs tabular-nums">
            {shortDate(r.created_at, locale) ?? <Dash />}
          </span>
        ),
      });

      return cols;
    },
    [t, locale, isTeacher, canPrice, priceSuffix],
  );

  const filters = useMemo<FilterDef[]>(
    () => [
      {
        key: "status",
        label: t("filter.status"),
        options: [
          { value: "active", label: t("filter.active") },
          { value: "inactive", label: t("filter.inactive") },
          { value: "all", label: t("filter.all") },
        ],
      },
      {
        key: "student_status",
        label: t("filter.stage"),
        options: STUDENT_STAGES.map((s) => ({
          value: s,
          label: t(`studentStatus.${s}`),
        })),
      },
      {
        key: "teacher_id",
        label: t("filter.teacher"),
        options: teachers.map((tch) => ({
          value: tch.id,
          label: tch.full_name,
        })),
      },
      {
        key: "subscription_status",
        label: t("filter.subscriptionStatus"),
        options: SUBSCRIPTION_STATUS.map((s) => ({
          value: s,
          label: t(`subStatus.${s}`),
        })),
      },
      // Set only by the "Trials" tile above the table — TRIAL and TRIAL_BOOKED at once, which no
      // single `student_status` value can express. Declared so the chip row can name and clear it.
      {
        key: "trial_any",
        label: t("filter.stage"),
        hidden: true,
        options: [{ value: "1", label: t("stats.trials") }],
      },
    ],
    [t, teachers],
  );

  const exportColumns = useMemo<ExcelColumn<StudentRow>[]>(() => {
    const cols: ExcelColumn<StudentRow>[] = [
      { header: t("list.colStudent"), value: (r) => r.full_name, width: 28 },
      {
        header: t("colStatus"),
        value: (r) => (r.status ? t(`studentStatus.${r.status}`) : ""),
      },
    ];
    if (!isTeacher) {
      cols.push({ header: t("colGuardian"), value: (r) => r.guardian_name, width: 24 });
    }
    cols.push(
      { header: t("colTeacher"), value: (r) => r.teacher_name, width: 24 },
      {
        header: t("colSubscription"),
        value: (r) =>
          r.subscription_status ? t(`subStatus.${r.subscription_status}`) : "",
      },
      { header: t("subscription.planLabel"), value: (r) => r.plan_label },
      { header: t("subscription.startDate"), value: (r) => r.start_date },
    );
    if (!isTeacher) {
      cols.push(
        {
          header: t("colRate"),
          value: (r) =>
            r.price_minor != null && r.price_currency
              ? formatMoney(
                  { amount: r.price_minor, currency: r.price_currency },
                  locale,
                )
              : "",
        },
        {
          header: t("subscription.basis"),
          value: (r) => (r.price_basis ? t(`basis.${r.price_basis}`) : ""),
        },
        { header: t("colWhatsapp"), value: (r) => r.whatsapp_phone },
      );
    }
    cols.push(
      {
        header: t("colCountry"),
        value: (r) => countryCell(r.country)?.name ?? "",
      },
      { header: t("colAdded"), value: (r) => r.created_at?.slice(0, 10) ?? "" },
    );
    return cols;
  }, [t, locale, isTeacher]);

  const newButton = can("student.create") ? (
    <Button
      type="button"
      size="lg"
      onClick={onNew}
      data-testid="new-student-top"
      className="gap-1.5 shadow-sm shadow-primary/20"
    >
      <Plus className="size-3.5" aria-hidden />
      {t("new")}
    </Button>
  ) : undefined;

  return (
    <section className="bg-card overflow-hidden rounded-2xl border shadow-sm">
      {/* ── Panel header ───────────────────────────────────────────────────
          The roll's own nameplate: emerald wash, khatam-scale gold hairline underneath, and the
          one line telling a new user that a row is clickable. */}
      <div className="relative border-b">
        <div className="from-primary/[0.07] via-primary/[0.025] flex items-center justify-between gap-3 bg-gradient-to-r to-transparent px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="bg-primary/10 ring-primary/15 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1">
              <BookCheck className="text-primary size-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
                {t("list.allStudents")}
                <Octagram className="text-gold/60 size-2 shrink-0" />
              </h2>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {t("list.allStudentsSub")}
              </p>
            </div>
          </div>
        </div>
        <span
          className="via-gold/45 absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent"
          aria-hidden
        />
      </div>

      {/* Table body */}
      <div className="p-4">
        <DataTable<StudentRow>
          testId="students-table"
          fetcher={listStudents}
          columns={columns}
          getRowId={(r) => r.id}
          searchable
          searchPlaceholder={t("list.searchPlaceholder")}
          filters={filters}
          filterPreset={filterPreset}
          showIndex
          defaultSort="name"
          emptyMessage={t("empty")}
          emptyAction={newButton}
          toolbar={newButton}
          exportConfig={{
            fileName: "students",
            sheetName: t("list.allStudents"),
            columns: exportColumns,
          }}
          refreshToken={refreshToken}
          pendingRowId={pendingRowId}
          onRowHover={(r) => onPrefetch?.(r.id)}
          onRowClick={(r) => onOpen(r.id, r.full_name)}
          rowActions={(r) => {
            // Teachers only see a sessions button — no management actions
            if (isTeacher) {
              return (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onOpen(r.id, r.full_name)}
                >
                  {t("actions.view")}
                </Button>
              );
            }

            // Trial student — saved by the quick form; setup (schedule a trial or activate) is
            // done from the profile, so the action opens the details rather than a modal.
            if (r.status === "TRIAL") {
              return (
                <Button
                  type="button"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(r.id, r.full_name);
                  }}
                  className="gap-1 border-transparent bg-amber-500 text-white hover:bg-amber-600 focus-visible:ring-amber-500/40"
                >
                  <Zap className="size-3" />
                  {t("actions.setUp")}
                </Button>
              );
            }

            // Trial booked — confirm or cancel
            if (r.status === "TRIAL_BOOKED") {
              return (
                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onConfirmEnroll?.(r.id, r.full_name, r.teacher_id ?? undefined);
                    }}
                    className="gap-1 border-transparent bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500/40"
                  >
                    <UserCheck className="size-3" />
                    {t("actions.confirm")}
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCancelTrial?.(r.id, r.full_name);
                    }}
                  >
                    {t("actions.cancel")}
                  </Button>
                </div>
              );
            }

            // Regular student
            return (
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onOpen(r.id, r.full_name)}
                className="gap-1"
              >
                {t("manage")}
              </Button>
            );
          }}
        />
      </div>
    </section>
  );
}
