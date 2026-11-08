"use client";

import { AlertTriangle, CircleDollarSign, Hourglass, Layers, Loader2, PackageCheck, Plus, Search, UserX } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { EmptyCard, PillTabs, StatCard } from "@/components/groups/group-look";
import { CloseSubscriptionModal } from "@/components/subscriptions/close-subscription-modal";
import { EditSubscriptionForm } from "@/components/subscriptions/edit-subscription-form";
import { SellSubscriptionForm } from "@/components/subscriptions/sell-subscription-form";
import { SubscriptionDetail } from "@/components/subscriptions/subscription-detail";
import { FamilySubscriptionGroup, groupByFamily, SubscriptionRowCard, type RowActions } from "@/components/subscriptions/subscription-row";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import { listTeachers } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { fetchRoster } from "@/lib/roster";
import {
  cancelSubscription,
  listSubscriptions,
  remindSubscription,
  type SubscriptionRow,
  type SubscriptionSummary,
  type SubscriptionView,
} from "@/lib/subscriptions-api";

export const SUBSCRIPTION_VIEWS: SubscriptionView[] = ["open", "due", "finished", "outside"];

type ModalState =
  | { kind: "sell"; studentId?: string; prefill?: SubscriptionRow }
  | { kind: "edit"; row: SubscriptionRow }
  | { kind: "close"; row: SubscriptionRow }
  | { kind: "cancel"; row: SubscriptionRow }
  | { kind: "detail"; row: SubscriptionRow }
  | { kind: "detailId"; id: string }
  | { kind: "remind"; row: SubscriptionRow; preview: string; sent: boolean };

/**
 * The centre's subscriptions page (docs/centre-profile/01, "Every surface"): four views of the same
 * table — open blocks, what is owed (grouped by family, the page the desk opens every morning),
 * finished blocks waiting for the next sale, and students taking lessons outside any block — with
 * the summary numbers over them and the sale, edit, close, cancel and reminder actions on each row.
 * Group memberships are not here: they live under each group's accounts, and the page says so.
 */
export function SubscriptionsManager({ view: initialView = "open" }: { view?: SubscriptionView }) {
  const t = useTranslations("subscriptions");
  const locale = useLocale();
  const { can, session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const canManage = can("package.manage");
  const canRemind = can("package.manage") || can("invoice.send_link");
  const isTeacher = session?.role === "TEACHER";

  const [view, setView] = useState<SubscriptionView>(() => {
    const fromUrl = search.get("view");
    return SUBSCRIPTION_VIEWS.includes(fromUrl as SubscriptionView) ? (fromUrl as SubscriptionView) : initialView;
  });
  const [q, setQ] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [teachers, setTeachers] = useState<{ value: string; label: string }[]>([]);
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<SubscriptionRow[] | null>(null);
  const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
  const [lastPage, setLastPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // `/subscriptions?open=<studentId>` opens the sell form with that student chosen (the profile's
  // door); `?id=<subscriptionId>` opens that block's detail (a bill line on the family's account).
  const [modal, setModal] = useState<ModalState | null>(() => {
    const open = search.get("open");
    const id = search.get("id");
    return open ? { kind: "sell", studentId: open } : id ? { kind: "detailId", id } : null;
  });

  useEffect(() => {
    if (isTeacher || !can("teacher.read")) return;
    void fetchRoster(listTeachers, { filter: { status: "active" } })
      .then((res) => setTeachers(res.rows.map((r) => ({ value: r.id, label: r.full_name }))))
      .catch(() => setTeachers([]));
  }, [isTeacher, can]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listSubscriptions({ view, q: q.trim() || undefined, teacher_id: teacherId || undefined, page });
      setRows(res.rows);
      setSummary(res.summary);
      setLastPage(res.meta?.last_page ?? 1);
    } catch (err) {
      setError(apiErrorMessage(err, t("loadFailed")));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [view, q, teacherId, page, t]);

  useEffect(() => {
    const id = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  function pickView(next: SubscriptionView) {
    setView(next);
    setPage(1);
    router.replace(`${pathname}?view=${next}`);
  }

  function done(message: string) {
    setModal(null);
    setNotice(message);
    void load();
  }

  async function remind(row: SubscriptionRow, kind: "PAYMENT" | "FINISHED") {
    try {
      const res = await remindSubscription(row.id, kind);
      setModal({ kind: "remind", row, preview: res.preview, sent: res.sent });
    } catch (err) {
      setError(apiErrorMessage(err, t("remind.failed")));
    }
  }

  const actions: RowActions = {
    onOpen: (row) => setModal({ kind: "detail", row }),
    onEdit: (row) => setModal({ kind: "edit", row }),
    onRenew: (row) => setModal({ kind: "sell", studentId: row.student.id, prefill: row }),
    onClose: (row) => setModal({ kind: "close", row }),
    onCancel: (row) => setModal({ kind: "cancel", row }),
    onRemind: (row, kind) => void remind(row, kind),
  };

  const outstanding = useMemo(() => (summary?.outstanding ?? []).map((o) => formatMoney({ amount: o.minor, currency: o.currency }, locale)).join(" · "), [summary, locale]);
  const families = useMemo(() => (view === "due" ? groupByFamily(rows ?? []) : []), [view, rows]);
  const tabs = SUBSCRIPTION_VIEWS.map((key) => ({
    key,
    label: t(`tabs.${key}`),
    badge: summary ? (key === "open" ? summary.open : key === "due" ? summary.due_count : key === "finished" ? summary.finished_unrenewed : summary.outside_students) : undefined,
    alert: key === "outside" && (summary?.outside_students ?? 0) > 0,
  }));

  return (
    <div className="space-y-4" data-testid="subscriptions-manager">
      <PageHero
        icon={Layers}
        title={t("title")}
        subtitle={t("subtitle")}
        latticeId="subscriptions-hero"
        actions={
          <>
            {summary && <HeroPill>{t("openCount", { count: summary.open })}</HeroPill>}
            {canManage && (
              <Button type="button" variant="secondary" className="hero-main-action gap-1.5" onClick={() => setModal({ kind: "sell" })} data-testid="subscriptions-sell">
                <Plus className="size-4" />
                {t("sell.action")}
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="subscriptions-stats">
        <StatCard icon={Layers} tone="violet" label={t("stats.open")} value={summary?.open ?? "—"} sub={summary ? t("stats.ending", { count: summary.ending }) : undefined} onClick={() => pickView("open")} testId="stat-open" />
        <StatCard icon={CircleDollarSign} tone="rose" label={t("stats.due")} value={summary?.due_count ?? "—"} sub={outstanding || undefined} onClick={() => pickView("due")} testId="stat-due" />
        <StatCard icon={PackageCheck} tone="amber" label={t("stats.finished")} value={summary?.finished_unrenewed ?? "—"} sub={t("stats.finishedHint")} onClick={() => pickView("finished")} testId="stat-finished" />
        <StatCard icon={UserX} tone="sky" label={t("stats.outside")} value={summary?.outside_students ?? "—"} sub={t("stats.outsideHint")} onClick={() => pickView("outside")} testId="stat-outside" />
      </div>

      <PillTabs tabs={tabs} value={view} onChange={pickView} testIdPrefix="subscriptions-tab" />

      <div className="centre-surface bg-card flex flex-col gap-2 rounded-2xl border p-3 lg:flex-row lg:items-center" data-testid="subscriptions-filters">
        <label className="relative block min-w-0 flex-1">
          <Search className="text-muted-foreground absolute top-1/2 size-4 -translate-y-1/2 ltr:left-3 rtl:right-3" />
          <input className={`${fieldClass} ps-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} />
        </label>
        {teachers.length > 0 && (
          <div className="min-w-0 lg:w-56">
            <Combobox options={[{ value: "", label: t("allTeachers") }, ...teachers]} value={teacherId} onChange={setTeacherId} placeholder={t("allTeachers")} searchPlaceholder={t("search")} data-testid="subscriptions-teacher" />
          </div>
        )}
      </div>

      {view === "open" && (
        <p className="text-muted-foreground flex items-center gap-2 px-1 text-xs" data-testid="subscriptions-groups-note">
          <Hourglass className="size-3.5 shrink-0" aria-hidden />
          <span>
            {t("groupsNote")}{" "}
            <Link href="/groups" className="text-primary font-semibold underline-offset-2 hover:underline">
              {t("groupsLink")}
            </Link>
          </span>
        </p>
      )}

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}

      {loading && rows === null ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label={t("loading")}>
          {[0, 1].map((i) => (
            <div key={i} className="bg-muted h-40 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : (rows ?? []).length === 0 ? (
        <EmptyCard
          icon={view === "outside" ? AlertTriangle : Layers}
          tone={view === "outside" ? "emerald" : "violet"}
          text={t(`empty.${view}`)}
          testId="subscriptions-empty"
          action={
            canManage && view === "open" ? (
              <Button type="button" className="gap-1.5" onClick={() => setModal({ kind: "sell" })}>
                <Plus className="size-4" />
                {t("sell.action")}
              </Button>
            ) : undefined
          }
        />
      ) : view === "due" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="subscriptions-families">
          {families.map((family) => (
            <FamilySubscriptionGroup key={family.key} family={family} canManage={canManage} canRemind={canRemind} actions={actions} />
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="subscriptions-list">
          {(rows ?? []).map((row) => (
            <SubscriptionRowCard key={row.id} row={row} canManage={canManage} canRemind={canRemind} actions={actions} />
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <div className="flex items-center justify-center gap-2" data-testid="subscriptions-pages">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            {t("prevPage")}
          </Button>
          <span className="text-muted-foreground text-xs tabular-nums">{t("pageOf", { page, pages: lastPage })}</span>
          <Button type="button" size="sm" variant="outline" disabled={page >= lastPage || loading} onClick={() => setPage((p) => p + 1)}>
            {t("nextPage")}
          </Button>
        </div>
      )}

      <Modal open={modal?.kind === "sell"} onClose={() => setModal(null)} title={modal?.kind === "sell" && modal.prefill ? t("sell.renewTitle", { name: modal.prefill.student.full_name }) : t("sell.title")} description={t("sell.description")} size="lg">
        {modal?.kind === "sell" && <SellSubscriptionForm initialStudentId={modal.studentId} prefill={modal.prefill} onSaved={done} onCancel={() => setModal(null)} />}
      </Modal>
      <Modal open={modal?.kind === "edit"} onClose={() => setModal(null)} title={modal?.kind === "edit" ? t("edit.title", { name: modal.row.student.full_name }) : ""} description={t("edit.description")} size="lg">
        {modal?.kind === "edit" && <EditSubscriptionForm row={modal.row} onSaved={done} onCancel={() => setModal(null)} />}
      </Modal>
      <CloseSubscriptionModal row={modal?.kind === "close" ? modal.row : null} onClose={() => setModal(null)} onDone={done} />
      {modal?.kind === "cancel" && <CancelSubscriptionModal row={modal.row} onClose={() => setModal(null)} onDone={done} />}
      <Modal open={modal?.kind === "detail" || modal?.kind === "detailId"} onClose={() => setModal(null)} title={modal?.kind === "detail" ? modal.row.label : t("detail.title")} size="lg">
        {modal?.kind === "detail" && <SubscriptionDetail id={modal.row.id} initial={modal.row} />}
        {modal?.kind === "detailId" && <SubscriptionDetail id={modal.id} />}
      </Modal>
      <Modal open={modal?.kind === "remind"} onClose={() => setModal(null)} title={t("remind.title")} size="sm" footer={<Button type="button" size="sm" onClick={() => setModal(null)}>{t("remind.ok")}</Button>}>
        {modal?.kind === "remind" && (
          <div className="space-y-2" data-testid="subscription-remind-preview">
            <p className="text-sm font-medium">{modal.sent ? t("remind.sent", { name: modal.row.student.full_name }) : t("remind.notSent", { name: modal.row.student.full_name })}</p>
            <p className="bg-muted/50 rounded-xl px-3 py-2 text-sm whitespace-pre-wrap">{modal.preview}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Void a block opened by mistake — its bill line goes with it (POST /subscriptions/{id}/cancel). */
export function CancelSubscriptionModal({ row, onClose, onDone }: { row: SubscriptionRow; onClose: () => void; onDone: (message: string) => void }) {
  const t = useTranslations("subscriptions.cancel");
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await cancelSubscription(row.id);
      const credited = res?.credited_minor ?? 0;
      onDone(credited > 0 ? t("doneCredited", { amount: formatMoney({ amount: credited, currency: row.currency }, locale) }) : t("done"));
    } catch (err) {
      setError(apiErrorMessage(err, t("failed")));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t("title", { name: row.student.full_name, label: row.label })}
      size="sm"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t("keep")}
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={busy} data-testid="subscription-cancel-confirm">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("confirm")}
          </Button>
        </>
      }
    >
      <p className="text-muted-foreground text-sm">{t("hint")}</p>
      {row.invoice_paid_minor > 0 && (
        <p className="text-sm font-medium text-amber-700 dark:text-amber-300" data-testid="subscription-cancel-credit">
          {t("paidBack", { amount: formatMoney({ amount: row.invoice_paid_minor, currency: row.currency }, locale) })}
        </p>
      )}
      {error && <AlertBanner variant="error" message={error} />}
    </Modal>
  );
}
