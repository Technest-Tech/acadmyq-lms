"use client";

import { GraduationCap, Search, UserPlus } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { BoardFilters, useBoardFilterOptions } from "@/components/groups/board/board-filters";
import { apiErrorMessage } from "@/components/groups/group-form";
import { ATTENDANCE_TONE, fieldClass, percent } from "@/components/groups/group-format";
import { AddMembersForm } from "@/components/groups/group-members-panel";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { getGroup, listBoardMembers, type BoardMember, type GroupDetail, type MemberFlag } from "@/lib/groups-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Status = "ACTIVE" | "LEFT" | "ALL";
const FLAGS: MemberFlag[] = ["absent_streak", "low_attendance", "unpaid"];

/**
 * Every student in every group (docs/groups §Screens): where they sit, how often they come, their
 * last marks, and — for money roles — whether this month is paid. The flag chips narrow the list to
 * the students someone should call: an absence streak, a low rate, an unpaid month.
 */
export function StudentsBoard() {
  const t = useTranslations("groups");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("group.manage");
  const canOpenStudent = can("student.read");

  const [status, setStatus] = useState<Status>("ACTIVE");
  const [flag, setFlag] = useState<MemberFlag | "">("");
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [rows, setRows] = useState<BoardMember[]>([]);
  const [seesMoney, setSeesMoney] = useState(false);
  const [streak, setStreak] = useState(3);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const options = useBoardFilterOptions();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listBoardMembers({
        status,
        flag: flag || undefined,
        q: q.trim() || undefined,
        group_id: groupId || undefined,
        teacher_id: teacherId || undefined,
      });
      setRows(res.members);
      setSeesMoney(res.sees_money);
      setStreak(res.thresholds.streak);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("board.loadFailed")));
    } finally {
      setLoading(false);
    }
  }, [status, flag, q, groupId, teacherId, t]);

  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  const flags = FLAGS.filter((f) => f !== "unpaid" || seesMoney);

  return (
    <div className="space-y-5">
      <PageHero
        icon={GraduationCap}
        title={t("board.students.title")}
        subtitle={t("board.students.subtitle")}
        latticeId="groups-students-hero"
        actions={
          <>
            {!loading && <HeroPill>{t("board.students.count", { count: rows.length })}</HeroPill>}
            {canManage && (
              <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setAdding(true)} data-testid="board-add-student">
                <UserPlus className="size-4" />
                {t("board.students.add")}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1">
          <button
            type="button"
            onClick={() => setFlag("")}
            aria-pressed={flag === ""}
            className={cn("shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium", flag === "" ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}
          >
            {t("board.students.flag.all")}
          </button>
          {flags.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFlag(f)}
              aria-pressed={flag === f}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium",
                flag === f ? "border-rose-600 bg-rose-600 text-white" : "border-rose-500/30 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300",
              )}
              data-testid={`board-flag-${f}`}
            >
              {t(`board.students.flag.${f}`, { count: streak })}
            </button>
          ))}
        </div>
        <BoardFilters options={options} groupId={groupId} onGroup={setGroupId} teacherId={teacherId} onTeacher={setTeacherId} />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
        <label className="relative">
          <Search className="text-muted-foreground absolute top-1/2 size-4 -translate-y-1/2 ltr:left-3 rtl:right-3" />
          <input className={cn(fieldClass, "ps-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("board.students.search")} aria-label={t("board.students.search")} />
        </label>
        <select className={cn(fieldClass, "sm:w-44")} value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label={t("board.students.status")}>
          {(["ACTIVE", "LEFT", "ALL"] as Status[]).map((s) => (
            <option key={s} value={s}>
              {t(`board.students.statusOption.${s}`)}
            </option>
          ))}
        </select>
      </div>

      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
      {error && <AlertBanner variant="error" message={error} />}

      {loading && rows.length === 0 ? (
        <p className="text-muted-foreground py-10 text-center text-sm">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">{t(flag ? "board.students.emptyFlag" : "board.students.empty")}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border" data-testid="board-members">
          {rows.map((m) => (
            <li key={m.id} className="grid grid-cols-1 gap-2 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto_auto] md:items-center" data-testid={`board-member-${m.id}`}>
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {canOpenStudent && !m.student_removed ? (
                    <Link href={`/students/${m.student_id}`} className="hover:underline">
                      {m.full_name}
                    </Link>
                  ) : (
                    m.full_name
                  )}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {m.guardian_name ?? ""}
                  {m.status === "LEFT" ? ` · ${t("board.students.leftOn", { date: m.left_on ?? "" })}` : ` · ${t("members.since", { date: m.joined_on })}`}
                </p>
              </div>
              <div className="min-w-0">
                <Link href={`/groups/${m.group_id}`} className="block truncate text-sm font-medium hover:underline">
                  {m.group_name}
                </Link>
                <p className="text-muted-foreground truncate text-xs">{[m.group_level, m.teacher_name].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex gap-0.5" aria-label={t("board.students.recent")}>
                  {[...m.recent].reverse().map((s, i) => (
                    <span key={i} className={cn("size-2.5 rounded-full", ATTENDANCE_TONE[s].on)} title={t(`attendance.${s}`)} />
                  ))}
                </span>
                <span
                  className={cn("text-sm font-semibold tabular-nums", m.attendance.rate !== null && m.attendance.rate < 0.75 && "text-rose-600 dark:text-rose-400")}
                  title={t("members.rateTitle")}
                >
                  {percent(m.attendance.rate)}
                </span>
                {m.absent_streak >= streak && (
                  <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300">
                    {t("board.students.streak", { count: m.absent_streak })}
                  </span>
                )}
              </div>
              {seesMoney && (
                <div className="md:text-end">
                  {m.charge ? (
                    <span className={cn("text-sm font-semibold tabular-nums", m.charge.outstanding_minor > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {m.charge.outstanding_minor > 0
                        ? t("board.students.owes", { amount: formatMoney({ amount: m.charge.outstanding_minor, currency: m.charge.currency }, locale) })
                        : t("board.students.paid")}
                    </span>
                  ) : (
                    <span className="text-muted-foreground text-xs">{t("board.students.noCharge")}</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={adding} onClose={() => setAdding(false)} title={t("board.students.addTitle")} description={t("members.addHint")} size="lg">
        {adding && (
          <AddToGroup
            groups={options.groups}
            onCancel={() => setAdding(false)}
            onSaved={(n) => {
              setAdding(false);
              setNotice(t("members.added", { count: n }));
              void load();
            }}
          />
        )}
      </Modal>
    </div>
  );
}

/** Pick the group first, then the same add-students form the group page uses. */
function AddToGroup({
  groups,
  onCancel,
  onSaved,
}: {
  groups: { id: string; name: string }[];
  onCancel: () => void;
  onSaved: (added: number) => void;
}) {
  const t = useTranslations("groups");
  const [groupId, setGroupId] = useState("");
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) {
      setGroup(null);
      return;
    }
    let live = true;
    void getGroup(groupId)
      .then((res) => live && setGroup(res.group))
      .catch((err) => live && setError(apiErrorMessage(err, t("loadFailed"))));
    return () => {
      live = false;
    };
  }, [groupId, t]);

  return (
    <div className="space-y-4">
      {error && <AlertBanner variant="error" message={error} />}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("board.students.pickGroup")}</span>
        <select className={fieldClass} value={groupId} onChange={(e) => setGroupId(e.target.value)} data-testid="board-add-group">
          <option value="">{t("members.pickGroup")}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      {group && <AddMembersForm key={group.id} group={group} onCancel={onCancel} onSaved={(_g, n) => onSaved(n)} />}
      {!group && (
        <div className="flex justify-end border-t pt-4">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t("form.cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}
