"use client";

import { GraduationCap } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { apiErrorMessage } from "@/components/groups/group-form";
import { PASTEL } from "@/components/groups/group-look";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useModernLook } from "@/lib/capabilities";
import { type FormerStudentRow, type GroupDetail, getFormerStudents, makeFormerStudents } from "@/lib/groups-api";
import { cn } from "@/lib/utils";

/**
 * A finished course's students become former students (`course_students`, Ana Muslim 2026-11-21).
 * Shown on a FINISHED or ARCHIVED group to whoever may manage groups and deactivate students. It
 * lists who moves and who stays (another running group, private lessons, already gone), and moving
 * them is the same as pressing "deactivate" on each: reason "graduated", every record and what they
 * owe kept, and "reactivate" on their page brings them back. Hidden once nobody is left to move.
 */
export function FormerStudentsPanel({ group, onDone }: { group: GroupDetail; onDone: (count: number) => void }) {
  const t = useTranslations("groups.formerStudents");
  const look = useModernLook();
  const [rows, setRows] = useState<FormerStudentRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getFormerStudents(group.id)
      .then((r) => live && setRows(r.students))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [group.id, group.status]);

  const moving = (rows ?? []).filter((r) => r.outcome === "GRADUATE");
  const staying = (rows ?? []).filter((r) => r.outcome !== "GRADUATE" && r.outcome !== "ALREADY_FORMER");
  if (moving.length === 0) return null;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const res = await makeFormerStudents(group.id);
      setRows(res.students);
      setOpen(false);
      onDone(res.graduated);
    } catch (err) {
      setError(apiErrorMessage(err, t("failed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cn("bg-card rounded-2xl border p-4", look && "centre-surface")} data-testid="former-students-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className={cn("min-w-0", look && "flex items-center gap-3")}>
          {look && (
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", PASTEL.indigo)}>
              <GraduationCap className="size-5" aria-hidden />
            </span>
          )}
          <div className="min-w-0">
            <p className={cn("flex items-center gap-1.5 font-semibold", look && "text-base font-extrabold")}>
              {!look && <GraduationCap className="text-muted-foreground size-4" aria-hidden />}
              {t("title")}
            </p>
            <p className={cn("text-muted-foreground mt-0.5 text-sm", look && "text-xs")}>{t("subtitle", { count: moving.length })}</p>
          </div>
        </div>
        <Button type="button" size="sm" className="shrink-0 gap-1.5" onClick={() => setOpen(true)} data-testid="former-students-open">
          <GraduationCap className="size-3.5" />
          {t("open")}
        </Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={t("modalTitle")} description={t("modalSubtitle")}>
        <div className="space-y-4">
          {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">{t("moving", { count: moving.length })}</p>
            <ul className="divide-y rounded-lg border" data-testid="former-students-moving">
              {moving.map((r) => (
                <li key={r.id} className="px-3 py-2 text-sm">
                  {r.full_name}
                </li>
              ))}
            </ul>
          </div>
          {staying.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-sm font-semibold">{t("staying", { count: staying.length })}</p>
              <ul className="divide-y rounded-lg border" data-testid="former-students-staying">
                {staying.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span>{r.full_name}</span>
                    <span className="text-muted-foreground text-xs">{t(`reason.${r.outcome}`)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-muted-foreground text-xs">{t("kept")}</p>
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button type="button" size="sm" onClick={() => void apply()} disabled={busy} data-testid="former-students-apply">
              {busy ? <span className="size-3.5 animate-spin rounded-full border border-current border-t-transparent" /> : null}
              {t("apply", { count: moving.length })}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
