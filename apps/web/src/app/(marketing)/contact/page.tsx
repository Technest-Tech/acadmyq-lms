import type { Metadata } from "next";
import { DemoForm } from "@/components/marketing/demo-form";
import { CheckItem, Container } from "@/components/marketing/ui";
import { CONTACT, marketing, ROUTES } from "@/content/marketing";
import { pageMetadata } from "../page-meta";

/**
 * The contact page: the demo-request form, and an honest account of what happens after you send it.
 *
 * The email and phone block appears only when the deployment configured one
 * (`NEXT_PUBLIC_CONTACT_EMAIL` / `NEXT_PUBLIC_CONTACT_PHONE`). Unset, the page says the form is the
 * route to us — which is true — rather than printing an address nobody reads.
 */

export async function generateMetadata(): Promise<Metadata> {
  const { locale, t } = await marketing();

  return pageMetadata({
    meta: t.meta.contact,
    path: ROUTES.contact,
    ogImage: "/marketing/og-home.png",
    locale,
  });
}

export default async function ContactPage() {
  const { locale, t } = await marketing();
  const hasContact = Boolean(CONTACT.email || CONTACT.phone);

  return (
    <Container className="py-16 sm:py-24">
      <div className="grid items-start gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <div>
          <h1 className="text-4xl font-bold text-balance sm:text-5xl">
            {t.contact.hero.title}
          </h1>
          <p className="text-muted-foreground mt-5 text-lg leading-relaxed text-pretty">
            {t.contact.hero.subtitle}
          </p>

          <section className="mt-10">
            <h2 className="text-lg font-semibold">{t.contact.expect.title}</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {t.contact.expect.items.map((item) => (
                <CheckItem key={item}>{item}</CheckItem>
              ))}
            </ul>
          </section>

          <section className="border-border mt-10 border-t pt-8">
            <h2 className="text-lg font-semibold">{t.contact.reach.title}</h2>
            <p className="text-muted-foreground mt-3 leading-relaxed">
              {t.contact.reach.body}
            </p>

            {hasContact ? (
              <dl className="mt-5 flex flex-col gap-3 text-sm">
                {CONTACT.email ? (
                  <div className="flex flex-wrap items-baseline gap-2">
                    <dt className="text-muted-foreground">
                      {t.footer.emailLabel}
                    </dt>
                    <dd>
                      <a
                        href={`mailto:${CONTACT.email}`}
                        className="text-primary focus-visible:outline-ring rounded font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        {CONTACT.email}
                      </a>
                    </dd>
                  </div>
                ) : null}
                {CONTACT.phone ? (
                  <div className="flex flex-wrap items-baseline gap-2">
                    <dt className="text-muted-foreground">
                      {t.footer.phoneLabel}
                    </dt>
                    <dd>
                      <a
                        href={`tel:${CONTACT.phone.replace(/[^\d+]/g, "")}`}
                        dir="ltr"
                        className="text-primary focus-visible:outline-ring inline-block rounded font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                      >
                        {CONTACT.phone}
                      </a>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </section>
        </div>

        <DemoForm t={t} locale={locale} />
      </div>
    </Container>
  );
}
