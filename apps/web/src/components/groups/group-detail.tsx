"use client";

import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CalendarDays,
  Clock,
  Coins,
  Ellipsis,
  GraduationCap,
  Link2,
  MapPin,
  Pencil,
  Trash2,
  UsersRound,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useAuth } from "@/components/auth-provider";
import { GroupAccountsPanel } from "@/components/groups/group-accounts-panel";
import { GroupForm, apiErrorMessage } from "@/components/groups/group-form";
import { hoursText, percent, pricingRuleKey, sortSlots, wallTime } from "@/components/groups/group-format";
import { GroupLessonsPanel } from "@/components/groups/group-lessons-panel";
import { GroupMembersPanel } from "@/components/groups/group-members-panel";
import { GroupMoneyPanel } from "@/components/groups/group-money-panel";
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
import { useCapability } from "@/lib/capabilities";
import { archiveGroup, deleteGroup, getGroup, restoreGroup, type GroupDetail } from "@/lib/groups-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Tab = "lessons" | "members" | "money" | "accounts" | "overview";
const TABS: Tab[] = ["lessons", "members", "money", "accounts", "overview"];

/**
 * One group's page (docs/groups): its lessons (the default — that is where the daily work is),
 * its members, and an overview of the numbers. `?tab=members` deep-links straight to the members,
 * which is where a freshly created group sends the owner.
 */
export function GroupDetailScreen({ groupId }: { groupId: string }) {
  const t = useTranslations("groups");
  const { can } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const canManage = can("group.manage");
  // The money tab is the owner's view of the bills — never a supervisor's or a teacher's. An academy
  // on receipts (accounting) gets the collection sheet in its place.
  const accounting = useCapability("accounting");
  const tabs = TABS.filter((k) => {
    if (k === "money") return can("invoice.read") && !accounting;
    if (k === "accounts") return can("invoice.read") && accounting;
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
                ? t("seatsOf", { count: group.member_count, capacity: group.capacity })
                : t("students", { count: group.member_count })}
            </HeroBadge>
            <HeroBadge>{t(`mode.${group.mode}`)}</HeroBadge>
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

      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}
      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      {group.status === "ARCHIVED" && <AlertBanner variant="info" message={t("detail.archivedBanner")} />}

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
            {t(`detail.tabs.${key}`)}
            {key === "lessons" && group.lessons.overdue > 0 && (
              <span className="ms-1.5 rounded-full bg-rose-500 px-1.5 text-xs font-bold text-white tabular-nums">{group.lessons.overdue}</span>
            )}
            {key === "members" && <span className="ms-1.5 tabular-nums opacity-70">{group.member_count}</span>}
          </button>
        ))}
      </div>

      {tab === "lessons" && <GroupLessonsPanel group={group} onChanged={() => void load()} />}
      {tab === "members" && <GroupMembersPanel group={group} onChanged={setGroup} />}
      {tab === "money" && <GroupMoneyPanel group={group} />}
      {tab === "accounts" && <GroupAccountsPanel group={group} />}
      {tab === "overview" && <GroupOverview group={group} />}

      <Modal open={editing} onClose={() => setEditing(false)} title={t("detail.editTitle")} size="lg">
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

function Fact({ icon: Icon, label, children }: { icon: ComponentType<{ className?: string }>; label: string; children: ReactNode }) {
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

  return (
    <div className="space-y-4" data-testid="group-overview">
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Fact icon={GraduationCap} label={t("form.teacher")}>
          {group.teacher_name ?? "—"}
        </Fact>
        <Fact icon={CalendarDays} label={t("overview.dates")}>
          {group.end_date ? t("overview.fromTo", { from: group.start_date, to: group.end_date }) : t("overview.from", { from: group.start_date })}
        </Fact>
        <Fact icon={Clock} label={t("form.slots")}>
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
          <Fact icon={Wallet} label={t("money.studentPays")}>
            {group.pricing.price_minor != null && group.pricing.currency
              ? t(`moneyTab.rule.${pricingRuleKey(group.pricing)}`, {
                  price: formatMoney({ amount: group.pricing.price_minor, currency: group.pricing.currency }, locale),
                  hours: hoursText(group.pricing.month_minutes ?? 0, locale),
                })
              : t("moneyTab.noPrice")}
          </Fact>
        )}
        {group.teacher_pay && (
          <Fact icon={Coins} label={t("money.teacherEarns")}>
            {teacherPayLabel(group, t, locale)}
          </Fact>
        )}
        {group.mode === "ONLINE" ? (
          <Fact icon={Link2} label={t("form.meetingUrl")}>
            {group.effective_meeting_url ? (
              <a href={group.effective_meeting_url} target="_blank" rel="noopener noreferrer" className="text-primary break-all hover:underline" dir="ltr">
                {group.effective_meeting_url}
              </a>
            ) : (
              <span className="text-muted-foreground font-normal">{t("overview.noLink")}</span>
            )}
          </Fact>
        ) : (
          <Fact icon={MapPin} label={t("form.location")}>
            {group.location ?? "—"}
          </Fact>
        )}
      </div>

      {group.notes && (
        <div className="rounded-xl border p-3">
          <p className="text-muted-foreground text-xs">{t("form.notes")}</p>
          <p className="mt-1 text-sm whitespace-pre-line">{group.notes}</p>
        </div>
      )}
    </div>
  );
}
