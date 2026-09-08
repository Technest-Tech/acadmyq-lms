"use client";

import { FileText, RefreshCcw, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLearn, useLearnHref } from "@/components/learn/context";
import { Container, PageHero } from "@/components/learn/sections";

/**
 * The trust pages (docs/lms/10 §6) — terms, refund policy, privacy — on one route because they are
 * the same page with different words.
 *
 * Two layers, deliberately:
 *  - **The client's text**, when they wrote any. Whatever they typed is what shows.
 *  - **The template's default policy** otherwise, translated, so a client who never opened the
 *    editor still has a real refund policy on the day they take their first payment. A shop with no
 *    stated policy is worse for both sides than a sensible standard one.
 *
 * The responsibility line at the bottom is NOT client-editable. It states that the course owner —
 * not the platform — is responsible for the content and for honouring refunds, which is the
 * platform's position and not theirs to reword.
 */

const DOCS = {
  terms: { key: "terms", Icon: FileText },
  refund: { key: "refund", Icon: RefreshCcw },
  privacy: { key: "privacy", Icon: ShieldCheck },
} as const;

type DocKey = keyof typeof DOCS;

export default function LegalPage() {
  const t = useTranslations("learn");
  const href = useLearnHref();
  const { site, siteName } = useLearn();
  const params = useParams<{ doc: string }>();

  const doc = params.doc as DocKey;
  if (!(doc in DOCS)) notFound();

  const { Icon } = DOCS[doc];
  const business = site.legal?.business_name?.trim() || siteName;
  const written = site.legal?.[doc]?.trim() ?? "";
  const body = written || t(`legal.default.${doc}`, { name: business });
  const updated = site.legal?.updated_at?.trim();

  return (
    <>
      <PageHero title={t(`legal.${doc}.title`)} subtitle={t(`legal.${doc}.subtitle`)} />

      <Container className="py-12">
        <div className="mx-auto max-w-3xl">
          <div className="text-muted-foreground mb-6 flex items-center gap-2 text-sm">
            <Icon className="size-4" aria-hidden />
            <span dir="auto">{business}</span>
            {updated && <span className="opacity-70">· {t("legal.updated", { date: updated })}</span>}
          </div>

          {/* The client's words, as written. `whitespace-pre-line` keeps their paragraph breaks
              without letting any markup through. */}
          <div dir="auto" className="text-foreground/90 leading-relaxed whitespace-pre-line">
            {body}
          </div>

          <div className="text-muted-foreground mt-10 rounded-xl border border-dashed p-4 text-sm leading-relaxed">
            {t("legal.responsibility", { name: business })}
          </div>

          <nav
            aria-label={t("footer.legalHeading")}
            className="mt-8 flex flex-wrap gap-4 border-t pt-6 text-sm"
          >
            {/* Back to the shop: a policy page is a cul-de-sac otherwise. */}
            <Link href={href("/courses")} className="text-primary hover:underline">
              {t("catalog.browse")}
            </Link>
            {(Object.keys(DOCS) as DocKey[])
              .filter((d) => d !== doc)
              .map((d) => (
                <Link key={d} href={href(`/legal/${d}`)} className="text-primary hover:underline">
                  {t(`legal.${d}.title`)}
                </Link>
              ))}
            {site.pages.contact && (
              <Link href={href("/contact")} className="text-primary hover:underline">
                {t("nav.contact")}
              </Link>
            )}
          </nav>
        </div>
      </Container>
    </>
  );
}
