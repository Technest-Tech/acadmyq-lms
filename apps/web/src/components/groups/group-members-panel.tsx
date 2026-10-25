"use client";

import { ArrowRightLeft, ChevronDown, Tag, UserMinus, UserPlus } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fromMinor, toMinor } from "@/components/groups/group-form";
import { fieldClass, hoursText, percent, todayIn } from "@/components/groups/group-format";
import { StudentPicker } from "@/components/groups/student-picker";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  addGroupMembers,
  listGroups,
  moveGroupMember,
  removeGroupMember,
  updateGroupMember,
  type GroupDetail,
  type GroupMember,
  type GroupRow,
} from "@/lib/groups-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type ModalState =
  | { kind: "closed" }
  | { kind: "add" }
  | { kind: "remove"; member: GroupMember }
  | { kind: "move"; member: GroupMember }
  | { kind: "price"; member: GroupMember };

/**
 * Who is in the group. A membership is a date range: adding someone from a date makes them
 * expected on every lesson from that date, and removing them from a date stops it — sheets already
 * saved keep them, so history never rewrites itself.
 */
export function GroupMembersPanel({ group, onChanged }: { group: GroupDetail; onChanged: (g: GroupDetail) => void }) {
  const t = useTranslations("groups");
  const { can } = useAuth();
  const canManage = can("group.manage");
  const canOpenStudent = can("student.read");
  const locale = useLocale();
  // A member's own price only means something on a priced group the caller may price.
  const canPrice = can("student.set_price") && group.pricing !== null;

  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [notice, setNotice] = useState<string | null>(null);
  const [showFormer, setShowFormer] = useState(false);

  const active = group.members.filter((m) => m.status === "ACTIVE");
  const former = group.members.filter((m) => m.status === "LEFT");
  const seatsLeft = group.capacity !== null ? Math.max(0, group.capacity - active.length) : null;

  function changed(g: GroupDetail, message: string) {
    setModal({ kind: "closed" });
    setNotice(message);
    onChanged(g);
  }

  function memberRow(m: GroupMember) {
    return (
      <li key={m.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between" data-testid={`member-${m.student_id}`}>
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
            {m.status === "ACTIVE"
              ? t("members.since", { date: m.joined_on })
              : t("members.between", { from: m.joined_on, to: m.left_on ?? "" })}
            {m.guardian_name ? ` · ${m.guardian_name}` : ""}
            {m.left_reason ? ` · ${leftReasonText(m.left_reason, t)}` : ""}
            {m.price_minor !== null && group.pricing?.currency
              ? ` · ${t("members.ownPrice", { price: formatMoney({ amount: m.price_minor, currency: group.pricing.currency }, locale) })}`
              : ""}
          </p>
          {m.hour_month && m.hour_month.months > 0 && (
            <p className="text-muted-foreground mt-0.5 text-xs" data-testid={`hour-month-${m.student_id}`}>
              {t("members.hourMonth", {
                month: m.hour_month.months,
                left: hoursText(Math.max(0, m.hour_month.bought_minutes - m.hour_month.used_minutes), locale),
              })}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-sm" title={t("members.rateTitle")}>
            <strong
              className={cn(
                "tabular-nums",
                m.attendance?.rate != null && m.attendance.rate < 0.75 && "text-rose-600 dark:text-rose-400",
              )}
            >
              {percent(m.attendance?.rate)}
            </strong>
            {m.attendance && m.attendance.absent > 0 && (
              <span className="text-muted-foreground ms-1 text-xs">{t("members.absences", { count: m.attendance.absent })}</span>
            )}
          </span>
          {canManage && m.status === "ACTIVE" && (
            <>
              {canPrice && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label={t("members.setPrice")} onClick={() => setModal({ kind: "price", member: m })}>
                  <Tag className="size-4" />
                </Button>
              )}
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("members.move")} onClick={() => setModal({ kind: "move", member: m })}>
                <ArrowRightLeft className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t("members.remove")} onClick={() => setModal({ kind: "remove", member: m })}>
                <UserMinus className="size-4" />
              </Button>
            </>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-4">
      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <strong className="tabular-nums">{active.length}</strong>{" "}
          {group.capacity !== null ? t("members.ofSeats", { capacity: group.capacity }) : t("members.noLimit")}
          {seatsLeft !== null && (
            <span className={cn("ms-2 text-xs", seatsLeft === 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
              {seatsLeft === 0 ? t("members.full") : t("members.seatsLeft", { count: seatsLeft })}
            </span>
          )}
        </p>
        {canManage && group.status === "ACTIVE" && (
          <Button type="button" size="sm" className="gap-1.5" onClick={() => setModal({ kind: "add" })} data-testid="members-add">
            <UserPlus className="size-3.5" />
            {t("members.add")}
          </Button>
        )}
      </div>

      {active.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed p-6 text-center text-sm">{t("members.empty")}</p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border" data-testid="members-active">
          {active.map(memberRow)}
        </ul>
      )}

      {former.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            className="text-muted-foreground inline-flex items-center gap-1 text-sm font-medium"
            onClick={() => setShowFormer((v) => !v)}
            aria-expanded={showFormer}
          >
            <ChevronDown className={cn("size-4 transition-transform", showFormer && "rotate-180")} />
            {t("members.former", { count: former.length })}
          </button>
          {showFormer && <ul className="divide-y overflow-hidden rounded-xl border opacity-80">{former.map(memberRow)}</ul>}
        </div>
      )}

      <Modal open={modal.kind === "add"} onClose={() => setModal({ kind: "closed" })} title={t("members.addTitle")} description={t("members.addHint")} size="lg">
        {modal.kind === "add" && (
          <AddMembersForm
            group={group}
            onCancel={() => setModal({ kind: "closed" })}
            onSaved={(g, n) => changed(g, t("members.added", { count: n }))}
          />
        )}
      </Modal>

      <Modal open={modal.kind === "remove"} onClose={() => setModal({ kind: "closed" })} title={t("members.removeTitle")} description={t("members.removeHint")}>
        {modal.kind === "remove" && (
          <RemoveMemberForm
            group={group}
            member={modal.member}
            onCancel={() => setModal({ kind: "closed" })}
            onSaved={(g) => changed(g, t("members.removed", { name: modal.member.full_name }))}
          />
        )}
      </Modal>

      <Modal
        open={modal.kind === "price"}
        onClose={() => setModal({ kind: "closed" })}
        title={t("members.priceTitle", { name: modal.kind === "price" ? modal.member.full_name : "" })}
        description={t("members.priceHint")}
      >
        {modal.kind === "price" && (
          <MemberPriceForm
            group={group}
            member={modal.member}
            onCancel={() => setModal({ kind: "closed" })}
            onSaved={(g) => changed(g, t("members.priceSaved", { name: modal.member.full_name }))}
          />
        )}
      </Modal>

      <Modal open={modal.kind === "move"} onClose={() => setModal({ kind: "closed" })} title={t("members.moveTitle", { name: modal.kind === "move" ? modal.member.full_name : "" })}>
        {modal.kind === "move" && (
          <MoveMemberForm
            group={group}
            member={modal.member}
            onCancel={() => setModal({ kind: "closed" })}
            onSaved={(g, toName) => changed(g, t("members.moved", { name: modal.member.full_name, group: toName }))}
          />
        )}
      </Modal>
    </div>
  );
}

export function AddMembersForm({
  group,
  onCancel,
  onSaved,
}: {
  group: GroupDetail;
  onCancel: () => void;
  onSaved: (g: GroupDetail, added: number) => void;
}) {
  const t = useTranslations("groups");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // A class nobody has attended yet takes a new student from its first lesson: the desk creates
  // the group and adds the students the same day, and expects them on every lesson, the ones
  // already on the calendar included. Once a lesson has been held, a newcomer joins today.
  const [joinedOn, setJoinedOn] = useState(() => {
    const today = todayIn(group.timezone);
    if (group.lessons.held === 0) return group.start_date;
    return today < group.start_date ? group.start_date : today;
  });
  const [overCapacity, setOverCapacity] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inGroup = useMemo(
    () => new Set(group.members.filter((m) => m.status === "ACTIVE").map((m) => m.student_id)),
    [group.members],
  );

  const seatsLeft = group.capacity !== null ? group.capacity - inGroup.size : null;
  const over = seatsLeft !== null && picked.size > seatsLeft;

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await addGroupMembers(group.id, {
        student_ids: [...picked],
        joined_on: joinedOn,
        allow_over_capacity: over && overCapacity ? true : undefined,
      });
      onSaved(res.group, res.added);
    } catch (err) {
      setError(apiErrorMessage(err, t("members.addFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="add-members-form">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}

      <StudentPicker picked={picked} onToggle={toggle} exclude={inGroup} />

      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("members.joinedOn")}</span>
        <input className={fieldClass} type="date" value={joinedOn} min={group.start_date} onChange={(e) => setJoinedOn(e.target.value)} />
        <span className="text-muted-foreground block text-xs">{t("members.joinedOnHint")}</span>
      </label>

      {over && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <p>{t("members.overCapacity", { count: seatsLeft ?? 0 })}</p>
          <label className="mt-2 flex items-center gap-2 font-medium">
            <input type="checkbox" checked={overCapacity} onChange={(e) => setOverCapacity(e.target.checked)} />
            {t("members.allowOver")}
          </label>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t pt-4">
        <span className="text-muted-foreground text-sm">{t("members.picked", { count: picked.size })}</span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={busy || picked.size === 0 || (over && !overCapacity)}
            data-testid="add-members-save"
          >
            {t("members.addConfirm", { count: picked.size })}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Why a member left: a pause and a stop are coded so every screen can say them in its language. */
export const LEAVE_KINDS = ["PAUSED", "STOPPED", "OTHER"] as const;
type LeaveKind = (typeof LEAVE_KINDS)[number];

/** `left_reason` as written by the leave form ("PAUSED: travelling") or free text ("Moved to A2"). */
export function leftReasonText(reason: string, t: ReturnType<typeof useTranslations>): string {
  const coded = /^(PAUSED|STOPPED)(?::\s*([\s\S]*))?$/.exec(reason);
  if (!coded) return reason;
  const label = t(`members.leaveKinds.${coded[1]}`);
  return coded[2] ? `${label} — ${coded[2]}` : label;
}

export function RemoveMemberForm({
  group,
  member,
  onCancel,
  onSaved,
}: {
  group: GroupDetail;
  member: GroupMember;
  onCancel: () => void;
  onSaved: (g: GroupDetail) => void;
}) {
  const t = useTranslations("groups");
  const [leftOn, setLeftOn] = useState(() => todayIn(group.timezone));
  const [kind, setKind] = useState<LeaveKind>("STOPPED");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const note = reason.trim();
    try {
      const res = await removeGroupMember(group.id, member.student_id, {
        left_on: leftOn,
        reason: kind === "OTHER" ? note || null : note ? `${kind}: ${note}` : kind,
      });
      onSaved(res.group);
    } catch (err) {
      setError(apiErrorMessage(err, t("members.removeFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("members.leftOn")}</span>
        <input className={fieldClass} type="date" value={leftOn} min={member.joined_on} onChange={(e) => setLeftOn(e.target.value)} data-testid="leave-on" />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("lessons.reason")}</span>
        <select className={fieldClass} value={kind} onChange={(e) => setKind(e.target.value as LeaveKind)} data-testid="leave-kind">
          {LEAVE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`members.leaveKinds.${k}`)}
            </option>
          ))}
        </select>
      </label>
      {kind === "PAUSED" && <p className="text-muted-foreground text-xs">{t("members.pausedHint")}</p>}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("members.leaveNote")}</span>
        <input className={fieldClass} value={reason} maxLength={280} onChange={(e) => setReason(e.target.value)} placeholder={t("members.reasonPlaceholder")} data-testid="leave-note" />
      </label>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button type="button" variant="destructive" disabled={busy || !leftOn} onClick={() => void submit()}>
          {t("members.removeConfirm")}
        </Button>
      </div>
    </div>
  );
}

export function MemberPriceForm({
  group,
  member,
  onCancel,
  onSaved,
}: {
  group: GroupDetail;
  member: GroupMember;
  onCancel: () => void;
  onSaved: (g: GroupDetail) => void;
}) {
  const t = useTranslations("groups");
  const [price, setPrice] = useState(fromMinor(member.price_minor));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(value: number | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await updateGroupMember(group.id, member.student_id, { price_minor: value });
      onSaved(res.group);
    } catch (err) {
      setError(apiErrorMessage(err, t("members.priceFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("members.price", { currency: group.pricing?.currency ?? "" })}</span>
        <input className={fieldClass} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={fromMinor(group.pricing?.price_minor)} data-testid="member-price" />
      </label>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        {member.price_minor !== null && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => void submit(null)}>
            {t("members.useGroupPrice")}
          </Button>
        )}
        <Button type="button" disabled={busy || toMinor(price) === null} onClick={() => void submit(toMinor(price))}>
          {t("members.savePrice")}
        </Button>
      </div>
    </div>
  );
}

export function MoveMemberForm({
  group,
  member,
  onCancel,
  onSaved,
}: {
  group: GroupDetail;
  member: GroupMember;
  onCancel: () => void;
  onSaved: (g: GroupDetail, toName: string) => void;
}) {
  const t = useTranslations("groups");
  const [targets, setTargets] = useState<GroupRow[] | null>(null);
  const [toId, setToId] = useState("");
  const [on, setOn] = useState(() => todayIn(group.timezone));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listGroups({ state: "ACTIVE" })
      .then((res) => setTargets(res.groups.filter((g) => g.id !== group.id && g.state !== "FINISHED")))
      .catch(() => setTargets([]));
  }, [group.id]);

  const target = targets?.find((g) => g.id === toId);

  async function submit() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await moveGroupMember(group.id, member.student_id, { to_group_id: target.id, on });
      onSaved(res.group, target.name);
    } catch (err) {
      setError(apiErrorMessage(err, t("members.moveFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("members.moveTo")}</span>
        <select className={fieldClass} value={toId} onChange={(e) => setToId(e.target.value)} data-testid="move-target">
          <option value="">{targets === null ? t("loading") : t("members.pickGroup")}</option>
          {(targets ?? []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
              {g.capacity !== null ? ` (${g.member_count}/${g.capacity})` : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("members.moveOn")}</span>
        <input className={fieldClass} type="date" value={on} onChange={(e) => setOn(e.target.value)} />
      </label>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button type="button" disabled={busy || !target} onClick={() => void submit()}>
          {t("members.moveConfirm")}
        </Button>
      </div>
    </div>
  );
}

/**
 * Correct the day a member started — the API allows it only while the group has held no lesson
 * since the earlier of the two dates, and a charge already raised keeps its amount.
 */
export function JoinDateForm({
  group,
  member,
  onCancel,
  onSaved,
}: {
  group: GroupDetail;
  member: GroupMember;
  onCancel: () => void;
  onSaved: (g: GroupDetail) => void;
}) {
  const t = useTranslations("groups");
  const [joinedOn, setJoinedOn] = useState(member.joined_on);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await updateGroupMember(group.id, member.student_id, { joined_on: joinedOn });
      onSaved(res.group);
    } catch (err) {
      setError(apiErrorMessage(err, t("members.joinDateFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">{t("members.joinedOn")}</span>
        <input className={fieldClass} type="date" value={joinedOn} min={group.start_date} onChange={(e) => setJoinedOn(e.target.value)} data-testid="join-date" />
      </label>
      <p className="text-muted-foreground text-xs">{t("members.joinDateHint")}</p>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          {t("form.cancel")}
        </Button>
        <Button type="button" disabled={busy || !joinedOn || joinedOn === member.joined_on} onClick={() => void submit()} data-testid="join-date-save">
          {t("members.joinDateSave")}
        </Button>
      </div>
    </div>
  );
}
