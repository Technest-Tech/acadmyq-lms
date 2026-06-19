"use client";

import { SUBSCRIPTION_STATUS } from "@academiq/contracts";
import {
  BookCheck,
  CalendarClock,
  GraduationCap,
  MapPin,
  Phone,
  Plus,
  UserCheck,
  UserCircle2,
  Zap,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
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

function countryCell(code: string | null): { flag: string; code: string; name: string } | null {
  if (!code) return null;
  const c = COUNTRIES.find((x) => x.code === code);
  return c ? { flag: c.flag, code: c.code, name: c.name } : { flag: "", code, name: code };
}

// ── Avatar ─────────────────────────────────────────────────────────────────────

function nameHue(name: string) {
  return name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
}

function StudentAvatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0] ?? "")
    .join("")
    .toUpperCase();
  const hue = nameHue(name);
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold text-white shadow-sm ring-1 ring-inset ring-white/15"
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 58% 50%), hsl(${(hue + 32) % 360} 56% 40%))`,
      }}
      aria-hidden
    >
      {initials}
    </div>
  );
}

// ── Status badges ──────────────────────────────────────────────────────────────

function SubBadge({ status }: { status: string | null }) {
  const t = useTranslations("students");
  if (!status) {
    return <span className="text-muted-foreground/40">—</span>;
  }
  const styles: Record<string, string> = {
    ACTIVE:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
    PAUSED:
      "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
    ENDED:
      "bg-slate-100 text-slate-500 dark:bg-slate-800/40 dark:text-slate-400",
  };
  const dots: Record<string, string> = {
    ACTIVE: "bg-emerald-500 animate-pulse",
    PAUSED: "bg-amber-500",
    ENDED: "bg-slate-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        styles[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      <span
        className={cn("size-1.5 rounded-full", dots[status] ?? "bg-muted-foreground")}
      />
      {t(`subStatus.${status}`)}
    </span>
  );
}

function TrialBadge({ status }: { status: string | null }) {
  const t = useTranslations("students");
  if (status === "TRIAL_BOOKED") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
        <CalendarClock className="size-3" />
        {t("trialBadge.scheduled")}
      </span>
    );
  }
  if (status === "TRIAL") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        <span className="size-1.5 rounded-full bg-amber-500" />
        {t("trialBadge.trial")}
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
}: {
  onNew: () => void;
  onOpen: (id: string, name: string) => void;
  onConfirmEnroll?: (id: string, name: string, teacherId?: string) => void;
  onCancelTrial?: (id: string, name: string) => void;
  refreshToken?: number;
}) {
  const t = useTranslations("students");
  const locale = useLocale();
  const { can, session } = useAuth();
  const isTeacher = session?.role === "TEACHER";
  const [teachers, setTeachers] = useState<TeacherRow[]>([]);

  useEffect(() => {
    void listTeachers({ pageSize: 50, filter: { status: "active" } })
      .then((r) => setTeachers(r.rows))
      .catch(() => setTeachers([]));
  }, []);

  const columns = useMemo<ColumnDef<StudentRow>[]>(
    () => {
      const cols: ColumnDef<StudentRow>[] = [
        {
          key: "name",
          header: t("colName"),
          sortKey: "name",
          render: (r) => (
            <div className="flex items-center gap-3">
              <StudentAvatar name={r.full_name} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{r.full_name}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {!isTeacher && r.is_self_guardian && (
                    <span className="text-muted-foreground text-[10px]">
                      {t("list.selfGuardian")}
                    </span>
                  )}
                  <TrialBadge status={r.status} />
                </div>
              </div>
            </div>
          ),
        },
      ];

      if (!isTeacher) {
        cols.push({
          key: "guardian",
          header: t("colGuardian"),
          render: (r) =>
            r.guardian_name ? (
              <span className="inline-flex items-center gap-1.5 text-sm">
                <UserCircle2
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                {r.guardian_name}
              </span>
            ) : (
              <span className="text-muted-foreground/40">—</span>
            ),
        });
      }

      cols.push(
        {
          key: "teacher",
          header: t("colTeacher"),
          render: (r) =>
            r.teacher_name ? (
              <span className="inline-flex items-center gap-1.5 text-sm">
                <GraduationCap
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                {r.teacher_name}
              </span>
            ) : (
              <span className="text-muted-foreground/40">—</span>
            ),
        },
        {
          key: "status",
          header: t("colStatus"),
          render: (r) => <SubBadge status={r.subscription_status} />,
        },
        {
          key: "country",
          header: t("colCountry"),
          render: (r) => {
            const c = countryCell(r.country);
            return c ? (
              <span
                className="inline-flex items-center gap-1.5 text-sm"
                title={c.name}
              >
                {c.flag ? (
                  <span aria-hidden>{c.flag}</span>
                ) : (
                  <MapPin className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                {c.code}
              </span>
            ) : (
              <span className="text-muted-foreground/40">—</span>
            );
          },
        },
      );

      if (!isTeacher) {
        cols.push(
          {
            key: "whatsapp",
            header: t("colWhatsapp"),
            render: (r) =>
              r.whatsapp_phone ? (
                <span
                  dir="ltr"
                  className="inline-flex items-center gap-1.5 text-sm tabular-nums"
                >
                  <Phone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  {r.whatsapp_phone}
                </span>
              ) : (
                <span className="text-muted-foreground/40">—</span>
              ),
          },
          {
            key: "price",
            header: t("colHourly"),
            sortKey: "price",
            className: "text-end",
            render: (r) =>
              r.price_minor != null && r.price_currency ? (
                <div className="text-end font-medium tabular-nums">
                  {formatMoney(
                    { amount: r.price_minor, currency: r.price_currency },
                    locale,
                  )}
                  <span className="text-muted-foreground ms-0.5 text-[10px] font-normal">
                    {t("subscription.perHourShort")}
                  </span>
                </div>
              ) : (
                <span className="text-muted-foreground/40">—</span>
              ),
          },
        );
      }

      return cols;
    },
    [t, locale, isTeacher],
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
    ],
    [t, teachers],
  );

  const exportColumns = useMemo<ExcelColumn<StudentRow>[]>(() => {
    const cols: ExcelColumn<StudentRow>[] = [
      { header: t("colName"), value: (r) => r.full_name, width: 28 },
    ];
    if (!isTeacher) {
      cols.push({ header: t("colGuardian"), value: (r) => r.guardian_name });
    }
    cols.push(
      { header: t("colTeacher"), value: (r) => r.teacher_name },
      {
        header: t("colStatus"),
        value: (r) =>
          r.subscription_status ? t(`subStatus.${r.subscription_status}`) : "",
      },
      {
        header: t("colCountry"),
        value: (r) => countryCell(r.country)?.name ?? "",
      },
    );
    if (!isTeacher) {
      cols.push(
        { header: t("colWhatsapp"), value: (r) => r.whatsapp_phone },
        {
          header: t("colHourly"),
          value: (r) =>
            r.price_minor != null && r.price_currency
              ? formatMoney(
                  { amount: r.price_minor, currency: r.price_currency },
                  locale,
                )
              : "",
        },
      );
    }
    return cols;
  }, [t, locale, isTeacher]);

  const newButton = can("student.create") ? (
    <Button
      type="button"
      size="default"
      onClick={onNew}
      data-testid="new-student-top"
      className="gap-1.5 shadow-sm shadow-primary/20"
    >
      <Plus className="size-3.5" aria-hidden />
      {t("new")}
    </Button>
  ) : undefined;

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* Card header */}
      <div className="flex items-center justify-between border-b bg-gradient-to-r from-primary/[0.06] via-primary/[0.02] to-transparent px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/15">
            <BookCheck className="size-4 text-primary" aria-hidden />
          </div>
          <div>
            <h2 className="text-sm font-semibold">{t("list.allStudents")}</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t("list.allStudentsSub")}
            </p>
          </div>
        </div>
      </div>

      {/* Table body */}
      <div className="p-4">
        <DataTable<StudentRow>
          testId="students-table"
          fetcher={listStudents}
          columns={columns}
          getRowId={(r) => r.id}
          searchable
          filters={filters}
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
                <div className="flex items-center gap-1.5">
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
              >
                {t("manage")}
              </Button>
            );
          }}
        />
      </div>
    </div>
  );
}
