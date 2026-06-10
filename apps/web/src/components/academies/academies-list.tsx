"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { AcademyListItem } from "@/lib/api";

/**
 * The Super Admin platform academy list (Sprint 3 §7), fed by the audited
 * app.admin_list_academies(). Shows status, plan, currency, and student/teacher counts.
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Button
          type="button"
          size="sm"
          onClick={onNew}
          data-testid="new-academy"
        >
          {t("new")}
        </Button>
      </div>

      {academies.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm" data-testid="academies-table">
            <thead className="bg-muted/50 text-muted-foreground text-start">
              <tr>
                <th className="px-3 py-2 text-start">{t("colName")}</th>
                <th className="px-3 py-2 text-start">{t("colStatus")}</th>
                <th className="px-3 py-2 text-start">{t("colPlan")}</th>
                <th className="px-3 py-2 text-start">{t("colCurrency")}</th>
                <th className="px-3 py-2 text-start">{t("colStudents")}</th>
                <th className="px-3 py-2 text-start">{t("colTeachers")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {academies.map((a) => (
                <tr key={a.id} data-academy={a.id}>
                  <td className="px-3 py-2 font-medium">{a.name}</td>
                  <td className="px-3 py-2" data-status={a.status}>
                    {t(`status.${a.status}`)}
                  </td>
                  <td className="px-3 py-2">{a.plan_code ?? "—"}</td>
                  <td className="px-3 py-2">{a.default_currency}</td>
                  <td className="px-3 py-2">{a.student_count}</td>
                  <td className="px-3 py-2">{a.teacher_count}</td>
                  <td className="px-3 py-2 text-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      onClick={() => onOpen(a.id)}
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
