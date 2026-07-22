"use client";

import { Check, Copy, Download, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CoursesTabs } from "@/components/courses/courses-tabs";
import { Field, inputClass } from "@/components/courses/form-bits";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  deleteCode,
  generateCodes,
  listCodes,
  listCourses,
  updateCode,
  type AccessCode,
  type CourseRow,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/** The access-codes dashboard: generate batches, toggle/expire, copy, export CSV. */
export function CodesManager() {
  const t = useTranslations("courses");
  const { can } = useAuth();

  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState<AccessCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
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
    Promise.all([listCodes(), listCourses({ pageSize: 100 })])
      .then(([c, cs]) => {
        setCodes(c.codes);
        setCourses(cs.rows);
      })
      .catch(() => showAlert("error", t("alerts.failed")))
      .finally(() => setLoading(false));
  }, [refreshToken, t]);

  async function toggle(code: AccessCode) {
    try {
      await updateCode(code.id, { is_active: !code.is_active });
      refresh();
    } catch {
      showAlert("error", t("alerts.failed"));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteCode(deleting.id);
      setDeleting(null);
      refresh();
      showAlert("success", t("codes.deleted"));
    } catch {
      showAlert("error", t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  function copy(code: string) {
    void navigator.clipboard?.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500);
  }

  function exportCsv() {
    const header = "code,courses,uses,max,expires,active";
    const lines = codes.map((c) =>
      [
        c.code,
        `"${c.course_titles.join("; ")}"`,
        c.redemptions_count,
        c.max_redemptions ?? "",
        c.expires_at ?? "",
        c.is_active ? "yes" : "no",
      ].join(","),
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "access-codes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!can("access_code.manage")) {
    return <p className="text-muted-foreground py-16 text-center text-sm">{t("noAccess")}</p>;
  }

  return (
    <div className="space-y-6">
      <CoursesTabs />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t("codes.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("codes.subtitle")}</p>
        </div>
        <div className="flex gap-2">
          {codes.length > 0 && (
            <Button variant="outline" onClick={exportCsv}>
              <Download /> {t("codes.exportCsv")}
            </Button>
          )}
          <Button onClick={() => setGenerating(true)}>
            <Plus /> {t("codes.generate")}
          </Button>
        </div>
      </div>

      {alert && (
        <AlertBanner variant={alert.variant} message={alert.message} onDismiss={() => setAlert(null)} />
      )}

      {loading ? (
        <p className="text-muted-foreground py-12 text-center text-sm">…</p>
      ) : codes.length === 0 ? (
        <div className="text-muted-foreground rounded-xl border border-dashed py-16 text-center text-sm">
          {t("codes.empty")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-b text-xs">
              <tr>
                <th className="p-3 text-start font-medium">{t("codes.column.code")}</th>
                <th className="p-3 text-start font-medium">{t("codes.column.courses")}</th>
                <th className="p-3 text-start font-medium">{t("codes.column.uses")}</th>
                <th className="p-3 text-start font-medium">{t("codes.column.status")}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {codes.map((c) => (
                <tr key={c.id} className="hover:bg-muted/30">
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => copy(c.code)}
                      className="inline-flex items-center gap-1.5 font-mono font-medium"
                      title={t("codes.copy")}
                    >
                      {c.code}
                      {copied === c.code ? (
                        <Check className="size-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="size-3.5 opacity-40" />
                      )}
                    </button>
                    {c.label && <div className="text-muted-foreground text-xs">{c.label}</div>}
                  </td>
                  <td className="text-muted-foreground max-w-52 truncate p-3">
                    {c.course_titles.join(", ")}
                  </td>
                  <td className="p-3 tabular-nums">
                    {c.redemptions_count}
                    {c.max_redemptions !== null ? ` / ${c.max_redemptions}` : ` / ∞`}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      onClick={() => toggle(c)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        c.is_active
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {c.is_active ? t("codes.active") : t("codes.inactive")}
                    </button>
                  </td>
                  <td className="p-3 text-end">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("codes.confirmDelete")}
                      onClick={() => setDeleting(c)}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {generating && (
        <GenerateModal
          courses={courses}
          onCancel={() => setGenerating(false)}
          onDone={(n) => {
            setGenerating(false);
            refresh();
            showAlert("success", t("codes.generated", { count: n }));
          }}
        />
      )}

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={t("codes.confirmDelete")}>
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
            {t("delete")}
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function GenerateModal({
  courses,
  onCancel,
  onDone,
}: {
  courses: CourseRow[];
  onCancel: () => void;
  onDone: (count: number) => void;
}) {
  const t = useTranslations("courses");
  const [picked, setPicked] = useState<string[]>([]);
  const [count, setCount] = useState(30);
  const [singleUse, setSingleUse] = useState(true);
  const [expires, setExpires] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePick(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function submit() {
    if (picked.length === 0) {
      setError(t("codes.form.pickCourse"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await generateCodes({
        course_ids: picked,
        count,
        max_redemptions: singleUse ? 1 : null,
        expires_at: expires || null,
        label: label.trim() || null,
      });
      onDone(res.codes.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("alerts.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onCancel} title={t("codes.generate")}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && <AlertBanner variant="error" message={error} />}

        <div className="space-y-1.5">
          <span className="text-sm font-medium">{t("codes.form.courses")}</span>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-2">
            {courses.map((c) => (
              <label key={c.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm">
                <input
                  type="checkbox"
                  checked={picked.includes(c.id)}
                  onChange={() => togglePick(c.id)}
                  className="size-4"
                />
                {c.title}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t("codes.form.count")}>
            <input
              type="number"
              min={1}
              max={500}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              className={inputClass}
            />
          </Field>
          <Field label={t("codes.form.expires")}>
            <input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={singleUse} onChange={(e) => setSingleUse(e.target.checked)} className="size-4" />
          {t("codes.form.singleUse")}
        </label>

        <Field label={t("codes.form.label")}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("codes.form.labelPlaceholder")}
            className={inputClass}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" disabled={busy || picked.length === 0}>
            {t("codes.form.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
