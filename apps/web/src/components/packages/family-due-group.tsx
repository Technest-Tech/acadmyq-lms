"use client";

import { CircleDollarSign, MessageSquare, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useInvoiceUrl } from "@/components/invoices/use-invoice-url";
import { Button } from "@/components/ui/button";
import type { LessonPackageRow } from "@/lib/api";
import { formatMoney } from "@/lib/money";

/** One family on the Due page: a parent and every package their children still owe on. */
export interface DueFamily {
  /** The guardian's id — or the student's, for a row that carries no family. */
  key: string;
  name: string;
  phone: string | null;
  /** The children with a package due, in the order their debts first appear. */
  children: string[];
  rows: LessonPackageRow[];
}

/**
 * Gathers due packages under their family, keeping the order they came in — the page sorts oldest
 * debt first, so a family sits where its oldest debt would.
 */
export function groupDueByFamily(rows: LessonPackageRow[]): DueFamily[] {
  const families = new Map<string, DueFamily>();
  for (const row of rows) {
    const key = row.guardian_id ?? `student:${row.student_id}`;
    let family = families.get(key);
    if (family === undefined) {
      family = {
        key,
        name: row.guardian_name ?? row.student_name,
        phone: row.guardian_phone ?? null,
        children: [],
        rows: [],
      };
      families.set(key, family);
    }
    family.rows.push(row);
    if (!family.children.includes(row.student_name)) family.children.push(row.student_name);
  }
  return [...families.values()];
}

/** What the family owes, per currency — money is never summed across currencies. */
function owed(rows: LessonPackageRow[]): { currency: string; amount_minor: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (r.outstanding_minor > 0) by.set(r.currency, (by.get(r.currency) ?? 0) + r.outstanding_minor);
  }
  return [...by.entries()].map(([currency, amount_minor]) => ({ currency, amount_minor }));
}

/**
 * A family's card on the Due page: the parent's name, their children, what the family owes in
 * total, and one WhatsApp message carrying every child's payment link. Each package keeps its own
 * bill — paying a link still marks exactly that package paid — the family just hears about them
 * together. The packages' own cards sit inside, actions and all.
 */
export function FamilyDueGroup({
  family,
  canSendInvoice,
  onMessageOpened,
  children,
}: {
  family: DueFamily;
  canSendInvoice: boolean;
  onMessageOpened: () => void;
  children: React.ReactNode;
}) {
  const t = useTranslations("packages.family");
  const locale = useLocale();
  const invoiceUrl = useInvoiceUrl();
  const totals = owed(family.rows);
  const payable = family.rows.filter((r) => r.invoice_token !== null && r.outstanding_minor > 0);
  const money = (amount: number, currency: string) => formatMoney({ amount, currency }, locale);

  function sendFamilyMessage() {
    const lines = [
      t("messageGreeting", { name: family.name }),
      t("messageIntro"),
      "",
      ...payable.flatMap((r) => [
        t("messageLine", { child: r.student_name, label: r.label, amount: money(r.outstanding_minor, r.currency) }),
        invoiceUrl(r.invoice_token as string),
      ]),
      "",
      t("messageTotal", { total: owed(payable).map((o) => money(o.amount_minor, o.currency)).join(" + ") }),
      t("messageOutro"),
    ];
    const text = encodeURIComponent(lines.join("\n"));
    const digits = (family.phone ?? "").replace(/\D+/g, "");
    window.open(digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
    onMessageOpened();
  }

  return (
    <section className="bg-card overflow-hidden rounded-2xl border shadow-sm" data-testid={`due-family-${family.key}`}>
      <div className="flex flex-col gap-3 border-b bg-rose-500/[0.04] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <Users className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs font-medium">{t("guardian")}</p>
            <h3 className="font-semibold break-words" data-testid="due-family-name">
              {family.name}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-sm break-words">
              {t("children", { count: family.children.length, names: family.children.join("، ") })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {totals.map((o) => (
            <span
              key={o.currency}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3 py-1 text-xs font-bold text-white tabular-nums shadow-sm"
              data-testid="due-family-total"
            >
              <CircleDollarSign className="size-3.5" aria-hidden />
              {t("total", { amount: money(o.amount_minor, o.currency) })}
            </span>
          ))}
          {canSendInvoice && payable.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={sendFamilyMessage} data-testid="due-family-send">
              <MessageSquare className="size-3.5" aria-hidden />
              {payable.length > 1 ? t("sendAll", { count: payable.length }) : t("sendOne")}
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 items-stretch gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}
