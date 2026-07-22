"use client";

import { Award, Printer } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { learnCertificate, LearnApiError, type LearnCertificate } from "@/lib/learn-api";
import { useLearn } from "../../learn-provider";

/**
 * The printable course-completion certificate (docs/lms/04). Fetches the learner's certificate for
 * the course; shows a "not earned yet" prompt until every lesson is complete.
 */
export default function CertificatePage() {
  const t = useTranslations("learn.certificate");
  const { academy, requireAuth } = useLearn();
  const slug = useParams<{ slug: string }>().slug;

  const [cert, setCert] = useState<LearnCertificate | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "auth" | "missing" | "error">("loading");

  const load = useCallback(() => {
    setState("loading");
    learnCertificate(academy, slug)
      .then((c) => {
        setCert(c);
        setState("ready");
      })
      .catch((e) => {
        if (e instanceof LearnApiError && e.status === 401) setState("auth");
        else if (e instanceof LearnApiError && e.status === 404) setState("missing");
        else setState("error");
      });
  }, [academy, slug]);

  useEffect(() => {
    load();
  }, [load]);

  if (state === "loading") return <p className="text-muted-foreground py-16 text-center text-sm">…</p>;
  if (state === "auth") {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground mb-4 text-sm">{t("signInNeeded")}</p>
        <button
          onClick={() => requireAuth(load)}
          className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm"
        >
          {t("signIn")}
        </button>
      </div>
    );
  }
  if (state === "missing") {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground mb-4 text-sm">{t("notEarned")}</p>
        <Link href={`/learn/${academy}/watch/${slug}`} className="text-primary text-sm hover:underline">
          {t("keepLearning")}
        </Link>
      </div>
    );
  }
  if (state === "error" || !cert) {
    return <p className="text-muted-foreground py-16 text-center text-sm">{t("failed")}</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex justify-end print:hidden">
        <button
          onClick={() => window.print()}
          className="border-input hover:bg-muted inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm"
        >
          <Printer className="size-4" /> {t("print")}
        </button>
      </div>

      <div className="relative overflow-hidden rounded-2xl border-4 border-double border-amber-300/70 bg-gradient-to-b from-amber-50 to-white p-10 text-center dark:from-amber-950/20 dark:to-transparent">
        <Award className="mx-auto size-12 text-amber-500" />
        <p className="text-muted-foreground mt-4 text-xs uppercase tracking-widest">{t("heading")}</p>
        <p className="mt-6 text-2xl font-semibold">{cert.learner_name}</p>
        <p className="text-muted-foreground mt-2 text-sm">{t("hasCompleted")}</p>
        <p className="mt-1 text-lg font-medium">{cert.course_title}</p>
        <div className="text-muted-foreground mt-8 flex items-center justify-between text-xs">
          <span>{t("serial")}: {cert.serial}</span>
          {cert.issued_at && <span>{new Date(cert.issued_at).toLocaleDateString()}</span>}
        </div>
      </div>
    </div>
  );
}
