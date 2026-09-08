"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import {
  createFinanceClient,
  deleteFinanceClient,
  updateFinanceClient,
  type FinanceClientRow,
} from "@/lib/api";
import { Field, inputClass, textareaClass } from "./finance-fields";
import { errorMessage } from "./finance-format";

/**
 * Create or edit a finance client — a name in the owner's book, never a platform account.
 * Deleting is offered only while the client has no deals; the API refuses otherwise (409),
 * because a client with history is a line in last year's statistics.
 */
export function ClientFormModal({
  open,
  client,
  onClose,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  client: FinanceClientRow | null;
  onClose: () => void;
  onSaved: (client: FinanceClientRow) => void;
  onDeleted?: (id: string) => void;
}) {
  const t = useTranslations("finance");
  const toast = useToast();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(client?.name ?? "");
    setPhone(client?.phone ?? "");
    setEmail(client?.email ?? "");
    setNotes(client?.notes ?? "");
    setError(null);
    setConfirming(false);
    setSaving(false);
  }, [open, client]);

  async function save() {
    if (name.trim() === "") {
      setError(t("clients.form.nameRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        notes: notes.trim() || null,
      };
      const res = client
        ? await updateFinanceClient(client.id, input)
        : await createFinanceClient(input);
      toast.success(t(client ? "clients.form.saved" : "clients.form.created"));
      onSaved(res.client);
    } catch (e) {
      setError(errorMessage(e, t("form.errors.generic")));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!client) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setSaving(true);
    try {
      await deleteFinanceClient(client.id);
      toast.success(t("clients.form.deleted"));
      onDeleted?.(client.id);
    } catch (e) {
      setError(errorMessage(e, t("form.errors.generic")));
    } finally {
      setSaving(false);
    }
  }

  const canDelete =
    client !== null && client.deals_count === 0 && onDeleted !== undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t(client ? "clients.form.editTitle" : "clients.form.newTitle")}
      closeLabel={t("actions.close")}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={save} disabled={saving}>
            {saving
              ? t("actions.saving")
              : t(client ? "actions.save" : "actions.create")}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t("actions.cancel")}
          </Button>
          {canDelete ? (
            <Button
              variant="ghost"
              className="text-destructive ms-auto"
              onClick={remove}
              disabled={saving}
            >
              {confirming ? t("actions.confirm") : t("actions.delete")}
            </Button>
          ) : null}
          {error ? (
            <span role="alert" className="text-destructive basis-full text-xs">
              {error}
            </span>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label={t("clients.form.name")}
          htmlFor="fin-client-name"
          className="sm:col-span-2"
        >
          <input
            id="fin-client-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            autoFocus
          />
        </Field>
        <Field label={t("clients.form.phone")} htmlFor="fin-client-phone">
          <input
            id="fin-client-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
            dir="ltr"
            inputMode="tel"
          />
        </Field>
        <Field label={t("clients.form.email")} htmlFor="fin-client-email">
          <input
            id="fin-client-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
            dir="ltr"
          />
        </Field>
        <Field
          label={t("clients.form.notes")}
          htmlFor="fin-client-notes"
          className="sm:col-span-2"
          hint={
            client && client.deals_count > 0
              ? t("clients.form.deleteHint")
              : undefined
          }
        >
          <textarea
            id="fin-client-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={textareaClass}
          />
        </Field>
      </div>
    </Modal>
  );
}
