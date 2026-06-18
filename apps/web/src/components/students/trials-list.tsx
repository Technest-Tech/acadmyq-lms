"use client";

import { CalendarClock, GraduationCap, Sparkles, UserCheck, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { type ColumnDef, DataTable } from "@/components/ui/data-table";
import { listStudents, type DataTableQuery, type StudentRow } from "@/lib/api";
import { cn } from "@/lib/utils";

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

// ── Trial status badge ─────────────────────────────────────────────────────────

function TrialBadge({ status }: { status: string | null }) {
  const t = useTranslations("students");
  if (status === "TRIAL_BOOKED") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
        <CalendarClock className="size-3" />
        {t("trialBadge.scheduled")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
      <span className="size-1.5 rounded-full bg-amber-500" />
      {t("trialBadge.awaiting")}
    </span>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export function TrialsList({
  refreshToken,
  onScheduleTrial,
  onConfirmEnroll,
  onOpen,
}: {
  refreshToken?: number;
  onScheduleTrial: (id: string, name: string, teacherId?: string) => void;
  onConfirmEnroll: (id: string, name: string, teacherId?: string) => void;
  onOpen: (id: string, name: string) => void;
}) {
  const t = useTranslations("students");
  const fetcher = useCallback(
    (q: DataTableQuery) =>
      listStudents({ ...q, filter: { ...q?.filter, trial_any: "1" } }),
    [],
  );

  const columns = useMemo<ColumnDef<StudentRow>[]>(
    () => [
      {
        key: "name",
        header: t("list.colStudent"),
        sortKey: "name",
        render: (r) => (
          <div className="flex items-center gap-3">
            <StudentAvatar name={r.full_name} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{r.full_name}</div>
              {r.is_self_guardian && (
                <div className="text-muted-foreground text-[10px]">
                  {t("list.selfGuardian")}
                </div>
              )}
            </div>
          </div>
        ),
      },
      {
        key: "guardian",
        header: t("colGuardian"),
        render: (r) =>
          r.guardian_name ? (
            <span className="text-sm text-muted-foreground">{r.guardian_name}</span>
          ) : (
            <span className="text-muted-foreground/40 text-sm">—</span>
          ),
      },
      {
        key: "teacher",
        header: t("colTeacher"),
        render: (r) =>
          r.teacher_name ? (
            <div className="flex items-center gap-1.5 text-sm">
              <GraduationCap className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              {r.teacher_name}
            </div>
          ) : (
            <span className="text-muted-foreground/40 text-sm">—</span>
          ),
      },
      {
        key: "trial_status",
        header: t("list.colTrialStatus"),
        render: (r) => <TrialBadge status={r.status} />,
      },
    ],
    [t],
  );

  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-gradient-to-r from-amber-500/[0.1] via-amber-500/[0.04] to-transparent px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/10 ring-1 ring-amber-500/20">
            <Sparkles className="size-4 text-amber-500" aria-hidden />
          </div>
          <div>
            <h2 className="text-sm font-semibold">{t("list.trialStudents")}</h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              {t("list.trialStudentsSub")}
            </p>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="p-4">
        <DataTable<StudentRow>
          testId="trials-table"
          fetcher={fetcher}
          columns={columns}
          getRowId={(r) => r.id}
          searchable
          defaultSort="name"
          emptyMessage={t("list.emptyTrials")}
          refreshToken={refreshToken}
          onRowClick={(r) => onOpen(r.id, r.full_name)}
          rowActions={(r) =>
            r.status === "TRIAL" ? (
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onScheduleTrial(r.id, r.full_name, r.teacher_id ?? undefined);
                  }}
                  className={cn(
                    "gap-1 border-transparent bg-amber-500 text-white",
                    "hover:bg-amber-600 focus-visible:ring-amber-500/40",
                  )}
                >
                  <Zap className="size-3" />
                  {t("actions.scheduleTrial")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(r.id, r.full_name);
                  }}
                >
                  {t("actions.view")}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfirmEnroll(r.id, r.full_name, r.teacher_id ?? undefined);
                  }}
                  className="gap-1 bg-emerald-600 border-transparent text-white hover:bg-emerald-700 focus-visible:ring-emerald-500/40"
                >
                  <UserCheck className="size-3" />
                  {t("actions.confirm")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(r.id, r.full_name);
                  }}
                >
                  {t("actions.view")}
                </Button>
              </div>
            )
          }
        />
      </div>
    </div>
  );
}
