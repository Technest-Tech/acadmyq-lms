"use client";

import { BarChart3, Banknote, Briefcase, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import {
  type AreaLevel,
  applyLevel,
  codesOf,
  levelOf,
  levelsOf,
} from "@/components/team/role-areas";
import type { AcademyRoleArea } from "@/lib/api";
import { cn } from "@/lib/utils";

const KINDS = [
  {
    kind: "operations",
    icon: Briefcase,
    tone: "text-primary bg-primary/10 ring-primary/15",
  },
  {
    kind: "financial",
    icon: Banknote,
    tone: "text-amber-700 bg-amber-100 ring-amber-200 dark:text-amber-300 dark:bg-amber-950/50 dark:ring-amber-900",
  },
  {
    kind: "statistics",
    icon: BarChart3,
    tone: "text-violet-700 bg-violet-100 ring-violet-200 dark:text-violet-300 dark:bg-violet-950/50 dark:ring-violet-900",
  },
] as const;

/**
 * The role builder as a table of the academy's sections — Students, Lessons, Invoices… — each set
 * to None / View / Manage, instead of eighty checkboxes named after capability codes. Money and
 * statistics are their own blocks, so handing either over is a visible decision. Any row expands
 * to its individual capabilities for the owner who wants "manage lessons, but not cancel them".
 */
export function RoleBuilder({
  areas,
  value,
  onChange,
}: {
  areas: readonly AcademyRoleArea[];
  value: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
}) {
  const t = useTranslations("academyRoles");
  const tp = useTranslations("permissions");
  const [open, setOpen] = useState<Set<string>>(new Set());

  const permLabel = (code: string) => {
    const k = `items.${code.replace(/\./g, "_")}.label`;
    return tp.has(k) ? tp(k) : code;
  };
  const permDesc = (code: string) => {
    const k = `items.${code.replace(/\./g, "_")}.desc`;
    return tp.has(k) ? tp(k) : "";
  };
  const areaLabel = (key: string) =>
    t.has(`areas.${key}.label`)
      ? t(`areas.${key}.label`)
      : t("areas.other.label");
  const areaHint = (key: string) =>
    t.has(`areas.${key}.hint`) ? t(`areas.${key}.hint`) : "";

  const byKind = useMemo(
    () =>
      KINDS.map((k) => ({
        ...k,
        areas: areas.filter((a) => a.kind === k.kind),
      })),
    [areas],
  );

  function toggleOpen(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleCode(code: string) {
    const next = new Set(value);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange(next);
  }

  const levelLabel = (
    area: AcademyRoleArea,
    level: Exclude<AreaLevel, "partial">,
  ) => {
    if (level === "none") return t("builder.levels.none");
    if (level === "view") return t("builder.levels.view");
    // A section that is just a switch (no View half) reads "Allowed", not "Manage".
    return area.view.length === 0
      ? t("builder.levels.allowed")
      : t("builder.levels.manage");
  };

  return (
    <div className="space-y-4" data-testid="role-builder">
      {byKind.map(({ kind, icon: Icon, tone, areas: rows }) =>
        rows.length === 0 ? null : (
          <section
            key={kind}
            className="space-y-2"
            data-testid={`builder-kind-${kind}`}
          >
            <div className="flex items-start gap-2.5">
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg ring-1",
                  tone,
                )}
              >
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">
                  {t(`builder.kinds.${kind}.title`)}
                </p>
                <p className="text-muted-foreground text-xs leading-snug">
                  {t(`builder.kinds.${kind}.hint`)}
                </p>
              </div>
            </div>

            <div
              className={cn(
                "divide-y overflow-hidden rounded-xl border",
                kind === "financial" &&
                  "border-amber-200 dark:border-amber-900/60",
                kind === "statistics" &&
                  "border-violet-200 dark:border-violet-900/60",
              )}
            >
              {rows.map((area) => {
                const level = levelOf(area, value);
                const expanded = open.has(area.key) || level === "partial";
                return (
                  <div key={area.key} data-testid={`area-${area.key}`}>
                    <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <button
                        type="button"
                        onClick={() => toggleOpen(area.key)}
                        className="flex min-w-0 items-start gap-1.5 text-start"
                        aria-expanded={expanded}
                        data-testid={`expand-${area.key}`}
                      >
                        <ChevronDown
                          className={cn(
                            "text-muted-foreground mt-0.5 size-4 shrink-0 transition-transform",
                            expanded ? "rotate-0" : "-rotate-90 rtl:rotate-90",
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium leading-tight">
                            {areaLabel(area.key)}
                            {level === "partial" && (
                              <span
                                className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                data-testid={`partial-${area.key}`}
                              >
                                {t("builder.partial")}
                              </span>
                            )}
                          </span>
                          {areaHint(area.key) && (
                            <span className="text-muted-foreground block text-xs leading-snug">
                              {areaHint(area.key)}
                            </span>
                          )}
                        </span>
                      </button>

                      <div
                        role="radiogroup"
                        aria-label={areaLabel(area.key)}
                        className="bg-muted/60 inline-flex shrink-0 self-start rounded-lg p-0.5 sm:self-auto"
                      >
                        {levelsOf(area).map((opt) => {
                          const on = level === opt;
                          return (
                            <button
                              key={opt}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              onClick={() =>
                                onChange(applyLevel(area, value, opt))
                              }
                              data-testid={`level-${area.key}-${opt}`}
                              className={cn(
                                "min-w-12 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors",
                                on
                                  ? opt === "none"
                                    ? "bg-card text-foreground shadow-sm"
                                    : kind === "financial"
                                      ? "bg-amber-500 text-white shadow-sm"
                                      : kind === "statistics"
                                        ? "bg-violet-500 text-white shadow-sm"
                                        : "bg-primary text-primary-foreground shadow-sm"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {levelLabel(area, opt)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {expanded && (
                      <div className="bg-muted/25 space-y-0.5 border-t px-3 py-2">
                        {codesOf(area).map((code) => (
                          <label
                            key={code}
                            className="hover:bg-muted/40 flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-1.5"
                            title={code}
                          >
                            <input
                              type="checkbox"
                              checked={value.has(code)}
                              onChange={() => toggleCode(code)}
                              className="border-input accent-primary mt-0.5 size-4 rounded"
                              data-testid={`perm-${code}`}
                            />
                            <span className="min-w-0">
                              <span className="block text-sm leading-tight">
                                {permLabel(code)}
                              </span>
                              {permDesc(code) && (
                                <span className="text-muted-foreground block text-xs leading-snug">
                                  {permDesc(code)}
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ),
      )}
    </div>
  );
}

/**
 * A role read back as sections — "Students · Manage", "Invoices · View" — for the role cards, the
 * details modal and the member form. Money and statistics lines are tinted so they stand out.
 */
export function RoleSummary({
  areas,
  permissions,
  limit,
}: {
  areas: readonly AcademyRoleArea[];
  permissions: readonly string[];
  /** Show at most this many lines, then "+N". */
  limit?: number;
}) {
  const t = useTranslations("academyRoles");
  const held = new Set(permissions);
  const rows = areas
    .map((area) => ({ area, level: levelOf(area, held) }))
    .filter((r) => r.level !== "none");

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-xs">{t("noFeatures")}</p>;
  }

  const shown = limit !== undefined ? rows.slice(0, limit) : rows;
  const label = (key: string) =>
    t.has(`areas.${key}.label`)
      ? t(`areas.${key}.label`)
      : t("areas.other.label");
  const levelText = (area: AcademyRoleArea, level: AreaLevel) =>
    level === "partial"
      ? t("builder.partial")
      : level === "view"
        ? t("builder.levels.view")
        : area.view.length === 0
          ? t("builder.levels.allowed")
          : t("builder.levels.manage");

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="role-summary">
      {shown.map(({ area, level }) => (
        <span
          key={area.key}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
            area.kind === "financial"
              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
              : area.kind === "statistics"
                ? "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300"
                : "bg-primary/8 text-primary",
          )}
        >
          {label(area.key)}
          <span className="opacity-70">· {levelText(area, level)}</span>
        </span>
      ))}
      {limit !== undefined && rows.length > limit && (
        <span className="text-muted-foreground px-1 py-0.5 text-xs">
          +{rows.length - limit}
        </span>
      )}
    </div>
  );
}

/** Whether a role reaches any money / statistics section — the two facts an owner checks first. */
export function roleReaches(
  areas: readonly AcademyRoleArea[],
  permissions: readonly string[],
  kind: AcademyRoleArea["kind"],
): boolean {
  const held = new Set(permissions);
  return areas.some((a) => a.kind === kind && levelOf(a, held) !== "none");
}
