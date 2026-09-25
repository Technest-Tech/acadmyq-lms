"use client";

import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ApiError, changePassword } from "@/lib/api";
import { cn } from "@/lib/utils";

const inputClass =
  "border-input bg-background placeholder:text-muted-foreground focus:border-primary focus:ring-primary/15 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-colors focus:ring-3 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * The signed-in user changes their own password (account menu → "Change password"). Until this
 * existed nobody in the management app could: passwords were only ever set FOR people, by an
 * owner or the platform admin. The current password is required, so a walked-away session cannot
 * be turned into a permanent takeover.
 */
export function ChangePasswordModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("auth");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < 8;
  const canSave =
    !busy && current.length > 0 && next.length >= 8 && confirm === next;

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setDone(false);
    setBusy(false);
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword({ current_password: current, password: next });
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      const body =
        err instanceof ApiError
          ? (err.body as
              | { errors?: { current_password?: string[] } }
              | undefined)
          : undefined;
      setError(
        body?.errors?.current_password
          ? t("wrongCurrentPassword")
          : err instanceof ApiError
            ? err.message
            : String(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title={t("changePassword")}
      size="sm"
      footer={
        <>
          <Button type="button" variant="ghost" size="sm" onClick={close}>
            {done ? t("close") : t("cancel")}
          </Button>
          {!done && (
            <Button
              type="submit"
              size="sm"
              form="change-password-form"
              disabled={!canSave}
              className="gap-1.5"
              data-testid="save-password"
            >
              <KeyRound className="size-3.5" aria-hidden />
              {busy ? t("resetting") : t("changePassword")}
            </Button>
          )}
        </>
      }
    >
      {done ? (
        <AlertBanner variant="success" message={t("passwordChanged")} />
      ) : (
        <form
          id="change-password-form"
          className="space-y-3"
          onSubmit={submit}
          data-testid="change-password-form"
        >
          <p className="text-muted-foreground text-xs">{t("changePasswordHint")}</p>
          {error && (
            <AlertBanner
              variant="error"
              message={error}
              onDismiss={() => setError(null)}
            />
          )}
          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {t("currentPassword")}
            </span>
            <input
              type={show ? "text" : "password"}
              dir="ltr"
              autoComplete="current-password"
              aria-label={t("currentPassword")}
              className={inputClass}
              value={current}
              disabled={busy}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {t("newPassword")}
            </span>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                dir="ltr"
                autoComplete="new-password"
                aria-label={t("newPassword")}
                className={cn(inputClass, "pe-10")}
                value={next}
                disabled={busy}
                onChange={(e) => setNext(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={t(show ? "hidePassword" : "showPassword")}
                className="text-muted-foreground hover:text-foreground absolute inset-y-0 end-0 flex items-center pe-3"
              >
                {show ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </button>
            </div>
            {tooShort && (
              <span className="text-destructive text-[11px]">{t("passwordTooShort")}</span>
            )}
          </label>
          <label className="block space-y-1.5">
            <span className="text-muted-foreground text-xs font-medium">
              {t("confirmPassword")}
            </span>
            <input
              type={show ? "text" : "password"}
              dir="ltr"
              autoComplete="new-password"
              aria-label={t("confirmPassword")}
              className={inputClass}
              value={confirm}
              disabled={busy}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {mismatch && (
              <span className="text-destructive text-[11px]">{t("passwordMismatch")}</span>
            )}
          </label>
        </form>
      )}
    </Modal>
  );
}
