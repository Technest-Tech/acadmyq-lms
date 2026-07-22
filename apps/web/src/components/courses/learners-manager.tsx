"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CoursesTabs } from "@/components/courses/courses-tabs";
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
import { cn } from "@/lib/utils";

/** The staff view of learners + their enrollments; block / unblock and revoke / restore access. */
export function LearnersManager() {
  const t = useTranslations("courses");
  const { can } = useAuth();
  const canManage = can("access_code.manage");

  const [rows, setRows] = useState<CourseLearnerRow[]>([]);
  const [loading, setLoading] = useState(true);
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
      showAlert("success", next === "BLOCKED" ? t("learners.blocked_msg") : t("learners.unblocked_msg"));
    } catch {
      showAlert("error", t("alerts.failed"));
    }
  }

  if (!can("learner.read")) {
    return <p className="text-muted-foreground py-16 text-center text-sm">{t("noAccess")}</p>;
  }

  return (
    <div className="space-y-6">
      <CoursesTabs />
      <div>
        <h1 className="text-xl font-semibold">{t("learners.title")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("learners.subtitle")}</p>
      </div>

      {alert && (
        <AlertBanner variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
      )}

      {loading ? (
        <p className="text-muted-foreground py-12 text-center text-sm">…</p>
      ) : rows.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed py-16 text-center text-sm">
          {t("learners.empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th className="p-3 text-start font-medium">{t("learners.column.name")}</th>
                <th className="p-3 text-start font-medium">{t("learners.column.email")}</th>
                <th className="p-3 text-start font-medium">{t("learners.column.courses")}</th>
                <th className="p-3 text-start font-medium">{t("learners.column.status")}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="p-3">
                    <button
                      type="button"
                      className="font-medium hover:underline"
                      onClick={() => setDetailId(r.id)}
                    >
                      {r.full_name}
                    </button>
                  </td>
                  <td className="text-muted-foreground p-3">{r.email}</td>
                  <td className="p-3 tabular-nums">{r.enrollment_count}</td>
                  <td className="p-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        r.status === "ACTIVE"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-destructive/10 text-destructive",
                      )}
                    >
                      {r.status === "ACTIVE" ? t("learners.active") : t("learners.blocked")}
                    </span>
                  </td>
                  <td className="p-3 text-end">
                    {canManage && (
                      <Button variant="outline" size="sm" onClick={() => toggleBlock(r)}>
                        {r.status === "ACTIVE" ? t("learners.block") : t("learners.unblock")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
  const [name, setName] = useState("");
  const [enrollments, setEnrollments] = useState<LearnerEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState(0);

  useEffect(() => {
    setLoading(true);
    getCourseLearner(learnerId)
      .then((r) => {
        setName(r.learner.full_name);
        setEnrollments(r.enrollments);
      })
      .finally(() => setLoading(false));
  }, [learnerId, token]);

  async function toggle(e: LearnerEnrollment) {
    setBusy(true);
    try {
      await setEnrollmentStatus(learnerId, e.course_id, e.status === "ACTIVE" ? "REVOKED" : "ACTIVE");
      setToken((n) => n + 1);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={name || t("learners.title")}>
      <div className="space-y-3">
        <h3 className="text-sm font-medium">{t("learners.enrollments")}</h3>
        {loading ? (
          <p className="text-muted-foreground text-sm">…</p>
        ) : enrollments.length === 0 ? (
          <p className="text-muted-foreground text-sm">—</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {enrollments.map((e) => (
              <li key={e.course_id} className="flex items-center gap-3 p-3">
                <span className="flex-1 text-sm">{e.title}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    e.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-muted text-muted-foreground",
                  )}
                >
                  {e.status === "ACTIVE" ? t("learners.active") : t("codes.inactive")}
                </span>
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
