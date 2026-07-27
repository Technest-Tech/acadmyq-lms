"use client";

import {
  BookOpen,
  Ban,
  CheckCircle2,
  Mail,
  SearchX,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import {
  EmptyState,
  InitialsAvatar,
  MiniStat,
  PageHeader,
  SearchField,
  Sk,
  StatusPill,
  tableHeadClass,
  TableSkeleton,
  tdClass,
  thClass,
  trClass,
} from "@/components/courses/lms-ui";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  getCourseLearner,
  listCourseLearners,
  setEnrollmentStatus,
  setLearnerStatus,
  type CourseLearnerRow,
  type LearnerEnrollment,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/** The staff view of learners + their enrollments; block / unblock and revoke / restore access. */
export function LearnersManager() {
  const t = useTranslations("courses");
  const locale = useLocale();
  const { can } = useAuth();
  const canManage = can("access_code.manage");

  const [rows, setRows] = useState<CourseLearnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ variant: "success" | "error"; message: string } | null>(
    null,
  );

  const refresh = () => setRefreshToken((n) => n + 1);
  const showAlert = (variant: "success" | "error", message: string) => {
    setAlert({ variant, message });
    if (variant === "success") setTimeout(() => setAlert(null), 3500);
  };

  useEffect(() => {
    setLoading(true);
    listCourseLearners()
      .then((r) => setRows(r.learners))
      .catch(() => showAlert("error", t("alerts.failed")))
      .finally(() => setLoading(false));
  }, [refreshToken, t]);

  async function toggleBlock(row: CourseLearnerRow) {
    const next = row.status === "ACTIVE" ? "BLOCKED" : "ACTIVE";
    try {
      await setLearnerStatus(row.id, next);
      refresh();
      showAlert(
        "success",
        next === "BLOCKED" ? t("learners.blocked_msg") : t("learners.unblocked_msg"),
      );
    } catch {
      showAlert("error", t("alerts.failed"));
    }
  }

  // The learners endpoint returns the whole roster in one call, so search filters client-side.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return rows;
    return rows.filter(
      (r) => r.full_name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((r) => r.status === "ACTIVE").length,
      enrollments: rows.reduce((n, r) => n + r.enrollment_count, 0),
    }),
    [rows],
  );

  if (!can("learner.read")) {
    return (
      <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        <EmptyState Icon={Users} color="slate" title={t("noAccess")} />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        Icon={Users}
        color="cyan"
        title={t("learners.title")}
        subtitle={t("learners.subtitle")}
      />

      {alert && (
        <AlertBanner
          variant={alert.variant}
          message={alert.message}
          onDismiss={() => setAlert(null)}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniStat
          Icon={Users}
          color="cyan"
          label={t("learners.stats.total")}
          value={loading ? null : stats.total}
          locale={locale}
        />
        <MiniStat
          Icon={CheckCircle2}
          color="emerald"
          label={t("learners.stats.active")}
          value={loading ? null : stats.active}
          locale={locale}
        />
        <MiniStat
          Icon={BookOpen}
          color="violet"
          label={t("learners.stats.enrollments")}
          value={loading ? null : stats.enrollments}
          locale={locale}
        />
      </div>

      {rows.length > 0 && (
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t("learners.search")}
          className="sm:max-w-sm"
        />
      )}

      <div className="bg-card overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        {loading ? (
          <table className="w-full text-sm">
            <TableSkeleton cols={5} />
          </table>
        ) : rows.length === 0 ? (
          <EmptyState
            Icon={Users}
            color="cyan"
            title={t("learners.empty")}
            description={t("learners.emptyHint")}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            Icon={SearchX}
            color="slate"
            title={t("noResults")}
            description={t("noResultsHint")}
            action={
              <Button variant="outline" onClick={() => setSearch("")}>
                {t("clearFilters")}
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className={tableHeadClass}>
                <tr>
                  <th className={thClass}>{t("learners.column.name")}</th>
                  <th className={cn(thClass, "hidden sm:table-cell")}>
                    {t("learners.column.courses")}
                  </th>
                  <th className={cn(thClass, "hidden md:table-cell")}>
                    {t("learners.column.lastActive")}
                  </th>
                  <th className={thClass}>{t("learners.column.status")}</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((r) => (
                  <tr key={r.id} className={trClass}>
                    <td className={tdClass}>
                      <button
                        type="button"
                        className="flex min-w-0 items-center gap-3 text-start"
                        onClick={() => setDetailId(r.id)}
                      >
                        <InitialsAvatar name={r.full_name} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium hover:underline">
                            {r.full_name}
                          </span>
                          <span className="text-muted-foreground flex items-center gap-1 truncate text-xs">
                            <Mail className="size-3 shrink-0" />
                            {r.email}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className={cn(tdClass, "hidden tabular-nums sm:table-cell")}>
                      <span className="inline-flex items-center gap-1.5">
                        <BookOpen className="text-muted-foreground size-3.5" />
                        {formatNumber(r.enrollment_count, locale)}
                      </span>
                    </td>
                    <td className={cn(tdClass, "text-muted-foreground hidden text-xs md:table-cell")}>
                      {r.last_login_at
                        ? new Date(r.last_login_at).toLocaleDateString(locale, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : t("learners.never")}
                    </td>
                    <td className={tdClass}>
                      <StatusPill tone={r.status === "ACTIVE" ? "emerald" : "rose"}>
                        {r.status === "ACTIVE" ? t("learners.active") : t("learners.blocked")}
                      </StatusPill>
                    </td>
                    <td className={cn(tdClass, "text-end")}>
                      {canManage && (
                        <Button variant="outline" size="sm" onClick={() => toggleBlock(r)}>
                          {r.status === "ACTIVE" ? (
                            <>
                              <Ban /> {t("learners.block")}
                            </>
                          ) : (
                            <>
                              <ShieldCheck /> {t("learners.unblock")}
                            </>
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailId && (
        <LearnerDetail
          learnerId={detailId}
          canManage={canManage}
          onClose={() => setDetailId(null)}
          onChanged={() => {
            refresh();
            showAlert("success", t("alerts.saved"));
          }}
        />
      )}
    </div>
  );
}

function LearnerDetail({
  learnerId,
  canManage,
  onClose,
  onChanged,
}: {
  learnerId: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("courses");
  const locale = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [enrollments, setEnrollments] = useState<LearnerEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    setLoading(true);
    getCourseLearner(learnerId)
      .then((r) => {
        setName(r.learner.full_name);
        setEmail(r.learner.email);
        setEnrollments(r.enrollments);
      })
      .finally(() => setLoading(false));
  }, [learnerId, token]);

  async function toggle(e: LearnerEnrollment) {
    setBusy(true);
    try {
      await setEnrollmentStatus(
        learnerId,
        e.course_id,
        e.status === "ACTIVE" ? "REVOKED" : "ACTIVE",
      );
      setToken((n) => n + 1);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={name || t("learners.title")} description={email || undefined}>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          {name && <InitialsAvatar name={name} className="size-11" />}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{name || "—"}</p>
            <p className="text-muted-foreground truncate text-xs">{email}</p>
          </div>
        </div>

        <h3 className="text-muted-foreground pt-2 text-xs font-semibold tracking-wider uppercase">
          {t("learners.enrollments")}
        </h3>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }, (_, i) => (
              <Sk key={i} className="h-14 rounded-xl" />
            ))}
          </div>
        ) : enrollments.length === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed py-8 text-center text-sm">
            {t("learners.noEnrollments")}
          </p>
        ) : (
          <ul className="divide-y overflow-hidden rounded-xl border">
            {enrollments.map((e) => (
              <li key={e.course_id} className="flex items-center gap-3 p-3">
                <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                  <BookOpen className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.title}</p>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {new Date(e.enrolled_at).toLocaleDateString(locale, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>
                <StatusPill tone={e.status === "ACTIVE" ? "emerald" : "slate"}>
                  {e.status === "ACTIVE" ? t("learners.active") : t("codes.inactive")}
                </StatusPill>
                {canManage && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => toggle(e)}>
                    {e.status === "ACTIVE" ? t("learners.revoke") : t("learners.restore")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
