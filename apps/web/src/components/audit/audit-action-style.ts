import {
  ArrowRightLeft,
  Banknote,
  KeyRound,
  Pencil,
  Plus,
  Trash2,
  type LucideIcon,
} from "lucide-react";

/**
 * Maps an audit `action` (e.g. "invoice.closed", "subscription.price_changed") to a tone for
 * the colour-coded status pill, and to an actor-avatar accent. The mapping is by intent
 * keyword so a new action falls into a sensible default rather than rendering uncoloured.
 */
export type AuditTone =
  | "create"
  | "update"
  | "destroy"
  | "money"
  | "auth"
  | "neutral";

const TONE_RULES: Array<{ test: RegExp; tone: AuditTone }> = [
  {
    test: /(create|created|invite|assign|assigned|set|grant|reactivate)/,
    tone: "create",
  },
  {
    test: /(deactivate|delete|deleted|remove|removed|suspend|revoke|cancel)/,
    tone: "destroy",
  },
  {
    test: /(close|closed|finaliz|mark_paid|marked_paid|accru|price_changed|plan_changed|addon_changed|link_sent)/,
    tone: "money",
  },
  { test: /(login|logout|enter_academy)/, tone: "auth" },
  {
    test: /(update|updated|configure|change|changed|reassign|reschedul|override|edit)/,
    tone: "update",
  },
];

export function auditTone(action: string): AuditTone {
  for (const rule of TONE_RULES) {
    if (rule.test.test(action)) return rule.tone;
  }
  return "neutral";
}

export const TONE_PILL: Record<AuditTone, string> = {
  create:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  update: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  destroy: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  money: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  auth: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  neutral: "bg-muted text-foreground/70",
};

export const TONE_DOT: Record<AuditTone, string> = {
  create: "bg-emerald-500",
  update: "bg-blue-500",
  destroy: "bg-rose-500",
  money: "bg-amber-500",
  auth: "bg-violet-500",
  neutral: "bg-foreground/40",
};

export const TONE_AVATAR: Record<AuditTone, string> = {
  create:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
  update: "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  destroy: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  money: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  auth: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  neutral: "bg-primary/10 text-primary",
};

export const TONE_ICON: Record<AuditTone, LucideIcon> = {
  create: Plus,
  update: Pencil,
  destroy: Trash2,
  money: Banknote,
  auth: KeyRound,
  neutral: ArrowRightLeft,
};

/**
 * Turns a dotted/underscored audit action (e.g. "invoice.mark_paid") into a readable phrase
 * ("Invoice · Mark paid"). Used by the dashboard activity feed where raw machine codes read
 * poorly; the full audit log keeps the exact code for forensic precision.
 */
export function humanizeAction(action: string): string {
  return action
    .split(".")
    .map((seg) =>
      seg
        .split("_")
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(" "),
    )
    .join(" · ");
}

/** Two-letter initials for an actor avatar chip; falls back to a system glyph. */
export function actorInitials(name?: string | null): string {
  if (!name) return "•";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "•";
}
