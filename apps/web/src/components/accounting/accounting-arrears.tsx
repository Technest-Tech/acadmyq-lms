"use client";

import { AlarmClock, FileText, Loader2, MessageSquare, Search, Wallet } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Tile, dayLabel, waLink } from "@/components/accounting/accounting-ui";
import { CollectModal, type CollectTarget } from "@/components/accounting/collect-modal";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHero } from "@/components/ui/page-hero";
import { AGE_BUCKETS, getArrears, remindPayer, type AgeBucket, type Arrears, type ArrearsPayer } from "@/lib/accounting-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type BucketFilter = AgeBucket | "overdue" | "";

const BUCKET_TONE: Record<AgeBucket, string> = {
  d0_30: "",
  d31_60: "text-amber-700 dark:text-amber-300",
  d61_90: "text-orange-700 dark:text-orange-300",
  d90_plus: "text-rose-700 dark:text-rose-300",
};

/**
 * Who owes the academy (المتأخرات, docs/groups/01-ACCOUNTING.md): every family with an unpaid
 * balance, biggest first, aged by how long each charge has been due (0–30 / 31–60 / 61–90 / 90+
 * days), with their children, groups and last payment. From a row: collect, send a WhatsApp
 * reminder of exactly what is owed, or open their statement.
 */
export function AccountingArrearsScreen() {
  const t = useTranslations("accounting");
  const locale = useLocale();
  const search = useSearchParams();
  const initialBucket = search.get("bucket");

  const [bucket, setBucket] = useState<BucketFilter>(
    initialBucket && (["overdue", ...AGE_BUCKETS] as string[]).includes(initialBucket) ? (initialBucket as BucketFilter) : "",
  );
  const [groupId, setGroupId] = useState("");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [data, setData] = useState<Arrears | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collect, setCollect] = useState<CollectTarget | null>(null);
  const [reminding, setReminding] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const load = useCallback(async () => {
    try {
      setData(await getArrears({ bucket, group_id: groupId || undefined, q: term || undefined }));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, t("arrears.loadFailed")));
    }
  }, [bucket, groupId, term, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);
  const payerParam = (p: ArrearsPayer) => (p.kind === "GUARDIAN" ? { guardian_id: p.id } : { student_id: p.id });

  async function remind(p: ArrearsPayer) {
    if (!p.id) return;
    setReminding(p.id);
    setNotice(null);
    try {
      const res = await remindPayer(payerParam(p));
      if (res.sent) setNotice(t("collect.sent", { phone: res.phone ?? "" }));
      else if (res.phone) window.open(waLink(res.phone, res.message), "_blank", "noopener,noreferrer");
      else setNotice(t("collect.noPhone"));
    } catch (err) {
      setNotice(apiErrorMessage(err, t("arrears.remindFailed")));
    } finally {
      setReminding(null);
    }
  }

  const ageDays = (date: string | null) => {
    if (!date || !data) return null;
    return Math.max(0, Math.round((Date.parse(data.today) - Date.parse(date)) / 86_400_000));
  };

  return (
    <div className="space-y-5" data-testid="accounting-arrears">
      <PageHero icon={AlarmClock} title={t("arrears.title")} subtitle={t("arrears.subtitle")} latticeId="accounting-arrears-hero" />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar flex gap-1 overflow-x-auto" role="tablist">
          {(["", "overdue", ...AGE_BUCKETS] as BucketFilter[]).map((b) => (
            <button
              key={b || "all"}
              type="button"
              role="tab"
              aria-selected={bucket === b}
              onClick={() => setBucket(b)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                bucket === b ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
              data-testid={`arrears-bucket-${b || "all"}`}
            >
              {b === "" ? t("arrears.all") : b === "overdue" ? t("arrears.overdueOnly") : t(`bucket.${b}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:w-[30rem]">
          <select className={fieldClass} value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label={t("arrears.group")}>
            <option value="">{t("arrears.allGroups")}</option>
            {(data?.groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          <span className="relative block">
            <Search className="text-muted-foreground pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2" aria-hidden />
            <input className={cn(fieldClass, "ps-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("arrears.search")} />
          </span>
        </div>
      </div>

      {error && <AlertBanner variant="error" message={error} />}
      {notice && <AlertBanner variant="info" message={notice} onDismiss={() => setNotice(null)} />}

      {data?.totals.map((tot) => (
        <div key={tot.currency} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6" data-testid={`arrears-totals-${tot.currency}`}>
          <Tile label={t("arrears.totalOwed")} value={money(tot.due_minor, tot.currency)} tone="text-rose-600 dark:text-rose-400" hint={t("overview.payers", { count: tot.payers })} />
          <Tile label={t("overview.overdue")} value={money(tot.overdue_minor, tot.currency)} tone={tot.overdue_minor > 0 ? "text-amber-600 dark:text-amber-400" : undefined} hint={t("overview.overdueHint")} />
          {AGE_BUCKETS.map((b) => (
            <Tile key={b} label={t(`bucket.${b}`)} value={money(tot[b], tot.currency)} tone={tot[b] > 0 ? BUCKET_TONE[b] : undefined} />
          ))}
        </div>
      ))}

      {data && data.payers.length === 0 && (
        <p className="text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">{t("arrears.empty")}</p>
      )}

      {data && data.payers.length > 0 && (
        <ul className="space-y-2" data-testid="arrears-list">
          {data.payers.map((p) => {
            const age = ageDays(p.oldest_due);
            return (
              <li key={`${p.kind}-${p.id}`} className="rounded-xl border p-3" data-testid={`arrears-${p.id}`}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold break-words">{p.name ?? "—"}</p>
                    <p className="text-muted-foreground text-xs break-words">
                      {[p.students.join("، "), p.groups.join(" · ")].filter(Boolean).join(" — ")}
                    </p>
                    <p className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                      {p.phone && <span dir="ltr">{p.phone}</span>}
                      {p.oldest_due && (
                        <span className={cn(age !== null && age > 60 && "font-semibold text-rose-700 dark:text-rose-300")}>
                          {t("arrears.oldest", { date: dayLabel(p.oldest_due, locale), days: age ?? 0 })}
                        </span>
                      )}
                      <span>
                        {p.last_receipt
                          ? t("arrears.lastPaid", { date: dayLabel(p.last_receipt.received_on, locale), amount: money(p.last_receipt.amount_minor, p.last_receipt.currency) })
                          : t("arrears.neverPaid")}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 lg:items-end">
                    {p.balances.map((b) => (
                      <div key={b.currency} className="lg:text-end">
                        <p className="text-lg font-bold text-rose-600 tabular-nums dark:text-rose-400">{money(b.due_minor, b.currency)}</p>
                        <p className="text-muted-foreground flex flex-wrap gap-x-2 text-xs tabular-nums lg:justify-end">
                          {AGE_BUCKETS.filter((k) => b[k] > 0).map((k) => (
                            <span key={k} className={BUCKET_TONE[k]}>
                              {t(`bucketShort.${k}`)}: {money(b[k], b.currency)}
                            </span>
                          ))}
                        </p>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-1.5">
                      {data.can_collect && p.id && (
                        <Button type="button" size="sm" className="gap-1" onClick={() => setCollect(payerParam(p))} data-testid={`arrears-collect-${p.id}`}>
                          <Wallet className="size-3.5" aria-hidden />
                          {t("sheet.collect")}
                        </Button>
                      )}
                      {data.can_remind && p.id && (
                        <Button type="button" size="sm" variant="outline" className="gap-1" onClick={() => void remind(p)} disabled={reminding === p.id}>
                          {reminding === p.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <MessageSquare className="size-3.5" aria-hidden />}
                          {t("arrears.remind")}
                        </Button>
                      )}
                      {p.id && (
                        <Link
                          href={`/accounting/statement?${p.kind === "GUARDIAN" ? "guardian_id" : "student_id"}=${p.id}`}
                          className="hover:bg-muted inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[0.8rem] font-medium"
                        >
                          <FileText className="size-3.5" aria-hidden />
                          {t("arrears.statement")}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CollectModal open={collect !== null} target={collect} onClose={() => setCollect(null)} onRecorded={() => void load()} />
    </div>
  );
}
