"use client";

import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  Infinity as InfinityIcon,
  KeyRound,
  Plus,
  SearchX,
  Ticket,
  Trash2,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { CheckOption, Field, inputClass } from "@/components/courses/form-bits";
import {
  EmptyState,
  MiniStat,
  PageHeader,
  SearchField,
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
  deleteCode,
  generateCodes,
  listCodes,
  listCourses,
  updateCode,
  type AccessCode,
  type CourseRow,
} from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { cn } from "@/lib/utils";

/** The access-codes dashboard: generate batches, toggle/expire, copy, export CSV. */
export function CodesManager() {
  const t = useTranslations("courses");
  const locale = useLocale();
  const { can } = useAuth();

  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [courses, setCourses] = useState<CourseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
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

  // Search runs client-side: the codes endpoint returns the whole batch in one call.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return codes;
    return codes.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        (c.label?.toLowerCase().includes(q) ?? false) ||
        c.course_titles.some((title) => title.toLowerCase().includes(q)),
    );
  }, [codes, search]);

  const stats = useMemo(
    () => ({
      total: codes.length,
      active: codes.filter((c) => c.is_active).length,
      redeemed: codes.reduce((n, c) => n + c.redemptions_count, 0),
    }),
    [codes],
  );

  if (!can("access_code.manage")) {
    return (
      <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        <EmptyState Icon={KeyRound} color="slate" title={t("noAccess")} />
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-4">
      <PageHeader
        Icon={KeyRound}
        color="amber"
        title={t("codes.title")}
        subtitle={t("codes.subtitle")}
        actions={
          <>
            {codes.length > 0 && (
              <Button variant="outline" size="lg" onClick={exportCsv}>
                <Download /> {t("codes.exportCsv")}
              </Button>
            )}
            <Button size="lg" onClick={() => setGenerating(true)}>
              <Plus /> {t("codes.generate")}
            </Button>
          </>
        }
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
          Icon={KeyRound}
          color="amber"
          label={t("codes.stats.total")}
          value={loading ? null : stats.total}
          locale={locale}
        />
        <MiniStat
          Icon={CheckCircle2}
          color="emerald"
          label={t("codes.stats.active")}
          value={loading ? null : stats.active}
          locale={locale}
        />
        <MiniStat
          Icon={Ticket}
          color="violet"
          label={t("codes.stats.redeemed")}
          value={loading ? null : stats.redeemed}
          locale={locale}
        />
      </div>

      {codes.length > 0 && (
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t("codes.search")}
          className="sm:max-w-sm"
        />
      )}

      <div className="bg-card overflow-hidden rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        {loading ? (
          <table className="w-full text-sm">
            <TableSkeleton cols={5} />
          </table>
        ) : codes.length === 0 ? (
          <EmptyState
            Icon={KeyRound}
            color="amber"
            title={t("codes.empty")}
            description={t("codes.emptyHint")}
            action={
              <Button size="lg" onClick={() => setGenerating(true)}>
                <Plus /> {t("codes.generate")}
              </Button>
            }
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
                  <th className={thClass}>{t("codes.column.code")}</th>
                  <th className={thClass}>{t("codes.column.courses")}</th>
                  <th className={thClass}>{t("codes.column.uses")}</th>
                  <th className={thClass}>{t("codes.column.status")}</th>
                  <th className={thClass} />
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((c) => (
                  <tr key={c.id} className={trClass}>
                    <td className={tdClass}>
                      <button
                        type="button"
                        onClick={() => copy(c.code)}
                        title={copied === c.code ? t("codes.copied") : t("codes.copy")}
                        className="hover:bg-muted -mx-1.5 inline-flex items-center gap-2 rounded-lg px-1.5 py-0.5 font-mono text-sm font-semibold tracking-wide transition-colors"
                      >
                        {c.code}
                        {copied === c.code ? (
                          <Check className="size-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="size-3.5 opacity-40" />
                        )}
                      </button>
                      {c.label && (
                        <div className="text-muted-foreground mt-0.5 text-xs">{c.label}</div>
                      )}
                    </td>
                    <td className={cn(tdClass, "text-muted-foreground max-w-52")}>
                      <span className="line-clamp-2 text-xs">{c.course_titles.join(" · ")}</span>
                    </td>
                    <td className={tdClass}>
                      <UsesMeter
                        used={c.redemptions_count}
                        max={c.max_redemptions}
                        locale={locale}
                      />
                    </td>
                    <td className={tdClass}>
                      <button
                        type="button"
                        onClick={() => toggle(c)}
                        title={c.is_active ? t("codes.deactivate") : t("codes.activate")}
                        className="transition-opacity hover:opacity-75"
                      >
                        <StatusPill tone={c.is_active ? "emerald" : "slate"}>
                          {c.is_active ? t("codes.active") : t("codes.inactive")}
                        </StatusPill>
                      </button>
                    </td>
                    <td className={cn(tdClass, "text-end")}>
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
      </div>

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

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t("codes.confirmDelete")}
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={busy}>
              {t("form.cancel")}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={busy}>
              {t("delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm">
          <span className="text-muted-foreground">{t("codes.confirmDeleteBody")}</span>{" "}
          <span className="font-mono font-semibold">{deleting?.code}</span>
        </p>
      </Modal>
    </div>
  );
}

/** Redemptions against the cap — a bar for capped codes, the ∞ glyph for uncapped ones. */
function UsesMeter({
  used,
  max,
  locale,
}: {
  used: number;
  max: number | null;
  locale: string;
}) {
  if (max === null) {
    return (
      <span className="inline-flex items-center gap-1.5 tabular-nums">
        {formatNumber(used, locale)}
        <InfinityIcon className="text-muted-foreground size-3.5" aria-label="unlimited" />
      </span>
    );
  }

  const pct = Math.min((used / max) * 100, 100);
  const exhausted = used >= max;

  return (
    <div className="w-24">
      <div className="flex items-baseline gap-1 text-xs tabular-nums">
        <span className={cn("font-semibold", exhausted && "text-muted-foreground")}>
          {formatNumber(used, locale)}
        </span>
        <span className="text-muted-foreground">/ {formatNumber(max, locale)}</span>
      </div>
      <div className="bg-muted mt-1 h-1.5 w-full overflow-hidden rounded-full">
        <div
          className={cn(
            "h-full rounded-full bg-gradient-to-r transition-all",
            exhausted ? "from-slate-400 to-slate-500" : "from-amber-500 to-orange-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
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
    <Modal
      open
      onClose={onCancel}
      title={t("codes.generate")}
      description={t("codes.form.hint")}
      size="lg"
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error && <AlertBanner variant="error" message={error} />}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t("codes.form.courses")}</span>
            {picked.length > 0 && (
              <StatusPill tone="violet" dot={false}>
                {t("codes.form.selected", { count: picked.length })}
              </StatusPill>
            )}
          </div>
          {courses.length === 0 ? (
            <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-center text-sm">
              {t("codes.form.noCourses")}
            </p>
          ) : (
            <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-xl border p-2">
              {courses.map((c) => {
                const on = picked.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                      on ? "bg-primary/10 text-foreground font-medium" : "hover:bg-muted",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => togglePick(c.id)}
                      className="accent-primary size-4"
                    />
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {on && <Check className="text-primary size-4 shrink-0" />}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field label={t("codes.form.expires")} optional={t("form.optional")}>
            <input
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <CheckOption
          checked={singleUse}
          onChange={setSingleUse}
          label={t("codes.form.singleUse")}
          hint={t("codes.form.singleUseHint")}
        />

        <Field label={t("codes.form.label")} optional={t("form.optional")}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("codes.form.labelPlaceholder")}
            className={inputClass}
          />
        </Field>

        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {t("form.cancel")}
          </Button>
          <Button type="submit" disabled={busy || picked.length === 0}>
            <Plus /> {t("codes.form.submit")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
