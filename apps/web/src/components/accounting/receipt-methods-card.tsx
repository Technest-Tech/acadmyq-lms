"use client";

import { CreditCard, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { METHOD_ICON } from "@/components/accounting/accounting-ui";
import { apiErrorMessage } from "@/components/groups/group-form";
import { AlertBanner } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getReceiptMethods, updateReceiptMethods, type ReceiptMethod } from "@/lib/accounting-api";
import { cn } from "@/lib/utils";

/**
 * Which payment methods the desk takes (Lingo 2026-11-15: "remove every option but bank transfer,
 * InstaPay and wallet — especially cash"). A per-academy setting, never a change for anyone else:
 * an academy that never ticks anything keeps them all. The server refuses an unticked method too.
 */
export function ReceiptMethodsCard() {
  const t = useTranslations("accounting");
  const [state, setState] = useState<{ methods: ReceiptMethod[]; all: ReceiptMethod[]; can_manage: boolean } | null>(null);
  const [picked, setPicked] = useState<ReceiptMethod[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    getReceiptMethods()
      .then((s) => {
        setState(s);
        setPicked(s.methods);
      })
      .catch(() => setState(null));
  }, []);

  if (!state) return null;
  const dirty = picked.length !== state.methods.length || picked.some((m) => !state.methods.includes(m));

  async function save() {
    if (picked.length === 0) {
      setError(t("methods.atLeastOne"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await updateReceiptMethods(picked);
      setState((s) => (s ? { ...s, methods: res.methods } : s));
      setPicked(res.methods);
      setNotice(t("methods.saved"));
    } catch (err) {
      setError(apiErrorMessage(err, t("treasury.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-card rounded-2xl border p-4 shadow-sm" data-testid="receipt-methods-card">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <CreditCard className="text-primary size-4" aria-hidden />
        {t("methods.title")}
      </h3>
      <p className="text-muted-foreground mt-1 text-xs">{t("methods.hint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {state.all.map((m) => {
          const Icon = METHOD_ICON[m];
          const on = picked.includes(m);
          return (
            <button
              key={m}
              type="button"
              role="checkbox"
              aria-checked={on}
              disabled={!state.can_manage}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== m) : [...p, m]))}
              className={cn(
                "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed",
                on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
              )}
              data-testid={`receipt-method-${m}`}
            >
              <Icon className="size-4" aria-hidden />
              {t(`method.${m}`)}
            </button>
          );
        })}
      </div>
      {error && <div className="mt-2"><AlertBanner variant="error" message={error} onDismiss={() => setError(null)} /></div>}
      {notice && <div className="mt-2"><AlertBanner variant="success" message={notice} onDismiss={() => setNotice(null)} /></div>}
      {state.can_manage && dirty && (
        <div className="mt-3 flex justify-end">
          <Button type="button" size="sm" onClick={() => void save()} disabled={busy} data-testid="receipt-methods-save">
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            {t("methods.save")}
          </Button>
        </div>
      )}
    </section>
  );
}
