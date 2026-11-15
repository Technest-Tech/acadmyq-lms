"use client";

import { ArrowLeftRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { HandoverForm, useHandoverCountLine } from "@/components/staff/staff-handover-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { listHandoverOwners, type HandoverCounts, type HandoverOwner } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATE_TONE: Record<HandoverOwner["state"], string> = {
  gone: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  inactive: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  nobody: "bg-muted text-muted-foreground",
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

/**
 * The staff page's "Hand over" list: everyone who answers for students, teachers or parents —
 * supervisors who were deleted or switched off first, then the records nobody added, then the
 * active team — each with how many, and a hand-over from any of them. A deleted supervisor has no
 * staff page to open, so this is the one place their people can be moved from.
 */
export function TeamHandoverModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("staff.handover");
  const countLine = useHandoverCountLine();
  const [owners, setOwners] = useState<HandoverOwner[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState<HandoverOwner | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listHandoverOwners()
      .then((r) => setOwners(r.owners))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!open) return;
    setFrom(null);
    setDone(null);
    setOwners(null);
    load();
  }, [open, load]);

  const nameOf = (o: HandoverOwner) => (o.state === "nobody" ? t("nobody") : (o.name ?? t("noName")));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={from ? t("modalTitle", { name: nameOf(from) }) : t("listTitle")}
      description={from ? countLine(from.counts) : t("listHint")}
      size="md"
    >
      {from ? (
        <HandoverForm
          fromUserId={from.user_id ?? "none"}
          counts={from.counts}
          onCancel={() => setFrom(null)}
          onDone={(toName: string, moved: HandoverCounts) => {
            setDone(t("done", { name: toName, what: countLine(moved) }));
            setFrom(null);
            load();
          }}
        />
      ) : (
        <div className="space-y-3" data-testid="team-handover-list">
          {done && <AlertBanner variant="success" message={done} onDismiss={() => setDone(null)} />}
          {error && <AlertBanner variant="error" message={error} />}
          {owners === null && !error ? (
            <div className="space-y-2" aria-hidden>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-muted h-14 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : owners !== null && owners.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("listEmpty")}</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {(owners ?? []).map((o) => (
                <li
                  key={o.user_id ?? "none"}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  data-testid="team-handover-row"
                  data-state={o.state}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{nameOf(o)}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", STATE_TONE[o.state])}>
                        {t(`state.${o.state}`)}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">{countLine(o.counts)}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={o.state === "active" ? "outline" : "default"}
                    className="shrink-0 gap-1.5"
                    onClick={() => setFrom(o)}
                    data-testid="team-handover-pick"
                  >
                    <ArrowLeftRight className="size-3.5" aria-hidden />
                    {t("action")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
