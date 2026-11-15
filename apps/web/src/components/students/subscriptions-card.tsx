"use client";

import { Layers, Loader2, Pencil, Plus, Receipt, RotateCcw, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { dayLabel, todayLocal } from "@/components/accounting/accounting-ui";
import { RenewalPolicyControl } from "@/components/accounting/renewal-policy-control";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { filterGroups, GroupSearchBox } from "@/components/groups/group-search";
import { JoinDateForm, leftReasonText, MemberPriceForm, MoveMemberForm, RemoveMemberForm } from "@/components/groups/group-members-panel";
import { CloseSubscriptionModal } from "@/components/subscriptions/close-subscription-modal";
import { EditSubscriptionForm } from "@/components/subscriptions/edit-subscription-form";
import { SellSubscriptionForm } from "@/components/subscriptions/sell-subscription-form";
import { SubscriptionDetail } from "@/components/subscriptions/subscription-detail";
import { SubscriptionRowCard, type RowActions as SubscriptionRowActions } from "@/components/subscriptions/subscription-row";
import { CancelSubscriptionModal } from "@/components/subscriptions/subscriptions-manager";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ProfileCard } from "@/components/ui/profile-card";
import { getStudentRenewalPolicy, setStudentRenewalPolicy, type StudentRenewalPolicy } from "@/lib/accounting-api";
import { useCapability } from "@/lib/capabilities";
import { addGroupMembers, bookGroupTrial, getGroup, getTrialPrice, listBoardLessons, listBoardMembers, listGroups, undoGroupMember, type BoardLesson, type BoardMember, type GroupDetail, type GroupRow } from "@/lib/groups-api";
import { listSubscriptions, subscriptionScope, type SubscriptionRow } from "@/lib/subscriptions-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The student's subscriptions (docs/groups/01-ACCOUNTING.md, "Centre mode"; the private half on
 * docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md): everything they are paying for, on one
 * card — each group they are in and each private subscription (a block of lessons for a subject),
 * with where it stands — and the two doors to add one. A centre thinks in subscriptions, not in a
 * timetable plus a package; this card is that view over the records that already exist (group
 * memberships, `centre_subscriptions`). It renders NOTHING without `centre`.
 *
 * Every open row can be edited or ended here, with the group page's and the subscriptions page's
 * own forms: a student pauses or drops ONE group and keeps the rest, so ending is per row — a
 * membership gets a leave date and a reason (PAUSED / STOPPED), a private subscription is closed
 * (with the settlement of what was paid and not taken) or, if untouched, cancelled.
 */
export function SubscriptionsCard({
  studentId,
  studentName,
  onChanged,
  title,
}: {
  studentId: string;
  studentName: string;
  onChanged?: () => void;
  /** The card's heading — the parent's page names each child ("Adam's subscriptions"). */
  title?: string;
}) {
  const centre = useCapability("centre");
  if (!centre) return null;
  return <Subscriptions studentId={studentId} studentName={studentName} onChanged={onChanged} title={title} />;
}

type Action =
  | { kind: "join"; groupId?: string }
  | { kind: "sell"; prefill?: SubscriptionRow }
  | { kind: "groupEdit" | "groupEnd" | "groupDelete"; member: BoardMember }
  | { kind: "subEdit" | "subEnd" | "subCancel" | "subDetail"; row: SubscriptionRow };

function Subscriptions({ studentId, studentName, onChanged, title }: { studentId: string; studentName: string; onChanged?: () => void; title?: string }) {
  const t = useTranslations("students");
  const ts = useTranslations("subscriptions");
  const tg = useTranslations("groups");
  const locale = useLocale();
  const { can } = useAuth();
  const manageGroups = can("group.manage");
  const manageSubs = can("package.manage");
  // Renewal policy lives with the money: only an academy on receipts knows what is paid.
  const policyOn = useCapability("accounting") && can("invoice.read");
  const [policy, setPolicy] = useState<StudentRenewalPolicy | null>(null);
  const groupsOn = useCapability("groups") && can("group.read");
  const subsOn = can("package.read");
  const [members, setMembers] = useState<BoardMember[] | null>(null);
  const [subs, setSubs] = useState<SubscriptionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<Action | null>(null);
  // What has ended (left groups, cancelled or finished blocks) folds away until asked for.
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([
        groupsOn ? listBoardMembers({ student_id: studentId, status: "ALL" }).then((r) => r.members) : Promise.resolve([]),
        subsOn ? listSubscriptions({ student_id: studentId }).then((r) => r.rows) : Promise.resolve([]),
      ]);
      setMembers(m);
      setSubs(s);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("subscriptions.loadFailed")));
    }
  }, [studentId, groupsOn, subsOn, t]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!policyOn) return;
    getStudentRenewalPolicy(studentId)
      .then(setPolicy)
      .catch(() => setPolicy(null));
  }, [policyOn, studentId]);

  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  const active = (members ?? []).filter((m) => m.status === "ACTIVE");
  const former = (members ?? []).filter((m) => m.status !== "ACTIVE");
  const openSubs = (subs ?? []).filter((s) => s.status === "OPEN");
  const closedSubs = (subs ?? []).filter((s) => s.status !== "OPEN");
  // Per subject, the newest finished block — when nothing is open for it: the one to sell again.
  const renewableIds = new Set<string>();
  const seenScopes = new Set(openSubs.map(subscriptionScope));
  for (const s of [...closedSubs].sort((a, b) => b.sequence_no - a.sequence_no)) {
    if (s.status === "CANCELLED") continue;
    const scope = subscriptionScope(s);
    if (seenScopes.has(scope)) continue;
    seenScopes.add(scope);
    renewableIds.add(s.id);
  }
  // Back into a group they left (paused for not paying, say): one press, from the last time they left it.
  const rejoinable = new Set<string>();
  const activeGroups = new Set(active.map((m) => m.group_id));
  const lastLeft = new Map<string, BoardMember>();
  for (const m of former) {
    const seen = lastLeft.get(m.group_id);
    if (!seen || (m.left_on ?? m.joined_on) > (seen.left_on ?? seen.joined_on)) lastLeft.set(m.group_id, m);
  }
  for (const [groupId, m] of lastLeft) if (!activeGroups.has(groupId)) rejoinable.add(m.id);
  // Always shown: what runs now, and the last finished block of a subject (it carries Renew).
  const pastMembers = former.filter((m) => !rejoinable.has(m.id));
  const shownMembers = showPast ? [...active, ...former] : [...active, ...former.filter((m) => rejoinable.has(m.id))];
  const shownSubs = showPast ? [...openSubs, ...closedSubs] : [...openSubs, ...closedSubs.filter((s) => renewableIds.has(s.id))];
  const pastCount = pastMembers.length + closedSubs.filter((s) => !renewableIds.has(s.id)).length;
  const loaded = members !== null && subs !== null;
  const nothing = loaded && members.length === 0 && subs.length === 0;

  function done(msg: string) {
    setModal(null);
    setNotice(msg);
    void load();
    onChanged?.();
  }

  const subActions: SubscriptionRowActions = {
    onOpen: (row) => setModal({ kind: "subDetail", row }),
    onEdit: manageSubs ? (row) => setModal({ kind: "subEdit", row }) : undefined,
    onRenew: manageSubs ? (row) => setModal({ kind: "sell", prefill: row }) : undefined,
    onClose: manageSubs ? (row) => setModal({ kind: "subEnd", row }) : undefined,
    onCancel: manageSubs ? (row) => setModal({ kind: "subCancel", row }) : undefined,
  };

  return (
    <ProfileCard
      icon={Receipt}
      title={title ?? t("subscriptions.title")}
      description={t("subscriptions.description")}
      tone="violet"
      testId="student-subscriptions"
      action={
        <div className="flex flex-wrap gap-1.5">
          {groupsOn && manageGroups && (
            <Button type="button" size="xs" variant="outline" className="gap-1" onClick={() => setModal({ kind: "join" })} data-testid="subs-join-group">
              <Layers className="size-3.5" aria-hidden />
              {t("subscriptions.joinGroup")}
            </Button>
          )}
          {subsOn && manageSubs && (
            <Button type="button" size="xs" className="gap-1" onClick={() => setModal({ kind: "sell" })} data-testid="subs-new-package">
              <Plus className="size-3.5" aria-hidden />
              {t("subscriptions.newPrivate")}
            </Button>
          )}
        </div>
      }
    >
      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
      {policy && (
        <div className="mb-3 rounded-xl border px-3 py-2.5">
          <RenewalPolicyControl
            value={policy.policy}
            canEdit={can("invoice.mark_paid")}
            inheritedFrom={policy.family_policy === "PAY_FIRST" ? policy.guardian_id : null}
            onChange={async (next) => {
              setPolicy(await setStudentRenewalPolicy(studentId, next));
              void load();
            }}
          />
        </div>
      )}
      {!loaded && !error && <p className="text-muted-foreground py-4 text-center text-sm">{ts("loading")}</p>}
      {nothing && <p className="text-muted-foreground py-4 text-center text-sm">{t("subscriptions.empty")}</p>}

      {loaded && (members.length > 0 || subs.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {members.length > 0 && (
            <section>
              <h4 className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">{t("subscriptions.groups")}</h4>
              <ul className="divide-y rounded-xl border" data-testid="subs-groups">
                {shownMembers.map((m) => (
                  <li key={m.id} className={cn("flex items-start justify-between gap-3 p-3 text-sm", m.status !== "ACTIVE" && "opacity-60")} data-testid={`subs-group-${m.group_id}`}>
                    <div className="min-w-0">
                      <Link href={`/groups/${m.group_id}?tab=accounts`} className="font-medium hover:underline" title={t("subscriptions.openGroup")}>
                        {m.group_name}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {[
                          m.teacher_name,
                          m.status === "ACTIVE" ? t("subscriptions.since", { date: dayLabel(m.joined_on, locale) }) : t("subscriptions.left", { date: dayLabel(m.left_on ?? m.joined_on, locale) }),
                          m.status !== "ACTIVE" && m.left_reason ? leftReasonText(m.left_reason, tg) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {m.charge && m.charge.outstanding_minor > 0 && (
                        <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">{t("subscriptions.outstanding", { amount: money(m.charge.outstanding_minor, m.charge.currency) })}</span>
                      )}
                      {m.status !== "ACTIVE" && manageGroups && rejoinable.has(m.id) && (
                        <Button type="button" size="xs" variant="outline" className="gap-1" onClick={() => setModal({ kind: "join", groupId: m.group_id })} data-testid={`subs-rejoin-${m.group_id}`}>
                          <RotateCcw className="size-3.5" aria-hidden />
                          {t("subscriptions.rejoin")}
                        </Button>
                      )}
                      {m.status === "ACTIVE" && manageGroups && (
                        <RowActions
                          onEdit={() => setModal({ kind: "groupEdit", member: m })}
                          onEnd={() => setModal({ kind: "groupEnd", member: m })}
                          onDelete={m.deletable ? () => setModal({ kind: "groupDelete", member: m }) : undefined}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {subs.length > 0 && (
            <section>
              <h4 className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">{t("subscriptions.private")}</h4>
              <ul className="space-y-2" data-testid="subs-packages">
                {shownSubs.map((row) => (
                  <SubscriptionRowCard
                    key={row.id}
                    row={row}
                    canManage={manageSubs}
                    canRemind={false}
                    compact
                    // The latest finished block of a subject with nothing open is the one to sell again.
                    actions={{ ...subActions, onRenew: renewableIds.has(row.id) ? subActions.onRenew : undefined }}
                  />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      {loaded && pastCount > 0 && (
        <button type="button" className="text-muted-foreground mt-3 text-xs hover:underline" onClick={() => setShowPast((v) => !v)} data-testid="subs-show-past">
          {showPast ? t("subscriptions.hidePast") : t("subscriptions.showPast", { count: pastCount })}
        </button>
      )}

      {modal?.kind === "join" && (
        <JoinGroupModal
          studentId={studentId}
          studentName={studentName}
          exclude={new Set(active.map((m) => m.group_id))}
          presetGroupId={modal.groupId}
          onClose={() => setModal(null)}
          onDone={() => done(t(modal.groupId ? "subscriptions.rejoined" : "subscriptions.joined"))}
        />
      )}
      <Modal open={modal?.kind === "sell"} onClose={() => setModal(null)} title={t("subscriptions.newPrivateTitle", { name: studentName })} description={ts("sell.description")} size="lg">
        {modal?.kind === "sell" && <SellSubscriptionForm initialStudentId={studentId} prefill={modal.prefill} onSaved={(msg) => done(msg)} onCancel={() => setModal(null)} />}
      </Modal>
      {(modal?.kind === "groupEdit" || modal?.kind === "groupEnd") && (
        <MembershipModal
          member={modal.member}
          studentName={studentName}
          mode={modal.kind === "groupEnd" ? "end" : "edit"}
          onClose={() => setModal(null)}
          onDone={(msg) => done(msg)}
        />
      )}
      {modal?.kind === "groupDelete" && (
        <DeleteMembershipModal member={modal.member} studentName={studentName} onClose={() => setModal(null)} onDone={(msg) => done(msg)} />
      )}
      <Modal open={modal?.kind === "subEdit"} onClose={() => setModal(null)} title={t("subscriptions.editPrivateTitle", { name: studentName })} description={ts("edit.description")} size="lg">
        {modal?.kind === "subEdit" && <EditSubscriptionForm row={modal.row} onSaved={(msg) => done(msg)} onCancel={() => setModal(null)} />}
      </Modal>
      <CloseSubscriptionModal row={modal?.kind === "subEnd" ? modal.row : null} title={t("subscriptions.endPrivateTitle")} onClose={() => setModal(null)} onDone={(msg) => done(msg)} />
      {modal?.kind === "subCancel" && <CancelSubscriptionModal row={modal.row} onClose={() => setModal(null)} onDone={(msg) => done(msg)} />}
      <Modal open={modal?.kind === "subDetail"} onClose={() => setModal(null)} title={modal?.kind === "subDetail" ? modal.row.label : ""} size="lg">
        {modal?.kind === "subDetail" && <SubscriptionDetail id={modal.row.id} initial={modal.row} />}
      </Modal>
    </ProfileCard>
  );
}

function RowActions({ onEdit, onEnd, onDelete }: { onEdit: () => void; onEnd: () => void; onDelete?: () => void }) {
  const t = useTranslations("students");
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button type="button" size="xs" variant="ghost" className="gap-1" onClick={onEdit} data-testid="subs-edit">
        <Pencil className="size-3" aria-hidden />
        {t("subscriptions.edit")}
      </Button>
      <Button type="button" size="xs" variant="ghost" className="gap-1 text-rose-600 dark:text-rose-400" onClick={onEnd} data-testid="subs-end">
        <Square className="size-3" aria-hidden />
        {t("subscriptions.end")}
      </Button>
      {onDelete && (
        <Button type="button" size="xs" variant="ghost" className="text-destructive gap-1" onClick={onDelete} data-testid="subs-delete">
          <Trash2 className="size-3" aria-hidden />
          {t("subscriptions.delete")}
        </Button>
      )}
    </div>
  );
}

/** Undo a group enrolment made by mistake — only offered while nothing of it has happened. */
function DeleteMembershipModal({ member, studentName, onClose, onDone }: { member: BoardMember; studentName: string; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("students");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await undoGroupMember(member.group_id, member.student_id);
      onDone(
        res.credited_minor > 0 && member.charge
          ? t("subscriptions.deletedCredited", { amount: formatMoney({ amount: res.credited_minor, currency: member.charge.currency }, locale) })
          : t("subscriptions.deleted"),
      );
    } catch (err) {
      setError(apiErrorMessage(err, t("subscriptions.deleteFailed")));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("subscriptions.deleteTitle", { name: studentName, group: member.group_name })}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("subscriptions.keep")}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={busy} data-testid="subs-delete-confirm">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("subscriptions.deleteConfirm")}
          </Button>
        </>
      }
    >
      <p className="text-muted-foreground text-sm">{t("subscriptions.deleteHint")}</p>
      {error && <AlertBanner variant="error" message={error} />}
    </Modal>
  );
}

type MembershipTab = "date" | "price" | "move";

/**
 * One group membership, edited or ended with the group page's own forms. Those work on the group's
 * detail (its timezone, price, the member's own price), so the modal reads it first.
 */
function MembershipModal({
  member,
  studentName,
  mode,
  onClose,
  onDone,
}: {
  member: BoardMember;
  studentName: string;
  mode: "edit" | "end";
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("students");
  const { can } = useAuth();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<MembershipTab>("date");

  useEffect(() => {
    getGroup(member.group_id)
      .then((r) => setGroup(r.group))
      .catch((err) => setError(apiErrorMessage(err, t("subscriptions.groupLoadFailed"))));
  }, [member.group_id, t]);

  const gm = group?.members.find((m) => m.student_id === member.student_id && m.status === "ACTIVE") ?? null;
  const canPrice = can("student.set_price") && group?.pricing != null;
  const tabs: MembershipTab[] = canPrice ? ["date", "price", "move"] : ["date", "move"];
  const tabLabel: Record<MembershipTab, string> = { date: t("subscriptions.tabJoinDate"), price: t("subscriptions.tabPrice"), move: t("subscriptions.tabMove") };
  const saved = () => onDone(mode === "end" ? t("subscriptions.ended") : t("subscriptions.saved"));

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "end" ? t("subscriptions.endGroupTitle", { name: studentName, group: member.group_name }) : t("subscriptions.editGroupTitle", { name: studentName, group: member.group_name })}
      description={mode === "end" ? t("subscriptions.endGroupHint") : undefined}
      size="md"
    >
      {error && <AlertBanner variant="error" message={error} />}
      {group === null && error === null && <Loader2 className="text-muted-foreground mx-auto my-6 size-5 animate-spin" aria-hidden />}
      {group !== null && gm === null && <AlertBanner variant="error" message={t("subscriptions.groupLoadFailed")} />}
      {group !== null && gm !== null && mode === "end" && <RemoveMemberForm group={group} member={gm} onCancel={onClose} onSaved={saved} />}
      {group !== null && gm !== null && mode === "edit" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5" role="tablist">
            {tabs.map((k) => (
              <Button key={k} type="button" size="xs" role="tab" aria-selected={tab === k} variant={tab === k ? "default" : "outline"} onClick={() => setTab(k)} data-testid={`subs-tab-${k}`}>
                {tabLabel[k]}
              </Button>
            ))}
          </div>
          {tab === "date" && <JoinDateForm group={group} member={gm} onCancel={onClose} onSaved={saved} />}
          {tab === "price" && canPrice && <MemberPriceForm group={group} member={gm} onCancel={onClose} onSaved={saved} />}
          {tab === "move" && <MoveMemberForm group={group} member={gm} onCancel={onClose} onSaved={saved} />}
        </div>
      )}
    </Modal>
  );
}

function JoinGroupModal({
  studentId,
  studentName,
  exclude,
  presetGroupId,
  onClose,
  onDone,
}: {
  studentId: string;
  studentName: string;
  exclude: Set<string>;
  /** Back into this group (from the row of the last time they left it), from today. */
  presetGroupId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("students");
  const tg = useTranslations("groups");
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [groupId, setGroupId] = useState(presetGroupId ?? "");
  const [groupQuery, setGroupQuery] = useState("");
  const [joinedOn, setJoinedOn] = useState(todayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One trial lesson instead of joining (Lingo 2026-11-15): the lesson, and its price on the group.
  const [trial, setTrial] = useState(false);
  const [lessons, setLessons] = useState<BoardLesson[] | null>(null);
  const [lessonId, setLessonId] = useState("");
  const [price, setPrice] = useState<{ amount_minor: number | null; currency: string | null } | null>(null);
  const [priceText, setPriceText] = useState("");
  const { can: canDo } = useAuth();
  const locale = useLocale();

  // The group's lessons in the next two weeks still to come.
  useEffect(() => {
    if (!trial || !groupId) return;
    let alive = true;
    setLessons(null);
    setLessonId("");
    const today = todayLocal();
    const next = new Date(`${today}T00:00:00`);
    next.setDate(next.getDate() + 7);
    const nextWeek = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    void Promise.all([listBoardLessons({ view: "week", date: today, group_id: groupId }), listBoardLessons({ view: "week", date: nextWeek, group_id: groupId })])
      .then(([a, b]) => {
        if (!alive) return;
        const upcoming = [...a.lessons, ...b.lessons].filter((l) => l.status === "SCHEDULED" && l.occurrence_local_date >= today);
        setLessons(upcoming);
        if (upcoming[0]) setLessonId(upcoming[0].id);
      })
      .catch(() => alive && setLessons([]));
    return () => {
      alive = false;
    };
  }, [trial, groupId]);

  useEffect(() => {
    if (!trial || !groupId || !lessonId) return;
    let alive = true;
    void getTrialPrice(groupId, lessonId)
      .then((p) => {
        if (!alive) return;
        setPrice(p);
        setPriceText(p.amount_minor !== null ? String(p.amount_minor / 100) : "");
      })
      .catch(() => alive && setPrice(null));
    return () => {
      alive = false;
    };
  }, [trial, groupId, lessonId]);

  useEffect(() => {
    void listGroups({ state: "ACTIVE" })
      .then((r) => setGroups(r.groups.filter((g) => !exclude.has(g.id))))
      .catch(() => setGroups([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) return;
    setBusy(true);
    setError(null);
    try {
      if (trial) {
        if (!lessonId) return;
        const typed = Math.round(Number.parseFloat(priceText.replace(",", ".")) * 100);
        const changed = canDo("student.set_price") && Number.isFinite(typed) && typed !== price?.amount_minor;
        await bookGroupTrial(groupId, { student_id: studentId, lesson_id: lessonId, ...(changed ? { amount_minor: typed } : {}) });
      } else {
        await addGroupMembers(groupId, { student_ids: [studentId], joined_on: joinedOn });
      }
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, t("subscriptions.joinFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("subscriptions.joinGroupTitle", { name: studentName })}
      description={t("subscriptions.joinGroupHint")}
      size="md"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {tg("form.cancel")}
          </Button>
          <Button type="submit" form="join-group-form" disabled={busy || !groupId || (trial && !lessonId)} data-testid="subs-join-confirm">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {trial ? t("subscriptions.bookTrial") : t("subscriptions.join")}
          </Button>
        </>
      }
    >
      <form id="join-group-form" onSubmit={(e) => void submit(e)} className="space-y-3">
        <GroupSearchBox count={groups?.length ?? 0} value={groupQuery} onChange={setGroupQuery} testId="subs-group-search" />
        <label className="block text-sm font-medium">
          {t("subscriptions.pickGroup")}
          <select
            className={cn(fieldClass, "mt-1.5")}
            value={groupId}
            onChange={(e) => {
              const id = e.target.value;
              setGroupId(id);
              // A class nobody has attended yet takes the student from its first lesson.
              const g = groups?.find((x) => x.id === id);
              if (g) setJoinedOn(g.lessons.held === 0 ? g.start_date : todayLocal() < g.start_date ? g.start_date : todayLocal());
            }}
            data-testid="subs-group-pick"
          >
            <option value="">{groups === null ? "…" : groups.length === 0 ? t("subscriptions.noGroups") : "—"}</option>
            {filterGroups(groups ?? [], groupQuery).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.teacher_name ? ` · ${g.teacher_name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="accent-primary mt-1" checked={trial} onChange={(e) => setTrial(e.target.checked)} data-testid="subs-trial" />
          <span>
            {t("subscriptions.trialLesson")}
            <span className="text-muted-foreground block text-xs">{t("subscriptions.trialLessonHint")}</span>
          </span>
        </label>
        {trial ? (
          <div className="space-y-2 rounded-xl border p-3">
            <label className="block text-sm font-medium">
              {t("subscriptions.trialPickLesson")}
              <select className={cn(fieldClass, "mt-1.5")} value={lessonId} onChange={(e) => setLessonId(e.target.value)} disabled={!groupId || lessons === null} data-testid="subs-trial-lesson">
                {lessons !== null && lessons.length === 0 && <option value="">{t("subscriptions.trialNoLessons")}</option>}
                {(lessons ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {dayLabel(l.occurrence_local_date, locale)} · {new Date(l.scheduled_at_utc).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                  </option>
                ))}
              </select>
            </label>
            {price && price.amount_minor !== null && (
              <label className="block text-sm font-medium">
                {t("subscriptions.trialPrice", { currency: price.currency ?? "" })}
                <input
                  className={cn(fieldClass, "mt-1.5")}
                  inputMode="decimal"
                  dir="ltr"
                  value={priceText}
                  onChange={(e) => setPriceText(e.target.value)}
                  disabled={!canDo("student.set_price")}
                  data-testid="subs-trial-price"
                />
              </label>
            )}
          </div>
        ) : (
          <label className="block text-sm font-medium">
            {t("subscriptions.joinedOn")}
            <input type="date" className={cn(fieldClass, "mt-1.5")} value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} />
          </label>
        )}
        {error && <AlertBanner variant="error" message={error} />}
      </form>
    </Modal>
  );
}
