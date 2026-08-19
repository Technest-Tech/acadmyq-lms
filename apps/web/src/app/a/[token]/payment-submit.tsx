"use client";

import { apiBase } from "@/lib/api-base";
import { Check, Copy, Loader2, Upload } from "lucide-react";
import { useState } from "react";

export interface ReceivingMethod {
  enabled?: boolean;
  display_name?: string;
  handle?: string;
  number?: string;
}
export type ReceivingMethods = Record<string, ReceivingMethod>;

const API_BASE = apiBase();

function T({ en, ar }: { en: string; ar: string }) {
  return (
    <>
      <span className="ltr:inline rtl:hidden">{en}</span>
      <span className="rtl:inline ltr:hidden">{ar}</span>
    </>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
      <div className="min-w-0">
        <p className="text-muted-foreground text-[11px] uppercase tracking-wide">
          {label}
        </p>
        <p className="truncate font-mono text-sm" dir="ltr">
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="text-muted-foreground hover:text-foreground shrink-0 rounded-md p-1.5"
        aria-label="Copy"
      >
        {copied ? (
          <Check className="size-4 text-emerald-600" />
        ) : (
          <Copy className="size-4" />
        )}
      </button>
    </div>
  );
}

/**
 * Public payment section for an academy bill: shows the platform's InstaPay / Vodafone Cash
 * receiving details and lets the academy upload a transfer screenshot, which a Super Admin reviews.
 */
export function PaymentSubmit({
  token,
  methods,
}: {
  token: string;
  methods: ReceivingMethods;
}) {
  const enabled = Object.entries(methods).filter(([, m]) => m?.enabled !== false);
  const [method, setMethod] = useState<string>(enabled[0]?.[0] ?? "INSTAPAY");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit() {
    if (!file) {
      setError("file");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const body = new FormData();
      body.set("method", method);
      body.set("screenshot", file);
      if (note) body.set("note", note);
      const res = await fetch(`${API_BASE}/api/a/${token}/submit`, {
        method: "POST",
        body,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(String(res.status));
      setDone(true);
    } catch {
      setError("submit");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-center text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        <p className="font-semibold">
          <T en="Payment proof received" ar="تم استلام إثبات الدفع" />
        </p>
        <p className="mt-1 text-sm">
          <T
            en="We'll review your transfer and confirm shortly."
            ar="سنراجع التحويل ونؤكده قريباً."
          />
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold">
          <T en="Pay via" ar="ادفع عبر" />
        </h2>
        <p className="text-muted-foreground mt-0.5 text-xs">
          <T
            en="Transfer the amount to one of the accounts below, then upload a screenshot."
            ar="حوّل المبلغ إلى أحد الحسابات أدناه، ثم ارفع صورة التحويل."
          />
        </p>
      </div>

      {/* Method picker + receiving details */}
      <div className="space-y-2">
        {enabled.map(([key, m]) => (
          <label
            key={key}
            className={`block cursor-pointer rounded-xl border p-3 transition-colors ${
              method === key ? "border-primary ring-2 ring-primary/20" : ""
            }`}
          >
            <div className="flex items-center gap-2">
              <input
                type="radio"
                name="method"
                value={key}
                checked={method === key}
                onChange={() => setMethod(key)}
              />
              <span className="text-sm font-medium">
                {m.display_name ?? key}
              </span>
            </div>
            {method === key && (
              <div className="mt-2 space-y-2">
                {m.handle ? (
                  <CopyRow label="InstaPay" value={m.handle} />
                ) : null}
                {m.number ? (
                  <CopyRow label="Vodafone Cash" value={m.number} />
                ) : null}
              </div>
            )}
          </label>
        ))}
      </div>

      {/* Upload */}
      <label className="block">
        <span className="text-sm font-medium">
          <T en="Transfer screenshot" ar="صورة التحويل" />
        </span>
        <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-dashed px-3 py-3">
          <Upload className="text-muted-foreground size-5 shrink-0" aria-hidden />
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
            aria-label="Transfer screenshot"
          />
        </div>
        {file && (
          <p className="text-muted-foreground mt-1 truncate text-xs">
            {file.name}
          </p>
        )}
      </label>

      <label className="block">
        <span className="text-muted-foreground text-xs">
          <T en="Note (optional)" ar="ملاحظة (اختياري)" />
        </span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="border-input bg-background mt-1 w-full rounded-lg border px-3 py-2 text-sm"
        />
      </label>

      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error === "file" ? (
            <T en="Please attach a screenshot." ar="يرجى إرفاق صورة التحويل." />
          ) : (
            <T
              en="Something went wrong. Please try again."
              ar="حدث خطأ ما. حاول مرة أخرى."
            />
          )}
        </p>
      )}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        className="bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-60"
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        <T en="Submit payment proof" ar="إرسال إثبات الدفع" />
      </button>
    </div>
  );
}
