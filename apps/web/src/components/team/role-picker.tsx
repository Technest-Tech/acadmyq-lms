"use client";

import { Banknote, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { RoleSummary, roleReaches } from "@/components/team/role-builder";
import type { AcademyRoleArea, AcademyRoleSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Picking what a new team member can do: the shared built-in roles and the academy's own, as cards
 * that say in one line what each is for and whether it reaches money — then, under the grid, the
 * chosen role read back as sections. Replaces a dropdown of role names and a cloud of code labels.
 */
export function RolePicker({
  roles,
  areas,
  value,
  onChange,
}: {
  roles: readonly AcademyRoleSummary[];
  areas: readonly AcademyRoleArea[];
  value: string;
  onChange: (code: string) => void;
}) {
  const t = useTranslations("academyRoles");
  const selected = roles.find((r) => r.code === value) ?? null;

  const label = (r: AcademyRoleSummary) =>
    r.system
      ? t.has(`role.${r.code}`)
        ? t(`role.${r.code}`)
        : r.code
      : r.name;
  const hint = (r: AcademyRoleSummary) =>
    r.system
      ? t.has(`systemRoleHint.${r.code}`)
        ? t(`systemRoleHint.${r.code}`)
        : ""
      : (r.description ?? "");

  return (
    <div className="space-y-3">
      <div
        role="radiogroup"
        aria-label={t("pickRole")}
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
      >
        {roles.map((r) => {
          const on = r.code === value;
          const money =
            areas.length > 0 && roleReaches(areas, r.permissions, "financial");
          return (
            <button
              key={r.code}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(r.code)}
              data-testid={`role-option-${r.code}`}
              className={cn(
                "flex items-start gap-2.5 rounded-xl border p-3 text-start transition-colors",
                on
                  ? "border-primary bg-primary/5 ring-primary/20 ring-2"
                  : "hover:border-primary/40 hover:bg-muted/30",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input",
                )}
                aria-hidden
              >
                {on && <Check className="size-3" />}
              </span>
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold leading-tight">
                  {label(r)}
                  {money && (
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                      <Banknote className="size-2.5" aria-hidden />{" "}
                      {t("seesMoney")}
                    </span>
                  )}
                </span>
                {hint(r) && (
                  <span className="text-muted-foreground mt-0.5 block text-xs leading-snug">
                    {hint(r)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {selected && areas.length > 0 && (
        <div
          className="bg-background rounded-xl border p-3"
          data-testid="role-picker-summary"
        >
          <p className="mb-2 text-xs font-semibold">
            {t("whatTheyGet", { role: label(selected) })}
          </p>
          <RoleSummary areas={areas} permissions={selected.permissions} />
        </div>
      )}
    </div>
  );
}
