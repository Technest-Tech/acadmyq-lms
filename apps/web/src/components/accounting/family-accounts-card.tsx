"use client";

import {
  AlarmClock,
  Ban,
  BellRing,
  CalendarClock,
  FileText,
  GraduationCap,
  Hourglass,
  Layers,
  Loader2,
  MessageSquare,
  NotebookPen,
  Percent,
  PiggyBank,
  Plus,
  Receipt,
  Send,
  Trash2,
  UserRound,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MethodBadge, Panel, Tile, dayLabel, waLink } from "@/components/accounting/accounting-ui";
import { CollectModal, type CollectTarget } from "@/components/accounting/collect-modal";
import { RenewalPolicyControl } from "@/components/accounting/renewal-policy-control";
import { ReceiptDetailModal } from "@/components/accounting/receipt-detail-modal";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  addFamilyDiscount,
  addFamilyNote,
  deleteFamilyNote,
  endFamilyDiscount,
  getFamilyAccount,
  remindPayer,
  setFamilyRenewalPolicy,
  type DiscountKind,
  type DiscountScope,
  type FamilyAccount,
  type FamilyCharge,
  type FamilyDiscount,
  type FamilyEvent,
} from "@/lib/accounting-api";
import { useCapability } from "@/lib/capabilities";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Source = "ALL" | FamilyCharge["source"];

/**
 * The family card's money (docs/groups/01-ACCOUNTING.md) — on the family's own page, for an academy
 * on receipts. One place for a family: what it owes (and how old), the credit it holds, what it
 * paid this year, each child with what they are enrolled in and what is open on them, every open
 * charge with where it comes from (a group, private lessons), and the timeline — receipts,
 * reminders, bills sent and the desk's follow-up notes, promises to pay included.
 *
 * Renders NOTHING for an academy without `accounting` (no request is made either), so every other
 * academy's family page is exactly what it was.
 */
export function FamilyAccountsCard({ guardianId }: { guardianId: string }) {
  const { can } = useAuth();
  const accounting = useCapability("accounting");
  if (!accounting || !can("invoice.read")) return null;
  return <FamilyAccounts guardianId={guardianId} />;
}

function FamilyAccounts({ guardianId }: { guardianId: string }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [data, setData] = useState<FamilyAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("ALL");
  const [collect, setCollect] = useState<CollectTarget | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reminding, setReminding] = useState(false);
  const [note, setNote] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getFamilyAccount(guardianId));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("family.loadFailed")));
    }
  }, [guardianId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  const charges = useMemo(() => (data?.charges ?? []).filter((c) => source === "ALL" || c.source === source), [data, source]);
  const sources = useMemo(() => new Set((data?.charges ?? []).map((c) => c.source)), [data]);
  const guardianOwes = (data?.charges ?? []).some((c) => c.payer_kind === "GUARDIAN");

  async function remind() {
    setReminding(true);
    setNotice(null);
    try {
      const res = await remindPayer({ guardian_id: guardianId });
      if (res.sent) setNotice(t("collect.sent", { phone: res.phone ?? "" }));
      else if (res.phone) window.open(waLink(res.phone, res.message), "_blank", "noopener,noreferrer");
      else setNotice(t("collect.noPhone"));
      void load();
    } catch (err) {
      setNotice(apiErrorMessage(err, t("arrears.remindFailed")));
    } finally {
      setReminding(false);
    }
  }

  async function saveNote(e: React.FormEvent) {
    e.preventDefault();
    if (note.trim().length < 2) return;
    setSavingNote(true);
    try {
      await addFamilyNote(guardianId, note.trim(), followUp || null);
      setNote("");
      setFollowUp("");
      await load();
    } catch (err) {
      setNotice(apiErrorMessage(err, t("family.noteFailed")));
    } finally {
      setSavingNote(false);
    }
  }

  async function removeNote(id: string) {
    try {
      await deleteFamilyNote(guardianId, id);
      await load();
    } catch (err) {
      setNotice(apiErrorMessage(err, t("family.noteFailed")));
    }
  }

  if (error) return <AlertBanner variant="error" message={error} />;
  if (!data) {
    return <div className="bg-card h-40 animate-pulse rounded-2xl border shadow-sm" aria-label={t("family.title")} />;
  }

  const owes = data.balance.filter((b) => b.due_minor > 0);

  return (
    <section className="space-y-4" data-testid="family-accounts">
      <div className="from-primary/[0.08] via-card to-card bg-card rounded-2xl border bg-gradient-to-br p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold">
            <span className="bg-primary/12 text-primary ring-primary/25 flex size-9 items-center justify-center rounded-xl ring-1">
              <Wallet className="size-4" aria-hidden />
            </span>
            {t("family.title")}
          </h2>
          <div className="flex flex-wrap gap-2">
            {data.can_collect && guardianOwes && (
              <Button type="button" className="gap-1.5" onClick={() => setCollect({ guardian_id: guardianId })} data-testid="family-collect">
                <Wallet className="size-4" aria-hidden />
                {t("sheet.collect")}
              </Button>
            )}
            {data.can_remind && owes.length > 0 && (
              <Button type="button" variant="outline" className="gap-1.5" onClick={() => void remind()} disabled={reminding}>
                {reminding ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MessageSquare className="size-4" aria-hidden />}
                {t("arrears.remind")}
              </Button>
            )}
            <Link href={`/accounting/statement?guardian_id=${guardianId}`} className="hover:bg-muted inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium">
              <FileText className="size-4" aria-hidden />
              {t("arrears.statement")}
            </Link>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(owes.length > 0 ? owes : data.balance.slice(0, 1)).map((b) => (
            <Tile key={`due-${b.currency}`} label={t("family.owes")} value={money(b.due_minor, b.currency)} icon={AlarmClock} accent={b.due_minor > 0 ? "rose" : "emerald"} tone={b.due_minor > 0 ? "text-rose-600 dark:text-rose-400" : undefined} />
          ))}
          {owes.length === 0 && data.balance.length === 0 && <Tile label={t("family.owes")} value={t("family.settled")} icon={AlarmClock} accent="emerald" />}
          {data.balance.map((b) => (
            <Tile key={`over-${b.currency}`} label={t("overview.overdue")} value={money(b.overdue_minor, b.currency)} icon={Hourglass} accent="amber" hint={t("overview.overdueHint")} />
          ))}
          {data.balance.filter((b) => b.credit_minor > 0).map((b) => (
            <Tile key={`credit-${b.currency}`} label={t("overview.credit")} value={money(b.credit_minor, b.currency)} icon={PiggyBank} accent="violet" />
          ))}
          {data.paid_this_year.map((p) => (
            <Tile
              key={`paid-${p.currency}`}
              label={t("family.paidThisYear")}
              value={money(p.amount_minor, p.currency)}
              icon={Receipt}
              accent="emerald"
              hint={data.last_receipt ? t("family.lastPaid", { date: dayLabel(data.last_receipt.received_on, locale) }) : undefined}
            />
          ))}
        </div>

        <div className="mt-4 border-t pt-3">
          <RenewalPolicyControl
            value={data.family.renewal_policy ?? "FREE"}
            canEdit={data.can_collect}
            onChange={async (policy) => {
              await setFamilyRenewalPolicy(guardianId, policy);
              await load();
            }}
          />
        </div>

        {data.next_follow_up && (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 text-sm">
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
            <span>
              <span className="font-semibold">{t("family.followUp", { date: dayLabel(data.next_follow_up.date, locale) })}</span> — {data.next_follow_up.body}
            </span>
          </p>
        )}
      </div>

      {notice && <AlertBanner variant="info" message={notice} onDismiss={() => setNotice(null)} />}

      {/* The children and what each is in */}
      <Panel title={t("family.children")} icon={UserRound} accent="violet">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {data.children.map((c) => (
            <div key={c.id} className="bg-muted/30 rounded-xl border p-3" data-testid={`family-child-${c.id}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold break-words">{c.name}</p>
                <div className="text-end">
                  {c.due.length === 0 ? (
                    <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{t("family.nothingDue")}</span>
                  ) : (
                    c.due.map((d) => (
                      <p key={d.currency} className="text-sm font-bold text-rose-600 tabular-nums dark:text-rose-400">
                        {money(d.due_minor, d.currency)}
                      </p>
                    ))
                  )}
                </div>
              </div>
              <ul className="mt-2 space-y-1.5 text-sm">
                {c.groups.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-1.5">
                    <Layers className="text-primary size-3.5 shrink-0" aria-hidden />
                    <Link href={`/groups/${g.id}?tab=accounts`} className="font-medium hover:underline">
                      {g.name}
                    </Link>
                    <span className="text-muted-foreground text-xs">
                      {[g.teacher_name, g.price_minor !== null && g.currency ? t(`sheet.rule.${g.billing_mode as "MONTHLY" | "PER_LESSON" | "COURSE"}`, { price: money(g.price_minor, g.currency) }) : null].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
                {c.private && (
                  <li className="flex flex-wrap items-center gap-1.5">
                    <GraduationCap className="size-3.5 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
                    <span className="font-medium">{t("family.privateLessons")}</span>
                    <span className="text-muted-foreground text-xs">
                      {[c.private.plan_label, money(c.private.price_minor, c.private.currency), c.private.teachers.join("، ")].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                )}
                {c.groups.length === 0 && !c.private && <li className="text-muted-foreground text-xs">{t("family.notEnrolled")}</li>}
              </ul>
              {data.can_collect && c.due.length > 0 && (
                <div className="mt-2 flex justify-end">
                  <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => setCollect({ student_id: c.id })}>
                    <Wallet className="size-3.5" aria-hidden />
                    {t("family.collectFor", { name: c.name })}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>

      {/* Open charges */}
      <Panel
        title={t("family.openCharges")}
        icon={AlarmClock}
        accent="rose"
        action={
          sources.size > 1 ? (
            <div className="no-scrollbar flex gap-1 overflow-x-auto" role="tablist">
              {(["ALL", "GROUP", "PRIVATE", "OTHER"] as Source[])
                .filter((s) => s === "ALL" || sources.has(s as FamilyCharge["source"]))
                .map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="tab"
                    aria-selected={source === s}
                    onClick={() => setSource(s)}
                    className={cn("shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold", source === s ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}
                    data-testid={`family-source-${s}`}
                  >
                    {t(`family.source.${s}`)}
                  </button>
                ))}
            </div>
          ) : undefined
        }
      >
        {charges.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">{t("family.noCharges")}</p>
        ) : (
          <ul className="divide-y" data-testid="family-charges">
            {charges.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">{c.description}</p>
                  <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={cn("rounded px-1.5 py-0.5 font-semibold", c.source === "GROUP" ? "bg-primary/10 text-primary" : c.source === "PRIVATE" ? "bg-violet-500/10 text-violet-700 dark:text-violet-300" : "bg-muted")}>
                      {c.group_name ?? t(`family.source.${c.source}`)}
                    </span>
                    {c.student_name && <span>{c.student_name}</span>}
                    <span>{dayLabel(c.date, locale)}</span>
                    {c.paid_minor > 0 && <span className="text-amber-700 dark:text-amber-300">{t("collect.partlyPaid", { paid: money(c.paid_minor, c.currency), of: money(c.amount_minor, c.currency) })}</span>}
                    {c.discount_minor > 0 && c.list_amount_minor !== null && (
                      <span className="text-violet-700 dark:text-violet-300" data-testid={`charge-discount-${c.id}`}>
                        {t("family.wasPrice", { list: money(c.list_amount_minor, c.currency), discount: money(c.discount_minor, c.currency), label: c.discount_label ?? "" })}
                      </span>
                    )}
                  </p>
                </div>
                <span className="shrink-0 font-semibold text-rose-600 tabular-nums dark:text-rose-400">{money(c.remaining_minor, c.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Standing discounts: visible entries with a reason and who gave them, never a quietly lower price. */}
      <DiscountsPanel data={data} guardianId={guardianId} onChanged={() => void load()} onNotice={setNotice} />

      {/* Timeline + notes */}
      <Panel title={t("family.timeline")} icon={NotebookPen} accent="sky">
        {data.can_note && (
          <form onSubmit={(e) => void saveNote(e)} className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]" data-testid="family-note-form">
            <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("family.notePlaceholder")} maxLength={2000} />
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <CalendarClock className="size-4 shrink-0" aria-hidden />
              <input type="date" className={cn(fieldClass, "w-40")} value={followUp} min={data.today} onChange={(e) => setFollowUp(e.target.value)} aria-label={t("family.followUpOn")} />
            </label>
            <Button type="submit" className="gap-1.5" disabled={savingNote || note.trim().length < 2}>
              {savingNote ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              {t("family.addNote")}
            </Button>
          </form>
        )}
        {data.timeline.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">{t("family.noEvents")}</p>
        ) : (
          <ol className="border-border space-y-3 border-s ps-4" data-testid="family-timeline">
            {data.timeline.map((e) => (
              <TimelineItem key={`${e.kind}-${e.id}`} event={e} money={money} onReceipt={setReceiptId} onDelete={(id) => void removeNote(id)} />
            ))}
          </ol>
        )}
      </Panel>

      <CollectModal open={collect !== null} target={collect} onClose={() => setCollect(null)} onRecorded={() => void load()} />
      <ReceiptDetailModal receiptId={receiptId} onClose={() => setReceiptId(null)} onChanged={() => void load()} />
    </section>
  );
}

function TimelineItem({
  event: e,
  money,
  onReceipt,
  onDelete,
}: {
  event: FamilyEvent;
  money: (a: number, c: string) => string;
  onReceipt: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const dot = {
    RECEIPT: "bg-emerald-500",
    REMINDER: "bg-amber-500",
    BILL_SENT: "bg-sky-500",
    NOTE: "bg-violet-500",
  }[e.kind];
  const Icon = { RECEIPT: Receipt, REMINDER: BellRing, BILL_SENT: Send, NOTE: NotebookPen }[e.kind];

  return (
    <li className="relative">
      <span className={cn("ring-card absolute -start-[1.4rem] top-1.5 size-2.5 rounded-full ring-4", dot)} aria-hidden />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="flex flex-wrap items-center gap-1.5 font-medium">
            <Icon className="text-muted-foreground size-3.5" aria-hidden />
            {e.kind === "RECEIPT" && (
              <button type="button" onClick={() => onReceipt(e.id)} className={cn("hover:underline", e.voided && "line-through opacity-60")}>
                {t("family.event.RECEIPT", { number: e.number, amount: money(e.amount_minor, e.currency) })}
              </button>
            )}
            {e.kind === "RECEIPT" && <MethodBadge method={e.method} />}
            {e.kind === "RECEIPT" && e.voided && <span className="text-xs text-rose-700 dark:text-rose-300">{t("family.voided", { reason: e.void_reason ?? "" })}</span>}
            {e.kind === "REMINDER" && t("family.event.REMINDER")}
            {e.kind === "BILL_SENT" && t("family.event.BILL_SENT", { period: e.period, amount: money(e.amount_minor, e.currency) })}
            {e.kind === "NOTE" && <span className="font-normal break-words whitespace-pre-line">{e.body}</span>}
          </p>
          <p className="text-muted-foreground text-xs">
            {dayLabel(e.date, locale)}
            {"by" in e && e.by ? ` · ${e.by}` : ""}
            {e.kind === "NOTE" && e.follow_up_on && <span className="ms-1.5 font-semibold text-sky-700 dark:text-sky-300">· {t("family.followUp", { date: dayLabel(e.follow_up_on, locale) })}</span>}
          </p>
        </div>
        {e.kind === "NOTE" && e.mine && (
          <button type="button" onClick={() => onDelete(e.id)} className="text-muted-foreground hover:text-destructive rounded p-1" aria-label={t("family.deleteNote")}>
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * The family's discounts (docs/groups/01-ACCOUNTING.md, F2): each one a percentage or a fixed
 * amount off every charge — for the whole family or one child, on everything or only group /
 * private charges — with the reason and who gave it. They apply to charges raised from today;
 * ending one stops it today and leaves what it already took on the lines it touched.
 */
function DiscountsPanel({ data, guardianId, onChanged, onNotice }: { data: FamilyAccount; guardianId: string; onChanged: () => void; onNotice: (m: string | null) => void }) {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<DiscountKind>("PERCENT");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<DiscountScope>("ALL");
  const [studentId, setStudentId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  const currency = data.balance[0]?.currency ?? data.charges[0]?.currency ?? "EGP";
  const groups = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of data.children) for (const g of c.groups) seen.set(g.id, g.name);
    return [...seen.entries()];
  }, [data.children]);

  const valueNumber = Number.parseFloat(value.replace(",", "."));
  const valid = label.trim().length > 0 && Number.isFinite(valueNumber) && valueNumber > 0 && (kind !== "PERCENT" || valueNumber <= 100);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      await addFamilyDiscount(guardianId, {
        kind,
        value: kind === "PERCENT" ? Math.round(valueNumber) : Math.round(valueNumber * 100),
        label: label.trim(),
        scope,
        student_id: studentId || null,
        class_group_id: scope === "GROUP" && groupId ? groupId : null,
      });
      setAdding(false);
      setValue("");
      setLabel("");
      setScope("ALL");
      setStudentId("");
      setGroupId("");
      onNotice(t("family.discountSaved"));
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, t("family.discountFailed")));
    } finally {
      setBusy(false);
    }
  }

  async function end(id: string) {
    try {
      await endFamilyDiscount(guardianId, id);
      onChanged();
    } catch (err) {
      onNotice(apiErrorMessage(err, t("family.discountFailed")));
    }
  }

  const describe = (d: FamilyDiscount) =>
    d.kind === "PERCENT" ? `${d.value / 100}%` : money(d.value, currency);

  return (
    <Panel
      title={t("family.discounts")}
      icon={Percent}
      accent="violet"
      testId="family-discounts"
      action={
        data.can_collect && !adding ? (
          <Button type="button" size="xs" variant="ghost" className="gap-1" onClick={() => setAdding(true)} data-testid="discount-add">
            <Plus className="size-3.5" aria-hidden />
            {t("family.addDiscount")}
          </Button>
        ) : undefined
      }
    >
      {adding && (
        <form onSubmit={(e) => void save(e)} className="bg-muted/30 mb-4 space-y-3 rounded-xl border p-3" data-testid="discount-form">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-muted-foreground text-xs">
              {t("family.discountKind.PERCENT")} / {t("family.discountKind.FIXED")}
              <select className={cn(fieldClass, "mt-1")} value={kind} onChange={(e) => setKind(e.target.value as DiscountKind)} data-testid="discount-kind">
                <option value="PERCENT">{t("family.discountKind.PERCENT")}</option>
                <option value="FIXED">{t("family.discountKind.FIXED")}</option>
              </select>
            </label>
            <label className="text-muted-foreground text-xs">
              {kind === "PERCENT" ? t("family.discountValuePercent") : t("family.discountValueFixed")}
              <input className={cn(fieldClass, "mt-1")} inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "PERCENT" ? "10" : "100"} data-testid="discount-value" />
            </label>
            <label className="text-muted-foreground text-xs">
              {t("family.discountLabel")}
              <input className={cn(fieldClass, "mt-1")} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("family.discountLabelHint")} maxLength={80} data-testid="discount-label" />
            </label>
            <label className="text-muted-foreground text-xs">
              {t("family.discountFor")}
              <select className={cn(fieldClass, "mt-1")} value={studentId} onChange={(e) => setStudentId(e.target.value)} data-testid="discount-student">
                <option value="">{t("family.wholeFamily")}</option>
                {data.children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-muted-foreground text-xs">
              {t("family.source.ALL")}
              <select className={cn(fieldClass, "mt-1")} value={scope} onChange={(e) => setScope(e.target.value as DiscountScope)} data-testid="discount-scope">
                {(["ALL", "GROUP", "PRIVATE"] as DiscountScope[]).map((s) => (
                  <option key={s} value={s}>
                    {t(`family.discountScope.${s}`)}
                  </option>
                ))}
              </select>
            </label>
            {scope === "GROUP" && groups.length > 0 && (
              <label className="text-muted-foreground text-xs">
                {t("arrears.group")}
                <select className={cn(fieldClass, "mt-1")} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  <option value="">{t("family.discountGroupAny")}</option>
                  {groups.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {error && <AlertBanner variant="error" message={error} />}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)} disabled={busy}>
              {t("collect.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={busy || !valid} data-testid="discount-save">
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
              {t("family.addDiscount")}
            </Button>
          </div>
        </form>
      )}

      {data.discounts.length === 0 ? (
        <p className="text-muted-foreground py-3 text-center text-sm">{t("family.noDiscounts")}</p>
      ) : (
        <ul className="divide-y" data-testid="discount-list">
          {data.discounts.map((d) => (
            <li key={d.id} className={cn("flex flex-wrap items-center justify-between gap-2 py-2 text-sm", !d.active && "opacity-60")} data-testid={`discount-${d.id}`}>
              <div className="min-w-0">
                <p className="font-medium break-words">
                  <span className="text-violet-700 tabular-nums dark:text-violet-300">{describe(d)}</span> · {d.label}
                </p>
                <p className="text-muted-foreground text-xs">
                  {[d.student_name ?? t("family.wholeFamily"), d.scope === "ALL" ? null : (d.group_name ?? t(`family.discountScope.${d.scope}`)), d.by].filter(Boolean).join(" · ")}
                  {" · "}
                  {d.active ? t("family.since", { date: dayLabel(d.starts_on, locale) }) : t("family.ended", { date: dayLabel(d.ends_on ?? d.starts_on, locale) })}
                </p>
              </div>
              {d.active && data.can_collect && (
                <Button type="button" size="xs" variant="ghost" className="text-destructive gap-1" onClick={() => void end(d.id)} title={t("family.endDiscountHint")} data-testid={`discount-end-${d.id}`}>
                  <Ban className="size-3.5" aria-hidden />
                  {t("family.endDiscount")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
