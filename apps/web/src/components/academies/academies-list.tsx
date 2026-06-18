"use client";

import {
  Building2,
  CheckCircle2,
  GraduationCap,
  PauseCircle,
  Plus,
  Search,
  Sparkles,
  UserCog,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import type { AcademyListItem } from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

type StatusFilter = "ALL" | "ACTIVE" | "TRIAL" | "SUSPENDED";

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:
    "bg-emerald-100 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300",
  TRIAL:
    "bg-amber-100 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300",
  SUSPENDED:
    "bg-rose-100 text-rose-700 ring-rose-600/20 dark:bg-rose-950/40 dark:text-rose-300",
};

// A deterministic gradient per academy so avatars feel distinct but stable across reloads.
const AVATAR_GRADIENTS = [
  "from-blue-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-violet-500 to-purple-600",
  "from-amber-500 to-orange-600",
  "from-rose-500 to-pink-600",
  "from-cyan-500 to-sky-600",
];

function avatarGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length]!;
}

function StatCard({
  icon: Icon,
  label,
  value,
  gradient,
  locale,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
  gradient: string;
  locale: string;
}) {
  return (
    <div className="bg-card relative flex items-center gap-3.5 overflow-hidden rounded-2xl border p-4 shadow-sm ring-1 ring-foreground/[0.04]">
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm",
          gradient,
        )}
      >
        <Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tracking-tight tabular-nums">
          {formatNumber(value, locale)}
        </p>
        <p className="text-muted-foreground mt-1 truncate text-xs font-medium">
          {label}
        </p>
      </div>
    </div>
  );
}

/**
 * The Super Admin platform academy list (Sprint 3 §7), fed by the audited
 * app.admin_list_academies(). Premium layout: a hero header, platform KPI cards, live search +
 * status filtering, and a polished roster with avatars, status/plan pills and roll-up counts.
 * Branding (subdomain/logo) is deliberately NOT rendered — it is reserved (R-BRA-1).
 */
export function AcademiesList({
  academies,
  onNew,
  onOpen,
}: {
  academies: AcademyListItem[];
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations("academies");
  const locale = useLocale();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("ALL");

  const stats = useMemo(() => {
    const s = { total: academies.length, ACTIVE: 0, TRIAL: 0, SUSPENDED: 0 };
    for (const a of academies) {
      if (a.status in s) s[a.status as "ACTIVE" | "TRIAL" | "SUSPENDED"] += 1;
    }
    return s;
  }, [academies]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return academies.filter((a) => {
      if (status !== "ALL" && a.status !== status) return false;
      if (q && !a.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [academies, query, status]);

  const STATUS_TABS: StatusFilter[] = ["ALL", "ACTIVE", "TRIAL", "SUSPENDED"];

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="from-primary/[0.10] via-card to-card relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="bg-primary/12 text-primary flex size-11 items-center justify-center rounded-xl">
              <Building2 className="size-5.5" aria-hidden />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
              <p className="text-muted-foreground mt-0.5 text-sm">
                {t("subtitle")}
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={onNew}
            data-testid="new-academy"
            className="shrink-0"
          >
            <Plus className="size-4" aria-hidden />
            {t("new")}
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Building2}
          label={t("statTotal")}
          value={stats.total}
          gradient="bg-gradient-to-br from-blue-500 to-indigo-600"
          locale={locale}
        />
        <StatCard
          icon={CheckCircle2}
          label={t("statActive")}
          value={stats.ACTIVE}
          gradient="bg-gradient-to-br from-emerald-500 to-teal-600"
          locale={locale}
        />
        <StatCard
          icon={Sparkles}
          label={t("statTrial")}
          value={stats.TRIAL}
          gradient="bg-gradient-to-br from-amber-500 to-orange-600"
          locale={locale}
        />
        <StatCard
          icon={PauseCircle}
          label={t("statSuspended")}
          value={stats.SUSPENDED}
          gradient="bg-gradient-to-br from-rose-500 to-pink-600"
          locale={locale}
        />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-xs flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            aria-label={t("searchPlaceholder")}
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-input bg-background w-full rounded-lg border py-2 ps-9 pe-3 text-sm"
          />
        </div>
        <div className="bg-muted/50 flex items-center gap-1 rounded-lg p-1">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                status === s
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`filter-${s}`}
            >
              {s === "ALL" ? t("allStatuses") : t(`status.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Roster */}
      {filtered.length === 0 ? (
        <div className="border-border/60 bg-muted/20 flex flex-col items-center gap-2 rounded-2xl border border-dashed p-16 text-center">
          <Building2 className="text-muted-foreground/50 size-8" aria-hidden />
          <p className="text-sm font-medium">
            {academies.length === 0 ? t("empty") : t("noMatches")}
          </p>
        </div>
      ) : (
        <div className="bg-card overflow-hidden rounded-2xl border shadow-sm ring-1 ring-foreground/[0.04]">
          <table className="w-full text-sm" data-testid="academies-table">
            <thead>
              <tr className="border-b text-xs">
                <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                  {t("colName")}
                </th>
                <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                  {t("colStatus")}
                </th>
                <th className="text-muted-foreground px-4 py-3 text-start font-semibold">
                  {t("colPlan")}
                </th>
                <th className="text-muted-foreground hidden px-4 py-3 text-end font-semibold sm:table-cell">
                  {t("colStudents")}
                </th>
                <th className="text-muted-foreground hidden px-4 py-3 text-end font-semibold sm:table-cell">
                  {t("colTeachers")}
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((a) => (
                <tr
                  key={a.id}
                  data-academy={a.id}
                  className="hover:bg-muted/30 group cursor-pointer transition-colors"
                  onClick={() => onOpen(a.id)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-sm font-bold text-white shadow-sm",
                          avatarGradient(a.id),
                        )}
                        aria-hidden
                      >
                        {a.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{a.name}</p>
                        {/* Branding (subdomain/logo) is reserved — never surfaced (R-BRA-1). */}
                        <p className="text-muted-foreground truncate text-xs">
                          {a.default_currency}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3" data-status={a.status}>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
                        STATUS_STYLE[a.status] ?? "bg-muted",
                      )}
                    >
                      {t(`status.${a.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {a.plan_code ? (
                      <span className="bg-primary/10 text-primary inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide">
                        {a.plan_code}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-end sm:table-cell">
                    <span className="text-muted-foreground inline-flex items-center justify-end gap-1.5 tabular-nums">
                      <GraduationCap className="size-3.5" aria-hidden />
                      {formatNumber(a.student_count, locale)}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-end sm:table-cell">
                    <span className="text-muted-foreground inline-flex items-center justify-end gap-1.5 tabular-nums">
                      <UserCog className="size-3.5" aria-hidden />
                      {formatNumber(a.teacher_count, locale)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(a.id);
                      }}
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      {t("manage")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
