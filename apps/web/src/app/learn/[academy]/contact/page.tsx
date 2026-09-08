"use client";

import { Clock, Mail, MapPin, Phone, Ticket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ComponentType } from "react";
import { useLearn } from "@/components/learn/context";
import {
  Container,
  CtaButton,
  PageHero,
  Section,
  SectionHeading,
} from "@/components/learn/sections";
import { useSocialLinks, whatsappHref } from "@/components/learn/site-chrome";
import { WhatsappIcon } from "@/components/learn/social-icons";
import { learnCatalog, type LearnCourseCard } from "@/lib/learn-api";

/**
 * How to reach the academy (docs/lms/09 §7).
 *
 * Deliberately NOT a message form: there is no inbox behind the LMS to deliver one to, and a form
 * that silently drops what a prospective student wrote is worse than no form. Every channel here is
 * one the client actually monitors — and the "ask about a course" block below composes a real
 * WhatsApp or email message with the course already named, which is the same thing a contact form
 * would have done except that it arrives somewhere.
 *
 * The other rule this page now keeps: it NEVER tells a visitor that the shop has no contact details
 * yet. That sentence ("لم تُضَف بيانات التواصل بعد") used to be the whole page for an unconfigured
 * client — a public admission of an empty settings screen. A client with nothing filled in gets a
 * finished page pointing at the catalogue instead.
 */
export default function ContactPage() {
  const t = useTranslations("learn");
  const { academy, site, siteName, commerce, openRedeem } = useLearn();
  const socials = useSocialLinks();

  if (!site.pages.contact) notFound();

  const { contact } = site;
  const channels = [
    contact.whatsapp && {
      Icon: WhatsappIcon,
      label: t("contact.whatsapp"),
      value: contact.whatsapp,
      href: whatsappHref(contact.whatsapp, t("whatsapp.prefill", { name: siteName })),
    },
    contact.phone && {
      Icon: Phone,
      label: t("contact.phone"),
      value: contact.phone,
      href: `tel:${contact.phone.replace(/[^\d+]/g, "")}`,
    },
    contact.email && {
      Icon: Mail,
      label: t("contact.email"),
      value: contact.email,
      href: `mailto:${contact.email}`,
    },
    contact.address && {
      Icon: MapPin,
      label: t("contact.address"),
      value: contact.address,
      href: null,
    },
    contact.hours && {
      Icon: Clock,
      label: t("contact.hours"),
      value: contact.hours,
      href: null,
    },
  ].filter(Boolean) as {
    Icon: ComponentType<{ className?: string }> | LucideIcon;
    label: string;
    value: string;
    href: string | null;
  }[];

  const canAsk = Boolean(contact.whatsapp || contact.email);

  return (
    <>
      <PageHero
        title={t("contact.title")}
        subtitle={t("contact.subtitle", { name: siteName })}
      />

      <Section>
        {channels.length > 0 ? (
          <ul className="grid gap-5 sm:grid-cols-2">
            {channels.map(({ Icon, label, value, href }) => {
              const body = (
                <>
                  <span className="text-primary mb-3 flex size-11 items-center justify-center rounded-xl bg-[var(--brand-soft)]">
                    <Icon className="size-5" />
                  </span>
                  <span className="text-muted-foreground block text-xs font-semibold tracking-wide uppercase">
                    {label}
                  </span>
                  <span className="mt-1 block font-medium break-words">
                    {value}
                  </span>
                </>
              );
              return (
                <li key={label}>
                  {href ? (
                    <a
                      href={href}
                      target={href.startsWith("http") ? "_blank" : undefined}
                      rel={
                        href.startsWith("http")
                          ? "noopener noreferrer"
                          : undefined
                      }
                      className="bg-card hover:border-primary/40 focus-visible:ring-ring/60 block h-full rounded-2xl border p-6 transition-[border-color,box-shadow] hover:shadow-md focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {body}
                    </a>
                  ) : (
                    <div className="bg-card h-full rounded-2xl border p-6">
                      {body}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          // No channel configured. Say something useful about the shop instead of about its setup.
          <div className="bg-card mx-auto max-w-xl rounded-2xl border p-8 text-center sm:p-10">
            <h2 className="text-xl font-bold">{t("contact.fallbackTitle")}</h2>
            <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-relaxed">
              {t("contact.fallbackBody")}
            </p>
            <CtaButton className="mt-6" href={`/learn/${academy}/courses`}>
              {t("catalog.browse")}
            </CtaButton>
          </div>
        )}

        {socials.length > 0 && (
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground text-sm font-medium">
              {t("contact.follow")}
            </span>
            {socials.map(({ key, href, label, Icon }) => (
              <a
                key={key}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className="border-border hover:border-primary/50 hover:text-primary text-muted-foreground focus-visible:ring-ring/60 flex size-10 items-center justify-center rounded-xl border transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <Icon className="size-4" />
              </a>
            ))}
          </div>
        )}

        {contact.map_url && (
          <div className="mt-10 overflow-hidden rounded-2xl border">
            <iframe
              src={contact.map_url}
              title={t("contact.map")}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-80 w-full"
            />
          </div>
        )}
      </Section>

      {canAsk && <AskAboutCourse />}

      {/* The code block is for clients who actually hand codes out; on a site that sells online it
          would be the loudest thing on the page for the least common path. */}
      {commerce.codes && (
        <Container className="pb-16 sm:pb-20">
          <div className="bg-card flex flex-col items-center gap-4 rounded-2xl border p-6 text-center sm:flex-row sm:justify-between sm:p-7 sm:text-start">
            <div>
              <h2 className="font-bold">{t("contact.haveCode")}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {t("redeem.hint")}
              </p>
            </div>
            <CtaButton variant="outline" size="md" onClick={openRedeem}>
              <Ticket className="size-4" aria-hidden />
              {t("redeem.cta")}
            </CtaButton>
          </div>
        </Container>
      )}
    </>
  );
}

/**
 * "Ask about a course" — the nearest honest thing to a contact form on a platform with no inbox.
 *
 * Picking a course composes the message for the visitor and hands it to a channel the client
 * actually reads. Rendered only when there IS such a channel, so it can never become a button that
 * goes nowhere.
 */
function AskAboutCourse() {
  const t = useTranslations("learn");
  const { academy, site, siteName } = useLearn();
  const [courses, setCourses] = useState<LearnCourseCard[] | null>(null);
  const [slug, setSlug] = useState("");

  useEffect(() => {
    learnCatalog(academy)
      .then((r) => setCourses(r.courses))
      .catch(() => setCourses([]));
  }, [academy]);

  const chosen = (courses ?? []).find((c) => c.slug === slug) ?? null;
  const message = chosen
    ? t("whatsapp.aboutCourse", { name: siteName, course: chosen.title })
    : t("whatsapp.prefill", { name: siteName });

  // Nothing to choose between — the generic channels above already say everything.
  if (courses !== null && courses.length === 0) return null;

  return (
    <Section tone="muted">
      <div className="mx-auto max-w-2xl">
        <SectionHeading
          title={t("contact.askTitle")}
          subtitle={t("contact.askHint")}
        />
        <div className="bg-card space-y-4 rounded-2xl border p-6">
          <div className="space-y-1.5">
            <label
              htmlFor="contact-course"
              className="block text-sm font-medium"
            >
              {t("contact.courseLabel")}
            </label>
            <select
              id="contact-course"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              disabled={courses === null}
              className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-11 w-full rounded-xl border px-3.5 text-sm outline-none transition-shadow focus-visible:ring-4 disabled:opacity-60"
            >
              <option value="">
                {courses === null
                  ? t("contact.loadingCourses")
                  : t("contact.courseAny")}
              </option>
              {(courses ?? []).map((course) => (
                <option key={course.id} value={course.slug}>
                  {course.title}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            {site.contact.whatsapp && (
              <CtaButton
                className="flex-1"
                href={whatsappHref(site.contact.whatsapp, message)}
              >
                <WhatsappIcon className="size-4" />
                {t("contact.askOnWhatsapp")}
              </CtaButton>
            )}
            {site.contact.email && (
              <CtaButton
                variant="outline"
                className="flex-1"
                href={`mailto:${site.contact.email}?subject=${encodeURIComponent(
                  chosen ? chosen.title : siteName,
                )}&body=${encodeURIComponent(message)}`}
              >
                <Mail className="size-4" aria-hidden />
                {t("contact.askByEmail")}
              </CtaButton>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}
