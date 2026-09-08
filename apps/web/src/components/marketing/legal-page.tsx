import { Container } from "@/components/marketing/ui";
import { LEGAL_UPDATED, type LegalContent } from "@/content/marketing";
import type { Locale } from "@/i18n/config";

/**
 * A legal document: the privacy policy and the terms share this layout.
 *
 * Every paragraph is a plain string rendered as text — no `dangerouslySetInnerHTML` anywhere on
 * this site, least of all on a page whose content is supposed to be exactly what it says.
 *
 * The measure is capped at ~65ch. These are the only pages on the site somebody reads top to
 * bottom, and a full-width line is what makes a policy unreadable.
 */
export function LegalPage({
  doc,
  locale,
}: {
  doc: LegalContent;
  locale: Locale;
}) {
  const updated = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${LEGAL_UPDATED}T00:00:00Z`));

  return (
    <Container className="py-16 sm:py-24">
      <article className="mx-auto max-w-[65ch]">
        <h1 className="text-3xl font-bold sm:text-4xl">{doc.title}</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          {doc.updatedLabel}:{" "}
          <time dateTime={LEGAL_UPDATED}>{updated}</time>
        </p>
        <p className="text-muted-foreground mt-6 text-lg leading-relaxed">
          {doc.intro}
        </p>

        <div className="mt-12 flex flex-col gap-10">
          {doc.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-semibold">{section.heading}</h2>
              <div className="mt-3 flex flex-col gap-3">
                {section.paragraphs.map((paragraph) => (
                  <p
                    key={paragraph}
                    className="text-muted-foreground leading-relaxed"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </article>
    </Container>
  );
}
