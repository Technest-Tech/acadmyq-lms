"use client";

import { CalendarX2, PhoneCall, TrendingDown, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { PASTEL, type PastelTone, PersonAvatar, SectionCard, SoftBadge } from "@/components/groups/group-look";
import { AlertBanner } from "@/components/ui/alert";
import { type BoardMember, listBoardMembers, type MemberFlag } from "@/lib/groups-api";
import { formatMoney, formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

const FLAG_LOOK: Record<MemberFlag, { Icon: typeof CalendarX2; tone: PastelTone }> = {
  absent_streak: { Icon: CalendarX2, tone: "rose" },
  low_attendance: { Icon: TrendingDown, tone: "amber" },
  unpaid: { Icon: Wallet, tone: "violet" },
};

/**
 * A learning centre's call list on its Students page: every group member worth a phone call today —
 * an absence streak, a low attendance rate, an unpaid month. It is what the separate "group students"
 * board was for; a centre, whose every student sits in a group, reads it here instead of on a page of
 * its own. One load of the groups' member board, cut three ways with the server's own thresholds.
 */
export function FollowUpCard({ onOpen, refreshToken }: { onOpen: (id: string, name: string) => void; refreshToken?: number }) {
  const t = useTranslations("students.followUp");
  const locale = useLocale();
  const { can } = useAuth();
  const canOpen = can("student.read");

  const [members, setMembers] = useState<BoardMember[]>([]);
  const [thresholds, setThresholds] = useState({ streak: 3, low_rate: 0.75 });
  const [seesMoney, setSeesMoney] = useState(false);
  const [flag, setFlag] = useState<MemberFlag | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void listBoardMembers({ status: "ACTIVE" })
      .then((res) => {
        if (!alive) return;
        setMembers(res.members);
        setThresholds(res.thresholds);
        setSeesMoney(res.sees_money);
        setError(null);
      })
      .catch((err) => alive && setError(apiErrorMessage(err, t("loadFailed"))))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [refreshToken, t]);

  const lists = useMemo<Record<MemberFlag, BoardMember[]>>(
    () => ({
      absent_streak: members.filter((m) => m.absent_streak >= thresholds.streak),
      low_attendance: members.filter((m) => m.attendance.rate !== null && m.attendance.rate < thresholds.low_rate),
      unpaid: members.filter((m) => (m.charge?.outstanding_minor ?? 0) > 0),
    }),
    [members, thresholds],
  );
  const flags = (Object.keys(FLAG_LOOK) as MemberFlag[]).filter((f) => f !== "unpaid" || seesMoney);
  const total = flags.reduce((sum, f) => sum + lists[f].length, 0);
  const rows = flag ? lists[flag] : [];

  return (
    <SectionCard icon={PhoneCall} tone="rose" title={t("title")} hint={t("hint")} count={loading ? undefined : total} testId="follow-up-card">
      {error && <AlertBanner variant="error" message={error} className="mb-3" />}
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {flags.map((f) => {
          const { Icon, tone } = FLAG_LOOK[f];
          const selected = flag === f;
          return (
            <button
              key={f}
              type="button"
              aria-pressed={selected}
              onClick={() => setFlag(selected ? null : f)}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold transition-colors",
                selected ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-primary/40",
              )}
              data-testid={`follow-up-${f}`}
            >
              <span className={cn("flex size-7 items-center justify-center rounded-lg", selected ? "bg-white/20" : PASTEL[tone])}>
                <Icon className="size-4" aria-hidden />
              </span>
              {t(f)}
              <span className={cn("rounded-full px-2 py-0.5 text-xs tabular-nums", selected ? "bg-white/20" : "bg-muted")}>
                {loading ? "…" : formatNumber(lists[f].length, locale)}
              </span>
            </button>
          );
        })}
      </div>

      {flag && (
        <ul className="mt-3 divide-y rounded-xl border" data-testid="follow-up-list">
          {rows.length === 0 && <li className="text-muted-foreground px-4 py-6 text-center text-sm">{t("empty")}</li>}
          {rows.map((m) => {
            const detail =
              flag === "absent_streak"
                ? t("streak", { count: m.absent_streak })
                : flag === "low_attendance"
                  ? t("rate", { rate: formatNumber(Math.round((m.attendance.rate ?? 0) * 100), locale) })
                  : m.charge
                    ? t("owes", { amount: formatMoney({ amount: m.charge.outstanding_minor, currency: m.charge.currency }, locale) })
                    : "";
            const body = (
              <>
                <PersonAvatar name={m.full_name} className="size-9" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{m.full_name}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {m.group_name}
                    {m.guardian_name ? ` · ${m.guardian_name}` : ""}
                  </p>
                </div>
                <SoftBadge tone={FLAG_LOOK[flag].tone} className="shrink-0">
                  {detail}
                </SoftBadge>
              </>
            );
            return (
              <li key={m.id}>
                {canOpen ? (
                  <button type="button" onClick={() => onOpen(m.student_id, m.full_name)} className="hover:bg-muted/50 flex w-full items-center gap-3 px-3 py-2.5 text-start">
                    {body}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 px-3 py-2.5">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
