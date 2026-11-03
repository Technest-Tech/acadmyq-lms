"use client";

import { BellOff, Loader2, MessageSquareWarning } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { SectionCard } from "@/components/settings/section-card";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { getAbsenceAlert, previewAbsenceAlert, updateAbsenceAlert, type AbsenceAlertSettings } from "@/lib/portal-groups-api";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background focus:border-primary focus:ring-primary/20 w-full rounded-xl border px-3 py-2 text-sm outline-none transition-all focus:ring-2 disabled:opacity-50";

/** The preview asks the API after the typing pauses, not on every keystroke. */
const PREVIEW_DEBOUNCE_MS = 400;

/**
 * Settings → WhatsApp → "تنبيه الغياب لولي الأمر" (a centre's): the switch that WhatsApps a family
 * the moment a group sheet marks their child absent, and the wording it sends. The text is built
 * mostly by tapping facts into it; the preview is rendered by the API with stand-in values so what
 * the owner sees is what the parent gets. Empty wording means the platform default, shown as the
 * textarea's placeholder so nobody writes one blind.
 */
export function AbsenceAlertManager() {
  const t = useTranslations("portalGroups");
  const toast = useToast();
  const { can } = useAuth();
  const canEdit = can("settings.manage");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [settings, setSettings] = useState<AbsenceAlertSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [sample, setSample] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const describe = (err: unknown) => (err instanceof ApiError ? err.message : String(err));

  const load = useCallback(async () => {
    try {
      const next = await getAbsenceAlert();
      setSettings(next);
      setEnabled(next.enabled);
      setMessage(next.message ?? "");
      setSample(next.sample);
    } catch (err) {
      setError(describe(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The preview follows the text as it is typed.
  useEffect(() => {
    if (settings === null) return;
    const typed = message.trim();
    if (typed === (settings.message ?? "")) {
      setSample(settings.sample);
      return;
    }
    const id = setTimeout(() => {
      previewAbsenceAlert(typed === "" ? null : typed)
        .then((r) => setSample(r.sample))
        .catch(() => {});
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [message, settings]);

  /** Put `{{token}}` where the cursor is, so building the message is mostly tapping. */
  function insert(token: string) {
    const el = textareaRef.current;
    const at = el?.selectionStart ?? message.length;
    const end = el?.selectionEnd ?? at;
    const piece = `{{${token}}}`;
    setMessage(`${message.slice(0, at)}${piece}${message.slice(end)}`);
    window.requestAnimationFrame(() => {
      el?.focus();
      const caret = at + piece.length;
      el?.setSelectionRange(caret, caret);
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const typed = message.trim();
      const next = await updateAbsenceAlert({ enabled, message: typed === "" ? null : typed });
      setSettings(next);
      setEnabled(next.enabled);
      setMessage(next.message ?? "");
      setSample(next.sample);
      toast.success(t("saved"));
    } catch (err) {
      setError(describe(err));
    } finally {
      setSaving(false);
    }
  }

  if (settings === null) {
    return error ? (
      <AlertBanner variant="error" message={error} />
    ) : (
      <div className="flex items-center justify-center py-8" data-testid="absence-alert-loading">
        <Loader2 className="text-primary size-6 animate-spin" aria-hidden />
      </div>
    );
  }

  const dirty = enabled !== settings.enabled || message.trim() !== (settings.message ?? "");

  return (
    <SectionCard
      icon={MessageSquareWarning}
      title={t("title")}
      description={t("description")}
      iconClassName="bg-gradient-to-br from-rose-500 to-orange-600 shadow-rose-500/25"
      testId="absence-alert"
    >
      {error && (
        <div className="mb-4">
          <AlertBanner variant="error" message={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <label className="flex items-start justify-between gap-4 rounded-xl border p-3">
        <span className="min-w-0">
          <span className="block text-sm font-medium">{t("enabled")}</span>
          <span className="text-muted-foreground mt-0.5 block text-xs">{t("enabledHint")}</span>
        </span>
        <Switch
          checked={enabled}
          disabled={!canEdit}
          onChange={(e) => setEnabled(e.target.checked)}
          aria-label={t("enabled")}
          data-testid="absence-alert-enabled"
        />
      </label>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("message")}</p>
            <p className="text-muted-foreground text-xs">{t("messageHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {settings.placeholders.map((fact) => (
                <button
                  key={fact}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => insert(fact)}
                  data-testid={`absence-alert-fact-${fact}`}
                  className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-50 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-300"
                >
                  {t(`placeholders.${fact}`)}
                </button>
              ))}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            dir="auto"
            rows={8}
            value={message}
            disabled={!canEdit}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={settings.default_message}
            className={cn(inputClass, "resize-y text-[13px] leading-relaxed")}
            data-testid="absence-alert-message"
          />
          {message.trim() !== "" && canEdit && (
            <button
              type="button"
              onClick={() => setMessage("")}
              className="text-muted-foreground inline-flex items-center gap-1.5 text-xs hover:underline"
              data-testid="absence-alert-use-default"
            >
              <BellOff className="size-3.5" aria-hidden />
              {t("useDefault")}
            </button>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t("preview")}</p>
          <div
            dir="auto"
            className="min-h-32 rounded-2xl border bg-[#e7f6e4] px-4 py-3 text-sm leading-relaxed whitespace-pre-line text-slate-900 dark:bg-emerald-950/40 dark:text-slate-100"
            data-testid="absence-alert-sample"
          >
            {sample}
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="mt-4 flex justify-end">
          <Button disabled={!dirty || saving} onClick={() => void save()} data-testid="absence-alert-save">
            {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t("save")}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
