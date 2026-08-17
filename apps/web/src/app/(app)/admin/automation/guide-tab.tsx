"use client";

import { CheckCircle2, Code2, Info, ListOrdered, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatusPill } from "./manage-modal";

export function GuideTab() {
  const t = useTranslations("adminAutomation");

  const statuses: Array<{ state: string; desc: string }> = [
    { state: "connected", desc: t("guide.sConnected") },
    { state: "qr", desc: t("guide.sQr") },
    { state: "disconnected", desc: t("guide.sDisconnected") },
    { state: "logged_out", desc: t("guide.sLoggedOut") },
    { state: "none", desc: t("guide.sNone") },
  ];
  const steps = [t("guide.step1"), t("guide.step2"), t("guide.step3"), t("guide.step4")];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Statuses legend */}
      <section className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Info className="text-primary size-4" aria-hidden />
          {t("guide.statusesTitle")}
        </h3>
        <ul className="space-y-2.5">
          {statuses.map((s) => (
            <li key={s.state} className="flex items-center gap-3">
              <span className="w-28 shrink-0"><StatusPill state={s.state} /></span>
              <span className="text-muted-foreground text-sm">{s.desc}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Steps */}
      <section className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06]">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <ListOrdered className="text-primary size-4" aria-hidden />
          {t("guide.stepsTitle")}
        </h3>
        <ol className="space-y-3">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">{i + 1}</span>
              <span className="text-muted-foreground pt-0.5 text-sm">{step}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Reliability */}
      <section className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06] lg:col-span-2">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="text-emerald-600 size-4" aria-hidden />
          {t("guide.reliabilityTitle")}
        </h3>
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
          {t("guide.reliability")}
        </p>
      </section>

      {/* External API (for developers) */}
      <section className="bg-card rounded-xl p-5 shadow-sm ring-1 ring-foreground/[0.06] lg:col-span-2">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Code2 className="text-primary size-4" aria-hidden />
          {t("guide.apiTitle")}
        </h3>
        <p className="text-muted-foreground mb-3 text-sm">{t("guide.apiIntro")}</p>
        <div className="bg-muted/50 overflow-x-auto rounded-lg p-3 font-mono text-xs" dir="ltr">
          <p className="text-muted-foreground"># {t("guide.apiAuth")}</p>
          <p>Authorization: Bearer wa_…</p>
          <p className="mt-2">POST /api/wa/v1/messages &#123; to, text &#125;</p>
          <p>POST /api/wa/v1/messages &#123; to, image_url, caption &#125;</p>
          <p>GET&nbsp;&nbsp;/api/wa/v1/contacts/&#123;phone&#125;</p>
          <p>GET&nbsp;&nbsp;/api/wa/v1/status</p>
        </div>
      </section>
    </div>
  );
}
