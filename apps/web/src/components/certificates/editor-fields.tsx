"use client";

import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { CERT_HEIGHT, CERT_WIDTH, type CertLang } from "./kit";
import { cn } from "@/lib/utils";

/** The small vocabulary the certificate editor is built from, so every panel reads the same. */

export const inputClass =
  "border-input bg-background placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-primary/20 h-9 w-full rounded-lg border px-3 text-sm shadow-xs outline-none transition-colors focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-60";

export const textareaClass =
  "border-input bg-background placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-primary/20 w-full resize-y rounded-lg border px-3 py-2 text-sm leading-relaxed shadow-xs outline-none transition-colors focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-60";

export function Field({
  id,
  label,
  hint,
  optional,
  optionalLabel,
  aside,
  children,
}: {
  id?: string;
  label: string;
  hint?: string;
  optional?: boolean;
  optionalLabel?: string;
  /** End-side text on the label row — a character count, a small action. */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-foreground/85 text-xs font-semibold">
          {label}
          {optional && optionalLabel && (
            <span className="text-muted-foreground ms-1.5 font-normal">({optionalLabel})</span>
          )}
        </label>
        {aside}
      </div>
      {children}
      {hint && <p className="text-muted-foreground text-[11px] leading-snug">{hint}</p>}
    </div>
  );
}

/** A titled group inside a panel. */
export function FieldGroup({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-muted-foreground flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase">
          {Icon && <Icon className="size-3.5" aria-hidden />}
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A pill-shaped either/or switch. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  className,
  testId,
}: {
  value: T;
  options: { value: T; label: string; icon?: ComponentType<{ className?: string }> }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn("bg-muted/70 inline-flex rounded-lg p-0.5", className)} data-testid={testId}>
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          data-value={v}
          onClick={() => onChange(v)}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-all",
            size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-sm",
            value === v
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {Icon && <Icon className="size-3.5" aria-hidden />}
          {label}
        </button>
      ))}
    </div>
  );
}

/** Which language's wording the fields below edit — the same switch that drives the preview. */
export function LangSwitch({
  lang,
  onChange,
  labels,
}: {
  lang: CertLang;
  onChange: (lang: CertLang) => void;
  labels: { en: string; ar: string };
}) {
  return (
    <Segmented
      size="sm"
      value={lang}
      onChange={onChange}
      options={[
        { value: "en", label: labels.en },
        { value: "ar", label: labels.ar },
      ]}
    />
  );
}

/** A toggle switch with its label. */
export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label className={cn("flex items-start justify-between gap-3", disabled ? "opacity-60" : "cursor-pointer")}>
      <span className="min-w-0">
        <span className="text-foreground/85 block text-xs font-semibold">{label}</span>
        {hint && <span className="text-muted-foreground mt-0.5 block text-[11px] leading-snug">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed",
          checked ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "bg-background inline-block size-4 rounded-full shadow-sm transition-transform",
            checked ? "translate-x-[18px] rtl:-translate-x-[18px]" : "translate-x-0.5 rtl:-translate-x-0.5",
          )}
        />
      </button>
    </label>
  );
}

/**
 * Scales the fixed 1123×794 certificate to whatever width its container gives it. The box keeps the
 * page's aspect ratio, so nothing has to be measured to know its height.
 */
export function ScaledCertificate({ children, className }: { children: ReactNode; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale((el.clientWidth || CERT_WIDTH) / CERT_WIDTH);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    // `dir="ltr"` keeps the scaling box anchored top-left on an RTL page so the transform stays in
    // frame; the certificate sets its own text direction inside.
    <div
      ref={wrapRef}
      dir="ltr"
      className={cn("relative w-full overflow-hidden", className)}
      style={{ aspectRatio: `${CERT_WIDTH} / ${CERT_HEIGHT}` }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: CERT_WIDTH,
          height: CERT_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
