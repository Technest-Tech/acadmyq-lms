"use client";

import { ExternalLink, Link2, Pencil, Power, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CopyLinkButton } from "@/components/accounting/accounting-ui";
import { useAuth } from "@/components/auth-provider";
import { apiErrorMessage } from "@/components/groups/group-form";
import { fieldClass } from "@/components/groups/group-format";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ProfileCard } from "@/components/ui/profile-card";
import {
  type EnrolmentForm,
  type EnrolmentFormSettings,
  getEnrolmentForm,
  rotateEnrolmentToken,
  updateEnrolmentForm,
} from "@/lib/enrolment-api";
import { cn } from "@/lib/utils";

/**
 * "رابط التسجيل" at the top of the inbox: the one public link the centre puts in its adverts, with
 * copy and open beside it, the open/closed switch, the words on the page, and "new link" when the
 * old one should die. Reading is `trial.read` (the people who paste the link); changing it is
 * `settings.manage`.
 */
export function EnrolmentLinkCard() {
  const t = useTranslations("enrolment");
  const { can } = useAuth();
  const canEdit = can("settings.manage");

  const [form, setForm] = useState<EnrolmentForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"open" | "rotate" | "save" | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    let live = true;
    getEnrolmentForm()
      .then((res) => live && setForm(res.form))
      .catch((err) => live && setError(apiErrorMessage(err, t("link.failed"))));
    return () => {
      live = false;
    };
  }, [t]);

  async function run(kind: "open" | "rotate", patch?: Partial<EnrolmentFormSettings>) {
    setPending(kind);
    setError(null);
    try {
      const res = kind === "rotate" ? await rotateEnrolmentToken() : await updateEnrolmentForm(patch ?? {});
      setForm(res.form);
      setConfirmRotate(false);
    } catch (err) {
      setError(apiErrorMessage(err, t("link.failed")));
    } finally {
      setPending(null);
    }
  }

  return (
    <ProfileCard
      icon={Link2}
      title={t("link.title")}
      description={t("link.description")}
      tone="emerald"
      testId="enrolment-link-card"
      action={
        canEdit && form ? (
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)} data-testid="enrolment-link-edit">
            <Pencil className="size-3.5" aria-hidden />
            {t("link.edit")}
          </Button>
        ) : undefined
      }
    >
      {error && (
        <p role="alert" className="text-destructive mb-3 text-sm font-medium">
          {error}
        </p>
      )}
      {form === null ? (
        <div className="bg-muted h-9 animate-pulse rounded-lg" />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="bg-muted/50 flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 py-2">
              <span className={cn("size-2 shrink-0 rounded-full", form.is_open ? "bg-emerald-500" : "bg-slate-400")} aria-hidden />
              <bdi dir="ltr" className="min-w-0 truncate font-mono text-xs" data-testid="enrolment-link-url">
                {form.url}
              </bdi>
            </div>
            <div className="flex flex-wrap gap-2">
              <CopyLinkButton value={form.url} label={t("link.copy")} copiedLabel={t("link.copied")} />
              <Button type="button" variant="outline" className="gap-1.5" onClick={() => window.open(form.url, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="size-4" aria-hidden />
                {t("link.open")}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t pt-3">
            <label className="flex items-center gap-2 text-sm">
              <button
                type="button"
                role="switch"
                aria-checked={form.is_open}
                disabled={!canEdit || pending !== null}
                onClick={() => void run("open", { is_open: !form.is_open })}
                data-testid="enrolment-link-switch"
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60",
                  form.is_open ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-600",
                )}
              >
                <span className={cn("inline-block size-5 rounded-full bg-white shadow transition-transform", form.is_open ? "translate-x-5 rtl:-translate-x-5" : "translate-x-0.5 rtl:-translate-x-0.5")} />
              </button>
              <span className="font-medium">{form.is_open ? t("link.isOpen") : t("link.isClosed")}</span>
            </label>

            {canEdit &&
              (confirmRotate ? (
                <div className="flex flex-wrap items-center gap-2" data-testid="enrolment-link-confirm">
                  <span className="text-xs font-medium">{t("link.rotateConfirm")}</span>
                  <Button type="button" size="sm" disabled={pending !== null} onClick={() => void run("rotate")}>
                    {t("link.confirm")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRotate(false)}>
                    {t("link.cancel")}
                  </Button>
                </div>
              ) : (
                <Button type="button" size="sm" variant="ghost" className="gap-1" onClick={() => setConfirmRotate(true)} data-testid="enrolment-link-rotate">
                  <RefreshCw className="size-3.5" aria-hidden />
                  {t("link.rotate")}
                </Button>
              ))}
          </div>
        </div>
      )}

      {form && (
        <EditFormModal
          open={editing}
          form={form}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setForm(next);
            setEditing(false);
          }}
        />
      )}
    </ProfileCard>
  );
}

/** The words on the page and the questions it asks. */
function EditFormModal({ open, form, onClose, onSaved }: { open: boolean; form: EnrolmentForm; onClose: () => void; onSaved: (form: EnrolmentForm) => void }) {
  const t = useTranslations("enrolment");
  const [title, setTitle] = useState(form.title);
  const [intro, setIntro] = useState(form.intro ?? "");
  const [success, setSuccess] = useState(form.success_message ?? "");
  const [askSubject, setAskSubject] = useState(form.ask_subject);
  const [askLevel, setAskLevel] = useState(form.ask_level);
  const [askSchedule, setAskSchedule] = useState(form.ask_schedule);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening reads the form as it is now, not as it was when the modal first mounted.
  useEffect(() => {
    if (!open) return;
    setTitle(form.title);
    setIntro(form.intro ?? "");
    setSuccess(form.success_message ?? "");
    setAskSubject(form.ask_subject);
    setAskLevel(form.ask_level);
    setAskSchedule(form.ask_schedule);
    setError(null);
  }, [open, form]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await updateEnrolmentForm({
        title: title.trim() || null,
        intro: intro.trim() || null,
        success_message: success.trim() || null,
        ask_subject: askSubject,
        ask_level: askLevel,
        ask_schedule: askSchedule,
      } as Partial<EnrolmentFormSettings>);
      onSaved(res.form);
    } catch (err) {
      setError(apiErrorMessage(err, t("link.failed")));
    } finally {
      setBusy(false);
    }
  }

  const Toggle = ({ label, value, onChange, testId }: { label: string; value: boolean; onChange: (v: boolean) => void; testId: string }) => (
    <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm">
      <span className="font-medium">{label}</span>
      <input type="checkbox" className="accent-primary size-4" checked={value} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
    </label>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("link.editTitle")}
      description={t("link.editDescription")}
      closeLabel={t("link.cancel")}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {t("link.cancel")}
          </Button>
          <Button type="button" size="sm" onClick={() => void save()} disabled={busy} data-testid="enrolment-form-save">
            {t("link.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="text-destructive text-sm font-medium">
            {error}
          </p>
        )}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("link.fields.title")}</label>
          <input className={fieldClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} aria-label={t("link.fields.title")} data-testid="enrolment-form-title" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("link.fields.intro")}</label>
          <textarea className={cn(fieldClass, "h-auto py-2")} rows={3} value={intro} onChange={(e) => setIntro(e.target.value)} maxLength={2000} placeholder={t("link.fields.introPlaceholder")} aria-label={t("link.fields.intro")} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("link.fields.success")}</label>
          <textarea className={cn(fieldClass, "h-auto py-2")} rows={2} value={success} onChange={(e) => setSuccess(e.target.value)} maxLength={2000} placeholder={t("link.fields.successPlaceholder")} aria-label={t("link.fields.success")} />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">{t("link.fields.asks")}</p>
          <Toggle label={t("link.fields.askSubject")} value={askSubject} onChange={setAskSubject} testId="enrolment-form-ask-subject" />
          <Toggle label={t("link.fields.askLevel")} value={askLevel} onChange={setAskLevel} testId="enrolment-form-ask-level" />
          <Toggle label={t("link.fields.askSchedule")} value={askSchedule} onChange={setAskSchedule} testId="enrolment-form-ask-schedule" />
        </div>
        <p className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
          <Power className="size-3" aria-hidden />
          {t("link.fields.openHint")}
        </p>
      </div>
    </Modal>
  );
}
