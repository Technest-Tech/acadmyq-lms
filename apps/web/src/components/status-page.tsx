"use client";

import { FileQuestion, Lock, ServerCrash } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";

type Variant = "notFound" | "server" | "forbidden";

const ICON: Record<Variant, typeof FileQuestion> = {
  notFound: FileQuestion,
  server: ServerCrash,
  forbidden: Lock,
};

/**
 * The shared full-page status surface for 403 / 404 / 500 (Sprint 9 §2, AC-9.11/9.12).
 * Bilingual + RTL via next-intl and CSS logical properties; premium, not a bare stack trace —
 * a large status code, a clear message, and an action. Used by app/not-found, app/error and
 * the /forbidden route so all three read consistently.
 */
export function StatusPage({
  variant,
  action,
}: {
  variant: Variant;
  action?: ReactNode;
}) {
  const t = useTranslations("errors");
  const Icon = ICON[variant];
  const code = t(
    `${variant === "notFound" ? "notFound" : variant === "server" ? "server" : "forbidden"}Code`,
  );
  const titleKey =
    variant === "notFound"
      ? "notFoundTitle"
      : variant === "server"
        ? "serverTitle"
        : "forbiddenTitle";
  const bodyKey =
    variant === "notFound"
      ? "notFoundBody"
      : variant === "server"
        ? "serverBody"
        : "forbiddenBody";

  return (
    <div className="bg-background flex min-h-dvh flex-col items-center justify-center p-6 text-center">
      <div className="from-primary/[0.10] via-card to-card relative w-full max-w-md overflow-hidden rounded-2xl border bg-gradient-to-br p-8 shadow-sm ring-1 ring-foreground/[0.04]">
        <div className="bg-primary/12 text-primary mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl">
          <Icon className="size-7" aria-hidden />
        </div>
        <p className="text-muted-foreground/70 text-5xl font-extrabold tracking-tight tabular-nums">
          {code}
        </p>
        <h1 className="mt-3 text-xl font-bold tracking-tight">{t(titleKey)}</h1>
        <p className="text-muted-foreground mx-auto mt-1.5 max-w-sm text-sm">
          {t(bodyKey)}
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          {action ?? (
            <Link href="/" className={buttonVariants()}>
              {t("goHome")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
