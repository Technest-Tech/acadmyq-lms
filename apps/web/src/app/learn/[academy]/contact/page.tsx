"use client";

import { Mail, MapPin, Phone, Ticket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ComponentType } from "react";
import { useLearn } from "@/components/learn/context";
import {
  Container,
  CtaButton,
  PageHero,
  Section,
} from "@/components/learn/sections";
import { useSocialLinks, whatsappHref } from "@/components/learn/site-chrome";
import { WhatsappIcon } from "@/components/learn/social-icons";

/**
 * How to reach the academy (docs/lms/09). Deliberately NOT a message form: there is no inbox behind
 * the LMS to deliver one to, and a form that silently drops what a prospective student wrote is
 * worse than no form. Every channel here is one the client actually monitors.
 */
export default function ContactPage() {
  const t = useTranslations("learn");
  const { site, siteName, openRedeem } = useLearn();
  const socials = useSocialLinks();

  if (!site.pages.contact) notFound();

  const { contact } = site;
  const channels = [
    contact.whatsapp && {
      Icon: WhatsappIcon,
      label: t("contact.whatsapp"),
      value: contact.whatsapp,
      href: whatsappHref(contact.whatsapp),
    },
    contact.phone && {
      Icon: Phone,
      label: t("contact.phone"),
      value: contact.phone,
      href: `tel:${contact.phone}`,
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
  ].filter(Boolean) as {
    Icon: ComponentType<{ className?: string }> | LucideIcon;
    label: string;
    value: string;
    href: string | null;
  }[];

  return (
    <>
      <PageHero
        title={t("contact.title")}
        subtitle={t("contact.subtitle", { name: siteName })}
      />

      <Section>
        {channels.length > 0 ? (
          <div className="grid gap-5 sm:grid-cols-2">
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
              return href ? (
                <a
                  key={label}
                  href={href}
                  target={href.startsWith("http") ? "_blank" : undefined}
                  rel={
                    href.startsWith("http") ? "noopener noreferrer" : undefined
                  }
                  className="bg-card hover:border-primary/40 rounded-2xl border p-6 transition-all hover:shadow-lg"
                >
                  {body}
                </a>
              ) : (
                <div key={label} className="bg-card rounded-2xl border p-6">
                  {body}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-muted-foreground rounded-2xl border border-dashed py-16 text-center text-sm">
            {t("contact.empty")}
          </p>
        )}

        {socials.length > 0 && (
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <span className="text-muted-foreground text-sm font-medium">
              {t("contact.follow")}
            </span>
            {socials.map(({ key, href, Icon }) => (
              <a
                key={key}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={key}
                className="border-border hover:border-primary/50 hover:text-primary text-muted-foreground flex size-10 items-center justify-center rounded-xl border transition-colors"
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

      <Container className="pb-20 text-center">
        <div className="bg-card rounded-2xl border p-10">
          <h2 className="text-xl font-bold">{t("contact.haveCode")}</h2>
          <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
            {t("redeem.hint")}
          </p>
          <CtaButton className="mt-6" onClick={openRedeem}>
            <Ticket className="size-4" aria-hidden />
            {t("redeem.cta")}
          </CtaButton>
        </div>
      </Container>
    </>
  );
}
