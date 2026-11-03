"use client";

import { ClipboardList, Inbox, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { EnrolmentLinkCard } from "@/components/enrolment/enrolment-link-card";
import { PlacementForm } from "@/components/enrolment/placement-form";
import { RequestCard } from "@/components/enrolment/request-card";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { AlertBanner } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { HeroPill, PageHero } from "@/components/ui/page-hero";
import {
  ENROLMENT_STATUSES,
  type EnrolmentRequest,
  type EnrolmentStatus,
  listEnrolmentRequests,
  updateEnrolmentRequest,
} from "@/lib/enrolment-api";
import { cn } from "@/lib/utils";

type Tab = "ALL" | EnrolmentStatus;
const TABS: Tab[] = ["ALL", ...ENROLMENT_STATUSES];

/**
 * The enrolment inbox (docs/centre-profile Phase 2 §6): the public link at the top, then every
 * request the form collected, cut by status. The counts on the tabs come from the same response as
 * the cards, so a number and the list under it never disagree. Reading is `trial.read`; the actions
 * (contacted, note, placement, close) are `trial.manage`, like the trials board they feed.
 */
export function EnrolmentInbox() {
  const t = useTranslations("enrolment");
  const { can } = useAuth();
  const canManage = can("trial.manage");

  const [tab, setTab] = useState<Tab>("NEW");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<EnrolmentRequest[]>([]);
  const [counts, setCounts] = useState<Record<EnrolmentStatus, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [placing, setPlacing] = useState<EnrolmentRequest | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listEnrolmentRequests({ status: tab === "ALL" ? "" : tab, q });
      setRows(res.rows);
      setCounts(res.counts);
    } catch (err) {
      setError(apiErrorMessage(err, t("failed")));
    } finally {
      setLoading(false);
    }
  }, [tab, q, t]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(handle);
  }, [load, q]);

  /** Swap the changed row in, and move it out of a tab it no longer belongs to. */
  function replaceRow(next: EnrolmentRequest) {
    setRows((prev) => {
      const without = prev.filter((r) => r.id !== next.id);
      return tab === "ALL" || next.status === tab ? prev.map((r) => (r.id === next.id ? next : r)) : without;
    });
  }

  async function setStatus(req: EnrolmentRequest, status: EnrolmentStatus) {
    setPendingId(req.id);
    setError(null);
    try {
      const res = await updateEnrolmentRequest(req.id, { status });
      replaceRow(res.request);
      setCounts((c) => (c ? { ...c, [req.status]: Math.max(0, c[req.status] - 1), [status]: c[status] + 1 } : c));
    } catch (err) {
      setError(apiErrorMessage(err, t("failed")));
    } finally {
      setPendingId(null);
    }
  }

  async function setNote(req: EnrolmentRequest, note: string | null) {
    try {
      const res = await updateEnrolmentRequest(req.id, { staff_note: note });
      replaceRow(res.request);
    } catch (err) {
      setError(apiErrorMessage(err, t("failed")));
      throw err;
    }
  }

  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  const newCount = counts?.NEW ?? 0;

  return (
    <div className="space-y-6">
      <PageHero
        icon={ClipboardList}
        title={t("title")}
        subtitle={t("subtitle")}
        latticeId="enrolment-hero"
        actions={
          <>
            {newCount > 0 && <HeroPill>{t("newCount", { n: newCount })}</HeroPill>}
            <HeroPill>{t("total", { n: total })}</HeroPill>
          </>
        }
      />

      <EnrolmentLinkCard />

      {error && <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />}
      {notice && <AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} />}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1" role="tablist">
          {TABS.map((key) => {
            const n = counts ? (key === "ALL" ? total : counts[key]) : null;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                )}
                data-testid={`enrolment-tab-${key}`}
              >
                {key === "ALL" ? t("tabs.ALL") : t(`status.${key}`)}
                {n !== null && <span className="ms-1.5 tabular-nums opacity-80">{n}</span>}
              </button>
            );
          })}
        </div>
        <label className="relative lg:w-72">
          <Search className="text-muted-foreground absolute top-1/2 size-4 -translate-y-1/2 ltr:left-3 rtl:right-3" />
          <input className={cn(fieldClass, "ps-9")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} aria-label={t("search")} data-testid="enrolment-search" />
        </label>
      </div>

      {loading && rows.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted h-28 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed px-5 py-12 text-center" data-testid="enrolment-empty">
          <Inbox className="text-muted-foreground mx-auto size-8" aria-hidden />
          <p className="mt-3 text-sm font-medium">{t(total === 0 ? "empty.none" : "empty.tab")}</p>
          {total === 0 && <p className="text-muted-foreground mt-1 text-xs">{t("empty.hint")}</p>}
        </div>
      ) : (
        <div className="space-y-3" data-testid="enrolment-list">
          {rows.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              canManage={canManage}
              pending={pendingId === r.id}
              onStatus={(status) => void setStatus(r, status)}
              onNote={(note) => setNote(r, note)}
              onPlacement={() => setPlacing(r)}
            />
          ))}
        </div>
      )}

      <Modal open={placing !== null} onClose={() => setPlacing(null)} title={t("placement.title")} description={t("placement.description")} closeLabel={t("placement.cancel")}>
        {placing && (
          <PlacementForm
            request={placing}
            onCancel={() => setPlacing(null)}
            onBooked={({ request, warnings }) => {
              replaceRow(request);
              setCounts((c) => (c ? { ...c, [placing.status]: Math.max(0, c[placing.status] - 1), PLACEMENT_BOOKED: c.PLACEMENT_BOOKED + 1 } : c));
              setPlacing(null);
              setNotice(warnings.length > 0 ? `${t("placement.booked")} — ${warnings.join(" · ")}` : t("placement.booked"));
            }}
          />
        )}
      </Modal>
    </div>
  );
}
