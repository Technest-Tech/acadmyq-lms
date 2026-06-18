"use client";

import { ArrowRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import type { AuditEntry } from "@/lib/api";
import { formatLocalDateTime } from "@/lib/time";
import {
  actorInitials,
  auditTone,
  TONE_AVATAR,
  TONE_DOT,
  TONE_PILL,
} from "@/components/audit/audit-action-style";

/** Render a before/after value compactly (objects → JSON, null → em dash). */
function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * The expandable detail for one audit entry: actor, action, entity, timestamp, and a
 * field-by-field before → after diff. Changed fields are highlighted; a created/deleted
 * entry shows just its after/before snapshot. Read-only — the audit log is append-only.
 */
export function AuditDetailModal({
  entry,
  onClose,
}: {
  entry: AuditEntry | null;
  onClose: () => void;
}) {
  const t = useTranslations("audit");
  const locale = useLocale();

  // Nothing selected → render nothing (the Modal is closed anyway).
  if (entry === null) {
    return null;
  }

  const tone = auditTone(entry.action);
  const before = entry.before ?? {};
  const after = entry.after ?? {};
  const keys = Array.from(
    new Set([...Object.keys(before), ...Object.keys(after)]),
  );

  return (
    <Modal
      open={entry !== null}
      onClose={onClose}
      size="lg"
      title={t("detailTitle")}
      description={formatLocalDateTime(entry.created_at, locale)}
    >
      <div className="space-y-5">
        {/* Actor + action header */}
        <div className="flex items-center gap-3">
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${TONE_AVATAR[tone]}`}
            aria-hidden
          >
            {actorInitials(entry.actor_name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {entry.actor_name ?? t("systemActor")}
            </p>
            <p className="text-muted-foreground truncate text-xs">
              {entry.actor_role ? t(`roles.${entry.actor_role}`) : "—"}
              {entry.academy_name ? ` · ${entry.academy_name}` : ""}
            </p>
          </div>
          <span
            className={`ms-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_PILL[tone]}`}
          >
            <span
              className={`size-1.5 rounded-full ${TONE_DOT[tone]}`}
              aria-hidden
            />
            {entry.action}
          </span>
        </div>

        {/* Entity meta */}
        <div className="bg-muted/40 grid grid-cols-2 gap-3 rounded-xl border p-3 text-xs">
          <div>
            <p className="text-muted-foreground">{t("colEntity")}</p>
            <p className="mt-0.5 font-medium">{entry.entity_type}</p>
          </div>
          <div className="text-end">
            <p className="text-muted-foreground">{t("entityId")}</p>
            <p className="mt-0.5 truncate font-mono text-[11px]" dir="ltr">
              {entry.entity_id ?? "—"}
            </p>
          </div>
        </div>

        {/* Before → after diff */}
        {keys.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noChanges")}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <div className="bg-muted/30 text-muted-foreground grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-wide">
              <span>{t("before")}</span>
              <span />
              <span>{t("after")}</span>
            </div>
            <ul className="divide-y">
              {keys.map((key) => {
                const b = display((before as Record<string, unknown>)[key]);
                const a = display((after as Record<string, unknown>)[key]);
                const changed = b !== a;
                return (
                  <li
                    key={key}
                    className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 text-xs"
                  >
                    <span className="min-w-0">
                      <span className="text-muted-foreground block text-[10px] uppercase tracking-wide">
                        {key}
                      </span>
                      <span
                        className={
                          changed
                            ? "text-rose-600 line-through dark:text-rose-400"
                            : ""
                        }
                      >
                        {b}
                      </span>
                    </span>
                    <ArrowRight
                      className="text-muted-foreground/50 size-3.5 rtl:rotate-180"
                      aria-hidden
                    />
                    <span
                      className={`min-w-0 ${changed ? "font-semibold text-emerald-600 dark:text-emerald-400" : ""}`}
                    >
                      <span className="text-muted-foreground block text-[10px] uppercase tracking-wide">
                        {key}
                      </span>
                      {a}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
