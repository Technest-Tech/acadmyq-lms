"use client";

import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BookOpenCheck,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Coins,
  Ellipsis,
  FileText,
  GraduationCap,
  Hourglass,
  LayoutGrid,
  Link2,
  type LucideIcon,
  MapPin,
  Pencil,
  Repeat,
  StickyNote,
  Trash2,
  UsersRound,
  Video,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { CourseEndPanel } from "@/components/groups/course-end-panel";
import { GradeSheet } from "@/components/grades/grade-sheet";
import { TermReportsPanel } from "@/components/grades/term-reports-panel";
import { GroupAccountsPanel } from "@/components/groups/group-accounts-panel";
import { GroupForm, apiErrorMessage } from "@/components/groups/group-form";
import { hoursText, isolateFractions, monthLessons, percent, pricingRuleKey, sortSlots, wallTime } from "@/components/groups/group-format";
import { PASTEL, SoftBadge, STATE_BADGE, StatCard, type PastelTone, rateTone } from "@/components/groups/group-look";
import { GroupLessonsPanel } from "@/components/groups/group-lessons-panel";
import { GroupMembersPanel } from "@/components/groups/group-members-panel";
import { GroupMoneyPanel } from "@/components/groups/group-money-panel";
import { WaitlistPanel } from "@/components/groups/waitlist-panel";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Modal } from "@/components/ui/modal";
import { HeroBadge, PageHero } from "@/components/ui/page-hero";
import { useCapability, useCentreLook } from "@/lib/capabilities";
import { archiveGroup, deleteGroup, getGroup, restoreGroup, type GroupDetail } from "@/lib/groups-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useLevelWord } from "@/lib/levels";

type Tab = "lessons" | "members" | "grades" | "reports" | "money" | "accounts" | "overview";
const TABS: Tab[] = ["lessons", "members", "grades", "reports", "money", "accounts", "overview"];
/** A centre's tabs (docs/centre-profile, Phase 2 §5): the grade sheet and the term reports. */
const CENTRE_TABS: Tab[] = ["grades", "reports"];
/** A centre's tabs carry an icon each. */
const TAB_ICONS: Record<Tab, LucideIcon> = {
  lessons: CalendarDays,
  members: UsersRound,
  grades: BookOpenCheck,
  reports: FileText,
  money: Wallet,
  accounts: Wallet,
  overview: LayoutGrid,
};

/**
 * One group's page (docs/groups): its lessons (the default — that is where the daily work is),
 * its members, and an overview of the numbers. `?tab=members` deep-links straight to the members,
 * which is where a freshly created group sends the owner.
 */
export function GroupDetailScreen({ groupId }: { groupId: string }) {
  const t = useTranslations("groups");
  const look = useCentreLook();
  const tTerm = useTranslations("courseTerm");
  const word = useLevelWord();
  const tg = useTranslations("grades");
  const { can } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const canManage = can("group.manage");
  // The money tab is the owner's view of the bills — never a supervisor's or a teacher's. An academy
  // on receipts (accounting) gets the collection sheet in its place.
  const accounting = useCapability("accounting");
  // A centre's group is a course term (docs/centre-profile, Phase 2 §2): progress, end, waiting list.
  // Grades and term reports are a centre's; a Quran academy's group page is what it was.
  const centre = useCapability("centre");
  const tabs = TABS.filter((k) => {
    if (k === "money") return can("invoice.read") && !accounting;
    if (k === "accounts") return can("invoice.read") && accounting;
    if (CENTRE_TABS.includes(k)) return centre;
    return true;
  });

  const initialTab = search.get("tab");
  const [tab, setTab] = useState<Tab>(tabs.includes(initialTab as Tab) ? (initialTab as Tab) : "lessons");
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await getGroup(groupId);
      setGroup(res.group);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("loadFailed")));
    }
  }, [groupId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(kind: "archive" | "restore" | "delete") {
    if (!group) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "delete") {
        await deleteGroup(group.id);
        router.push("/groups");
        return;
      }
      const res = kind === "archive" ? await archiveGroup(group.id) : await restoreGroup(group.id);
      setGroup(res.group);
      setNotice(kind === "archive" ? t("detail.archived") : t("detail.restored"));
      setConfirm(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("detail.actionFailed")));
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }

  if (!group) {
    return error ? <AlertBanner variant="error" message={error} /> : <p className="text-muted-foreground py-10 text-center text-sm">{t("loading")}</p>;
  }

  const subtitle = [group.level, group.specialization_name, group.teacher_name].filter(Boolean).join(" · ");

  return (
    <div className="space-y-5">
      <Link href="/groups" className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm">
        <ArrowLeft className="size-4 rtl:rotate-180" />
        {t("detail.back")}
      </Link>

      {look ? (
        <>
          <section className="centre-hero rounded-[1.25rem] p-4 sm:p-6" data-testid="group-hero">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-center gap-4">
                <span className="bg-card text-primary flex size-14 shrink-0 items-center justify-center rounded-2xl shadow-sm">
                  <UsersRound className="size-7" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h1 className="text-xl leading-tight font-extrabold break-words sm:text-[1.75rem]">{group.name}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <SoftBadge tone={STATE_BADGE[group.state].pill}>
                      <span className={cn("size-1.5 rounded-full", STATE_BADGE[group.state].dot)} aria-hidden />
                      {t(`state.${group.state}`)}
                    </SoftBadge>
                    {group.level && <SoftBadge tone="bg-card text-primary">{group.level}</SoftBadge>}
                    {group.specialization_name && <SoftBadge tone="bg-card text-foreground/80">{group.specialization_name}</SoftBadge>}
                    {group.teacher_name && (
                      <SoftBadge tone="bg-card text-foreground/80">
                        <GraduationCap className="size-3.5" aria-hidden />
                        {group.teacher_name}
                      </SoftBadge>
                    )}
                    <SoftBadge tone="bg-card text-foreground/80">
                      {group.mode === "ONLINE" ? <Video className="size-3.5" aria-hidden /> : <MapPin className="size-3.5" aria-hidden />}
                      {group.mode === "OFFLINE" && group.location ? group.location : t(`mode.${group.mode}`)}
                    </SoftBadge>
                    {centre && group.state === "RUNNING" && group.ends_in_days != null && group.ends_in_days >= 0 && (
                      <SoftBadge tone={group.ending_soon ? "amber" : "bg-card text-foreground/80"}>
                        <Hourglass className="size-3.5" aria-hidden />
                        <span data-testid="group-ends-in">{tTerm("endsIn", { days: group.ends_in_days })}</span>
                      </SoftBadge>
                    )}
                  </div>
                </div>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  {group.status === "ACTIVE" && (
                    <Button type="button" size="lg" className="gap-1.5 px-4" onClick={() => setEditing(true)} data-testid="group-edit">
                      <Pencil className="size-4" />
                      {t("detail.edit")}
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <button
                        type="button"
                        aria-label={t("lessons.more")}
                        className="bg-card text-foreground hover:bg-muted inline-flex size-11 items-center justify-center rounded-xl shadow-sm transition-colors"
                      >
                        <Ellipsis className="size-5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {group.status === "ACTIVE" ? (
                        <DropdownMenuItem onClick={() => setConfirm("archive")}>
                          <Archive className="size-4" />
                          {t("detail.archive")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => void act("restore")}>
                          <ArchiveRestore className="size-4" />
                          {t("detail.restore")}
                        </DropdownMenuItem>
                      )}
                      {group.lessons.held === 0 && (
                        <DropdownMenuItem destructive onClick={() => setConfirm("delete")}>
                          <Trash2 className="size-4" />
                          {t("detail.delete")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4" data-testid="group-stats">
            <StatCard
              icon={ClipboardCheck}
              tone={rateTone(group.attendance_rate)}
              label={t("overview.attendance")}
              value={percent(group.attendance_rate)}
              progress={group.attendance_rate == null ? null : group.attendance_rate * 100}
              barTone={{ emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500", slate: "bg-slate-400" }[rateTone(group.attendance_rate) as "emerald" | "amber" | "rose" | "slate"]}
              sub={group.attendance_rate == null ? t("card.noSheets") : undefined}
            />
            <StatCard
              icon={UsersRound}
              tone="violet"
              label={t("seats")}
              value={<span dir="ltr">{group.capacity !== null ? t("seatsOf", { count: group.member_count, capacity: group.capacity }) : group.member_count}</span>}
              progress={group.capacity ? (group.member_count / group.capacity) * 100 : null}
              barTone={group.capacity !== null && group.member_count >= group.capacity ? "bg-amber-500" : "bg-primary"}
              sub={
                group.capacity === null
                  ? t("form.sections.summaryNoSeats")
                  : group.member_count >= group.capacity
                    ? t("card.full")
                    : t("card.seatsLeft", { count: group.capacity - group.member_count })
              }
            />
            <StatCard
              icon={CalendarDays}
              tone="sky"
              label={t("overview.held")}
              value={
                <span dir="ltr" data-testid="group-progress" title={tTerm("progressTitle")}>
                  {group.lessons_planned != null ? `${group.lessons_held ?? group.lessons.held} / ${group.lessons_planned}` : group.lessons.held}
                </span>
              }
              progress={group.lessons_planned ? ((group.lessons_held ?? group.lessons.held) / group.lessons_planned) * 100 : null}
              barTone="bg-sky-500"
              sub={t("card.upcomingCount", { count: group.lessons.upcoming })}
            />
            <StatCard
              icon={AlertTriangle}
              tone={group.lessons.overdue > 0 ? "rose" : "emerald"}
              label={t("card.overdue")}
              value={<span className={group.lessons.overdue > 0 ? "text-rose-600 dark:text-rose-400" : undefined}>{group.lessons.overdue}</span>}
              sub={group.lessons.overdue > 0 ? t("lessons.owed", { count: group.lessons.overdue }) : t("card.allMarked")}
              onClick={group.lessons.overdue > 0 ? () => setTab("lessons") : undefined}
            />
          </div>
        </>
      ) : (
          <PageHero
            icon={UsersRound}
            title={group.name}
            subtitle={subtitle || undefined}
            latticeId={`group-hero-${group.id}`}
            badges={
              <>
                <HeroBadge tone={group.state === "RUNNING" ? "gold" : "plain"}>{t(`state.${group.state}`)}</HeroBadge>
                <HeroBadge>
                  {group.capacity !== null
                    ? look
                      ? isolateFractions(t("seatsOf", { count: group.member_count, capacity: group.capacity }))
                      : t("seatsOf", { count: group.member_count, capacity: group.capacity })
                    : t("students", { count: group.member_count })}
                </HeroBadge>
                <HeroBadge>{t(`mode.${group.mode}`)}</HeroBadge>
                {centre && group.lessons_planned != null && (
                  <HeroBadge>
                    <span data-testid="group-progress" title={tTerm("progressTitle")}>
                      {tTerm("progress", { held: group.lessons_held ?? 0, planned: group.lessons_planned })}
                    </span>
                  </HeroBadge>
                )}
                {centre && group.state === "RUNNING" && group.ends_in_days != null && group.ends_in_days >= 0 && (
                  <HeroBadge tone={group.ending_soon ? "gold" : "plain"}>
                    <span data-testid="group-ends-in">{tTerm("endsIn", { days: group.ends_in_days })}</span>
                  </HeroBadge>
                )}
              </>
            }
            actions={
              canManage ? (
                <>
                  {group.status === "ACTIVE" && (
                    <Button type="button" variant="secondary" className="gap-1.5" onClick={() => setEditing(true)} data-testid="group-edit">
                      <Pencil className="size-4" />
                      {t("detail.edit")}
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <button
                        type="button"
                        aria-label={t("lessons.more")}
                        className="inline-flex size-9 items-center justify-center rounded-lg bg-white/15 text-white hover:bg-white/25"
                      >
                        <Ellipsis className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {group.status === "ACTIVE" ? (
                        <DropdownMenuItem onClick={() => setConfirm("archive")}>
                          <Archive className="size-4" />
                          {t("detail.archive")}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onClick={() => void act("restore")}>
                          <ArchiveRestore className="size-4" />
                          {t("detail.restore")}
                        </DropdownMenuItem>
                      )}
                      {group.lessons.held === 0 && (
                        <DropdownMenuItem destructive onClick={() => setConfirm("delete")}>
                          <Trash2 className="size-4" />
                          {t("detail.delete")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : undefined
            }
          />
      )}

      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      {group.status === "ARCHIVED" && (
        <AlertBanner variant="info" message={centre && group.closed_reason ? tTerm(`archivedAs.${group.closed_reason}`, { word }) : t("detail.archivedBanner")} />
      )}
      {centre && group.continues_group_id && (
        <p className="text-muted-foreground text-sm">
          <Link href={`/groups/${group.continues_group_id}`} className="hover:text-foreground inline-flex items-center gap-1 hover:underline" data-testid="group-continues">
            <Repeat className="size-3.5" aria-hidden />
            {tTerm("continues", { name: group.continues_group_name ?? "…" })}
          </Link>
        </p>
      )}
      {centre && canManage && (group.state === "RUNNING" || group.state === "FINISHED") && (
        <CourseEndPanel
          group={group}
          onClosed={(g) => {
            setGroup(g);
            setNotice(tTerm("close.done"));
          }}
        />
      )}

      {look ? (
        <div className="centre-surface bg-card no-scrollbar flex gap-1 overflow-x-auto rounded-2xl border p-1.5" role="tablist">
          {tabs.map((key) => {
            const Icon = TAB_ICONS[key];
            const on = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(key)}
                className={cn(
                  "focus-visible:ring-ring/50 inline-flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-sm font-bold transition-colors outline-none focus-visible:ring-2",
                  on ? "centre-button-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                data-testid={`group-tab-${key}`}
              >
                <Icon className="size-4" aria-hidden />
                {CENTRE_TABS.includes(key) ? tg(`tabs.${key}`) : t(`detail.tabs.${key}`)}
                {key === "lessons" && group.lessons.overdue > 0 && (
                  <span className="rounded-full bg-rose-500 px-1.5 text-xs font-bold text-white tabular-nums">{group.lessons.overdue}</span>
                )}
                {key === "members" && (
                  <span className={cn("rounded-full px-1.5 text-xs font-bold tabular-nums", on ? "bg-white/20" : "bg-muted")}>{group.member_count}</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
          <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto border-b px-1" role="tablist">
            {tabs.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  tab === key ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground border-transparent",
                )}
                data-testid={`group-tab-${key}`}
              >
                {CENTRE_TABS.includes(key) ? tg(`tabs.${key}`) : t(`detail.tabs.${key}`)}
                {key === "lessons" && group.lessons.overdue > 0 && (
                  <span className="ms-1.5 rounded-full bg-rose-500 px-1.5 text-xs font-bold text-white tabular-nums">{group.lessons.overdue}</span>
                )}
                {key === "members" && <span className="ms-1.5 tabular-nums opacity-70">{group.member_count}</span>}
              </button>
            ))}
          </div>
      )}

      {tab === "lessons" && <GroupLessonsPanel group={group} onChanged={() => void load()} />}
      {tab === "members" && (
        <>
          <GroupMembersPanel group={group} onChanged={setGroup} />
          {centre && <WaitlistPanel group={group} onGroupChanged={setGroup} />}
        </>
      )}
      {tab === "grades" && <GradeSheet groupId={group.id} />}
      {tab === "reports" && <TermReportsPanel groupId={group.id} />}
      {tab === "money" && <GroupMoneyPanel group={group} />}
      {tab === "accounts" && <GroupAccountsPanel group={group} />}
      {tab === "overview" && <GroupOverview group={group} />}

      <Modal open={editing} onClose={() => setEditing(false)} title={t("detail.editTitle")} size={look ? "xl" : "lg"}>
        {editing && (
          <GroupForm
            group={group}
            onCancel={() => setEditing(false)}
            onSaved={(g) => {
              setGroup(g);
              setEditing(false);
              setNotice(t("detail.saved"));
            }}
          />
        )}
      </Modal>

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "delete" ? t("detail.deleteTitle") : t("detail.archiveTitle")}
        description={confirm === "delete" ? t("detail.deleteHint") : t("detail.archiveHint")}
      >
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => setConfirm(null)} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => confirm && void act(confirm)}
            data-testid="group-confirm"
          >
            {confirm === "delete" ? t("detail.deleteConfirm") : t("detail.archiveConfirm")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function Fact({
  icon: Icon,
  label,
  look,
  tone = "violet",
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  look?: boolean;
  tone?: PastelTone;
  children: ReactNode;
}) {
  if (look) {
    return (
      <div className="centre-surface bg-card flex items-start gap-3 rounded-2xl border p-4">
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", PASTEL[tone])}>
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-semibold">{label}</p>
          <div className="mt-0.5 text-sm font-bold break-words">{children}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-xl border p-3">
      <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs">{label}</p>
        <div className="text-sm font-medium break-words">{children}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={cn("mt-1 text-xl font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

/** The teacher's pay rule in words: "60.00 EGP per lesson", "40% of what the group bills". */
function teacherPayLabel(group: GroupDetail, t: ReturnType<typeof useTranslations<"groups">>, locale: string): string {
  const pay = group.teacher_pay;
  if (!pay || pay.mode === null) return t("money.payMode.DEFAULT");
  if (pay.mode === "REVENUE_SHARE") return t("moneyTab.payRule.REVENUE_SHARE", { pct: (pay.share_bp ?? 0) / 100 });
  const amount = pay.amount_minor != null && pay.currency ? formatMoney({ amount: pay.amount_minor, currency: pay.currency }, locale) : "—";
  return t(`moneyTab.payRule.${pay.mode}`, { amount });
}

function GroupOverview({ group }: { group: GroupDetail }) {
  const t = useTranslations("groups");
  const tw = useTranslations("scheduling");
  const locale = useLocale();
  // A centre reads a month sold by time in lessons.
  const centre = useCapability("centre");
  // A centre's page already opens on these four numbers.
  const look = useCentreLook();

  return (
    <div className="space-y-4" data-testid="group-overview">
      {!look && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("overview.attendance")} value={percent(group.attendance_rate)} />
          <Stat label={t("overview.held")} value={group.lessons.held} />
          <Stat label={t("overview.upcoming")} value={group.lessons.upcoming} />
          <Stat
            label={t("overview.overdue")}
            value={group.lessons.overdue}
            tone={group.lessons.overdue > 0 ? "text-rose-600 dark:text-rose-400" : undefined}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Fact look={look} tone="violet" icon={GraduationCap} label={t("form.teacher")}>
          {group.teacher_name ?? "—"}
        </Fact>
        <Fact look={look} tone="sky" icon={CalendarDays} label={t("overview.dates")}>
          {group.end_date ? t("overview.fromTo", { from: group.start_date, to: group.end_date }) : t("overview.from", { from: group.start_date })}
        </Fact>
        <Fact look={look} tone="amber" icon={Clock} label={t("form.slots")}>
          <ul className="space-y-0.5">
            {sortSlots(group.slots).map((s) => (
              <li key={`${s.weekday}-${s.start_time_local}`}>
                {tw(`weekday.${s.weekday}`)} · {wallTime(s.start_time_local, locale)} · {t("minutes", { count: s.duration_minutes })}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-1 text-xs font-normal">{t("overview.timezone", { tz: group.timezone })}</p>
        </Fact>
        {group.pricing && (
          <Fact look={look} tone="emerald" icon={Wallet} label={t("money.studentPays")}>
            {group.pricing.price_minor != null && group.pricing.currency
              ? t(`moneyTab.rule.${pricingRuleKey(group.pricing, centre)}`, {
                  price: formatMoney({ amount: group.pricing.price_minor, currency: group.pricing.currency }, locale),
                  hours: hoursText(group.pricing.month_minutes ?? 0, locale),
                  lessons: monthLessons(group.pricing.month_minutes, group.slots),
                })
              : t("moneyTab.noPrice")}
          </Fact>
        )}
        {group.teacher_pay && (
          <Fact look={look} tone="pink" icon={Coins} label={t("money.teacherEarns")}>
            {teacherPayLabel(group, t, locale)}
          </Fact>
        )}
        {group.mode === "ONLINE" ? (
          <Fact look={look} tone="indigo" icon={Link2} label={t("form.meetingUrl")}>
            {group.effective_meeting_url ? (
              <a href={group.effective_meeting_url} target="_blank" rel="noopener noreferrer" className="text-primary break-all hover:underline" dir="ltr">
                {group.effective_meeting_url}
              </a>
            ) : (
              <span className="text-muted-foreground font-normal">{t("overview.noLink")}</span>
            )}
          </Fact>
        ) : (
          <Fact look={look} tone="indigo" icon={MapPin} label={t("form.location")}>
            {group.location ?? "—"}
          </Fact>
        )}
      </div>

      {group.notes &&
        (look ? (
          <Fact look tone="slate" icon={StickyNote} label={t("form.notes")}>
            <p className="font-medium whitespace-pre-line">{group.notes}</p>
          </Fact>
        ) : (
          <div className="rounded-xl border p-3">
            <p className="text-muted-foreground text-xs">{t("form.notes")}</p>
            <p className="mt-1 text-sm whitespace-pre-line">{group.notes}</p>
          </div>
        ))}
    </div>
  );
}
