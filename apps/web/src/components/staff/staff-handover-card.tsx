"use client";

import { ArrowLeftRight, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { actorLabel, useTeamActors } from "@/components/team/done-by";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ProfileCard } from "@/components/ui/profile-card";
import {
  ApiError,
  getHandoverCounts,
  handOverSupervision,
  type HandoverCounts,
  type HandoverType,
} from "@/lib/api";

export const HANDOVER_TYPES: HandoverType[] = ["student", "teacher", "guardian"];

/** "3 students · 10 teachers · no parents" — the counts read the way the card and the list say them. */
export function useHandoverCountLine(): (c: HandoverCounts) => string {
  const t = useTranslations("staff.handover");
  return (c) => HANDOVER_TYPES.map((type) => t(`count.${type}`, { count: c[type] })).join(" · ");
}

/**
 * The handover itself: who takes them, and which kinds. The body of the staff page's dialog and of
 * the academy-wide list's second step — never a modal of its own, so the list never stacks two.
 * `fromUserId` is a login (on the team or not) or "none" for records nobody added.
 */
export function HandoverForm({
  fromUserId,
  counts,
  onCancel,
  onDone,
}: {
  fromUserId: string;
  counts: HandoverCounts;
  onCancel: () => void;
  onDone: (toName: string, moved: HandoverCounts) => void;
}) {
  const t = useTranslations("staff.handover");
  const tDone = useTranslations("doneBy");
  const actors = useTeamActors();
  const [toUserId, setToUserId] = useState("");
  const [types, setTypes] = useState<Set<HandoverType>>(() => new Set(HANDOVER_TYPES));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Who can take them: an active member of the team other than the one handing over.
  const targets = useMemo(() => actors.filter((a) => a.is_active && a.id !== fromUserId), [actors, fromUserId]);
  const picked = HANDOVER_TYPES.filter((type) => types.has(type) && counts[type] > 0);

  async function submit() {
    if (!toUserId || picked.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await handOverSupervision(fromUserId, toUserId, picked);
      onDone(targets.find((a) => a.id === toUserId)?.name ?? "", res.moved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1.5">
        <label htmlFor={`handover-to-${fromUserId}`} className="text-xs font-medium">
          {t("to")}
        </label>
        <select
          id={`handover-to-${fromUserId}`}
          data-testid="handover-to"
          value={toUserId}
          onChange={(e) => setToUserId(e.target.value)}
          className="border-input bg-background h-10 w-full rounded-xl border px-3 text-sm outline-none focus:border-primary focus:ring-3 focus:ring-primary/15"
        >
          <option value="">{t("toPlaceholder")}</option>
          {targets.map((a) => (
            <option key={a.id} value={a.id}>
              {actorLabel(a, tDone("off"))}
            </option>
          ))}
        </select>
        {targets.length === 0 && <p className="text-muted-foreground text-xs">{t("noTargets")}</p>}
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium">{t("what")}</legend>
        {HANDOVER_TYPES.map((type) => {
          const n = counts[type];
          return (
            <label key={type} className="flex items-center gap-2.5">
              <input
                type="checkbox"
                data-testid={`handover-type-${type}`}
                checked={types.has(type) && n > 0}
                disabled={n === 0}
                onChange={() =>
                  setTypes((prev) => {
                    const next = new Set(prev);
                    if (next.has(type)) next.delete(type);
                    else next.add(type);
                    return next;
                  })
                }
                className="accent-primary size-4"
              />
              <span className={n === 0 ? "text-muted-foreground" : undefined}>{t(`count.${type}`, { count: n })}</span>
            </label>
          );
        })}
      </fieldset>

      <p className="text-muted-foreground text-xs">{t("note")}</p>
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !toUserId || picked.length === 0}
          className="gap-1.5"
          data-testid="handover-confirm"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t("confirm")}
        </Button>
      </div>
    </div>
  );
}

/**
 * "Hand over to another supervisor" on a staff member's page: the students, teachers and parents
 * this login answers for (added, or handed to them before), and one action — give them to someone
 * else on the team. Afterwards the lists name the new supervisor and their "My lessons" carries
 * those students. Nothing else moves: the teachers' logins, the lessons, the history.
 *
 * Shown to whoever runs the team (staff.update) for any member with a login, switched off or not —
 * a supervisor who left is exactly the case. The staff page's "Hand over" list reaches the ones
 * whose role or account is gone too.
 */
export function StaffHandoverCard({ userId, name }: { userId: string; name: string }) {
  const t = useTranslations("staff.handover");
  const countLine = useHandoverCountLine();

  const [counts, setCounts] = useState<HandoverCounts | null>(null);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ name: string; moved: HandoverCounts } | null>(null);

  const load = useCallback(() => {
    getHandoverCounts(userId)
      .then((r) => setCounts(r.counts))
      .catch(() => setCounts({ student: 0, teacher: 0, guardian: 0 }));
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const total = counts ? counts.student + counts.teacher + counts.guardian : 0;

  return (
    <ProfileCard
      icon={ArrowLeftRight}
      title={t("title")}
      description={t("hint", { name })}
      tone="violet"
      testId="staff-handover"
      action={
        total > 0 ? (
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)} data-testid="handover-open">
            <ArrowLeftRight className="size-3.5" aria-hidden />
            {t("action")}
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3 text-sm">
        {done && (
          <AlertBanner
            variant="success"
            message={t("done", { name: done.name, what: countLine(done.moved) })}
            onDismiss={() => setDone(null)}
          />
        )}
        {counts === null ? (
          <div className="bg-muted h-4 w-48 animate-pulse rounded" aria-hidden />
        ) : total === 0 ? (
          <p className="text-muted-foreground" data-testid="handover-none">{t("none")}</p>
        ) : (
          <p className="font-medium" data-testid="handover-counts">{countLine(counts)}</p>
        )}
      </div>

      <Modal open={open && counts !== null} onClose={() => setOpen(false)} title={t("modalTitle", { name })} size="sm">
        {counts !== null && (
          <HandoverForm
            fromUserId={userId}
            counts={counts}
            onCancel={() => setOpen(false)}
            onDone={(toName, moved) => {
              setDone({ name: toName, moved });
              setOpen(false);
              load();
            }}
          />
        )}
      </Modal>
    </ProfileCard>
  );
}
