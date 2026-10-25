"use client";

import { Layers, Loader2, Pencil, Plus, Receipt, Square } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { dayLabel, todayLocal } from "@/components/accounting/accounting-ui";
import { RenewalPolicyControl } from "@/components/accounting/renewal-policy-control";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { JoinDateForm, leftReasonText, MemberPriceForm, MoveMemberForm, RemoveMemberForm } from "@/components/groups/group-members-panel";
import { ClosePackageModal } from "@/components/packages/close-package-modal";
import { EditPackageForm } from "@/components/packages/edit-package-form";
import { OpenPackageForm } from "@/components/packages/open-package-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ProfileCard } from "@/components/ui/profile-card";
import { getStudentRenewalPolicy, setStudentRenewalPolicy, type StudentRenewalPolicy } from "@/lib/accounting-api";
import { listLessonPackages, type LessonPackageRow } from "@/lib/api";
import { useCapability } from "@/lib/capabilities";
import { addGroupMembers, getGroup, listBoardMembers, listGroups, type BoardMember, type GroupDetail, type GroupRow } from "@/lib/groups-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * The student's subscriptions (docs/groups/01-ACCOUNTING.md, "Centre mode"): everything they are
 * paying for, on one card — each group they are in and each private subscription (a block of hours
 * with a teacher), with where it stands — and the two doors to add one. A centre thinks in
 * subscriptions, not in a timetable plus a package; this card is that view over the records that
 * already exist (group memberships, lesson packages). It renders NOTHING without `centre`.
 *
 * Every open row can be edited or ended here, with the group page's and the packages page's own
 * forms: a student pauses or drops ONE group and keeps the rest, so ending is per row — a
 * membership gets a leave date and a reason (PAUSED / STOPPED), a private subscription is closed
 * (what was used is billed) or, if untouched, cancelled. Nothing is deleted.
 */
export function SubscriptionsCard({ studentId, studentName, onChanged }: { studentId: string; studentName: string; onChanged?: () => void }) {
  const centre = useCapability("centre");
  if (!centre) return null;
  return <Subscriptions studentId={studentId} studentName={studentName} onChanged={onChanged} />;
}

type Action =
  | { kind: "join" }
  | { kind: "package" }
  | { kind: "groupEdit" | "groupEnd"; member: BoardMember }
  | { kind: "pkgEdit" | "pkgEnd"; row: LessonPackageRow };

function Subscriptions({ studentId, studentName, onChanged }: { studentId: string; studentName: string; onChanged?: () => void }) {
  const t = useTranslations("students");
  const tp = useTranslations("packages");
  const tg = useTranslations("groups");
  const locale = useLocale();
  const { can } = useAuth();
  const manageGroups = can("group.manage");
  const managePackages = can("package.manage");
  // Renewal policy lives with the money: only an academy on receipts knows what is paid.
  const policyOn = useCapability("accounting") && can("invoice.read");
  const [policy, setPolicy] = useState<StudentRenewalPolicy | null>(null);
  const groupsOn = useCapability("groups") && can("group.read");
  const packagesOn = useCapability("packages") && can("package.read");
  const [members, setMembers] = useState<BoardMember[] | null>(null);
  const [packages, setPackages] = useState<LessonPackageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<Action | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, p] = await Promise.all([
        groupsOn ? listBoardMembers({ student_id: studentId, status: "ALL" }).then((r) => r.members) : Promise.resolve([]),
        packagesOn ? listLessonPackages({ student_id: studentId }).then((r) => r.packages) : Promise.resolve([]),
      ]);
      setMembers(m);
      setPackages(p);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("subscriptions.loadFailed")));
    }
  }, [studentId, groupsOn, packagesOn, t]);

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
  const openPackages = (packages ?? []).filter((p) => p.status === "ACTIVE");
  const closedPackages = (packages ?? []).filter((p) => p.status !== "ACTIVE");
  const loaded = members !== null && packages !== null;
  const nothing = loaded && members.length === 0 && packages.length === 0;

  function done(msg: string) {
    setModal(null);
    setNotice(msg);
    void load();
    onChanged?.();
  }

  return (
    <ProfileCard
      icon={Receipt}
      title={t("subscriptions.title")}
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
          {packagesOn && managePackages && (
            <Button type="button" size="xs" className="gap-1" onClick={() => setModal({ kind: "package" })} data-testid="subs-new-package">
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
      {!loaded && !error && <p className="text-muted-foreground py-4 text-center text-sm">{tp("loading")}</p>}
      {nothing && <p className="text-muted-foreground py-4 text-center text-sm">{t("subscriptions.empty")}</p>}

      {loaded && (members.length > 0 || packages.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {members.length > 0 && (
            <section>
              <h4 className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">{t("subscriptions.groups")}</h4>
              <ul className="divide-y rounded-xl border" data-testid="subs-groups">
                {[...active, ...former].map((m) => (
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
                      {m.status === "ACTIVE" && manageGroups && (
                        <RowActions onEdit={() => setModal({ kind: "groupEdit", member: m })} onEnd={() => setModal({ kind: "groupEnd", member: m })} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {packages.length > 0 && (
            <section>
              <h4 className="text-muted-foreground mb-2 text-xs font-semibold uppercase tracking-wide">{t("subscriptions.private")}</h4>
              <ul className="divide-y rounded-xl border" data-testid="subs-packages">
                {[...openPackages, ...closedPackages].map((p) => (
                  <li key={p.id} className={cn("flex items-start justify-between gap-3 p-3 text-sm", p.status !== "ACTIVE" && "opacity-60")} data-testid={`subs-package-${p.id}`}>
                    <div className="min-w-0">
                      <Link href={`/packages${p.status === "ACTIVE" ? "" : "/finished"}`} className="font-medium hover:underline" title={t("subscriptions.openPackage")}>
                        {p.label}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {[
                          t("subscriptions.since", { date: dayLabel(p.starts_on, locale) }),
                          p.status === "ACTIVE" ? t("subscriptions.remaining", { hours: (p.minutes_remaining / 60).toLocaleString(locale, { maximumFractionDigits: 1 }) }) : tp(`status.${p.status}`),
                        ].join(" · ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5 text-end text-xs">
                      <p className="font-semibold tabular-nums">{money(p.price_minor, p.currency)}</p>
                      {p.outstanding_minor > 0 && <p className="text-rose-600 dark:text-rose-400">{t("subscriptions.outstanding", { amount: money(p.outstanding_minor, p.currency) })}</p>}
                      {p.status === "ACTIVE" && managePackages && <RowActions onEdit={() => setModal({ kind: "pkgEdit", row: p })} onEnd={() => setModal({ kind: "pkgEnd", row: p })} />}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {modal?.kind === "join" && (
        <JoinGroupModal studentId={studentId} studentName={studentName} exclude={new Set(active.map((m) => m.group_id))} onClose={() => setModal(null)} onDone={() => done(t("subscriptions.joined"))} />
      )}
      <Modal open={modal?.kind === "package"} onClose={() => setModal(null)} title={t("subscriptions.newPrivateTitle", { name: studentName })} size="lg">
        {modal?.kind === "package" && <OpenPackageForm initialStudentId={studentId} onSaved={(msg) => done(msg)} onCancel={() => setModal(null)} />}
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
      <Modal open={modal?.kind === "pkgEdit"} onClose={() => setModal(null)} title={t("subscriptions.editPrivateTitle", { name: studentName })} description={tp("edit.description")} size="md">
        {modal?.kind === "pkgEdit" && <EditPackageForm row={modal.row} onSaved={(msg) => done(msg)} onCancel={() => setModal(null)} />}
      </Modal>
      <ClosePackageModal row={modal?.kind === "pkgEnd" ? modal.row : null} title={t("subscriptions.endPrivateTitle")} allowCancel onClose={() => setModal(null)} onDone={(msg) => done(msg)} />
    </ProfileCard>
  );
}

function RowActions({ onEdit, onEnd }: { onEdit: () => void; onEnd: () => void }) {
  const t = useTranslations("students");
  return (
    <div className="flex gap-1">
      <Button type="button" size="xs" variant="ghost" className="gap-1" onClick={onEdit} data-testid="subs-edit">
        <Pencil className="size-3" aria-hidden />
        {t("subscriptions.edit")}
      </Button>
      <Button type="button" size="xs" variant="ghost" className="gap-1 text-rose-600 dark:text-rose-400" onClick={onEnd} data-testid="subs-end">
        <Square className="size-3" aria-hidden />
        {t("subscriptions.end")}
      </Button>
    </div>
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

function JoinGroupModal({ studentId, studentName, exclude, onClose, onDone }: { studentId: string; studentName: string; exclude: Set<string>; onClose: () => void; onDone: () => void }) {
  const t = useTranslations("students");
  const tg = useTranslations("groups");
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [groupId, setGroupId] = useState("");
  const [joinedOn, setJoinedOn] = useState(todayLocal());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await addGroupMembers(groupId, { student_ids: [studentId], joined_on: joinedOn });
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
          <Button type="submit" form="join-group-form" disabled={busy || !groupId} data-testid="subs-join-confirm">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("subscriptions.join")}
          </Button>
        </>
      }
    >
      <form id="join-group-form" onSubmit={(e) => void submit(e)} className="space-y-3">
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
            {(groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.teacher_name ? ` · ${g.teacher_name}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          {t("subscriptions.joinedOn")}
          <input type="date" className={cn(fieldClass, "mt-1.5")} value={joinedOn} onChange={(e) => setJoinedOn(e.target.value)} />
        </label>
        {error && <AlertBanner variant="error" message={error} />}
      </form>
    </Modal>
  );
}
