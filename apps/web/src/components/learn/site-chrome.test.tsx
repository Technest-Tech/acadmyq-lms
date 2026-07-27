import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import {
  LearnContext,
  type LearnContextValue,
} from "@/components/learn/context";
import {
  SiteWhatsappButton,
  useRequestCodeHref,
  whatsappHref,
} from "@/components/learn/site-chrome";
import type { LearnSiteContent } from "@/lib/learn-api";
import type { ReactNode } from "react";
import enMessages from "../../../messages/en.json";

/**
 * The floating WhatsApp button (docs/lms/09). Its whole contract is "the client's number or
 * nothing", so that is what these cover: a blank number must not leave a dead link on the site.
 */

function siteWith(whatsapp: string): LearnSiteContent {
  return {
    brand: {
      name: "Noor",
      tagline: "",
      logo_url: "",
      color: "#12836a",
      hero_style: "gradient",
    },
    hero: {
      eyebrow: "",
      title: "",
      subtitle: "",
      image_url: "",
      primary_cta: "browse",
      badges: [],
    },
    stats: { show: true, items: [] },
    about: { show: true, heading: "", body: "", image_url: "", points: [] },
    features: { show: true, heading: "", subheading: "", items: [] },
    steps: { show: true, heading: "", items: [] },
    instructors: { show: true, heading: "", items: [] },
    testimonials: { show: true, heading: "", items: [] },
    faq: { show: true, heading: "", items: [] },
    cta: {
      show: true,
      title: "",
      subtitle: "",
      button_label: "",
      button_href: "",
    },
    contact: {
      show: true,
      email: "",
      phone: "",
      whatsapp,
      address: "",
      map_url: "",
      socials: {},
    },
    footer: { note: "", links: [] },
    seo: { title: "", description: "", og_image_url: "" },
    pages: { about: true, faq: true, contact: true },
  };
}

function renderInSite(whatsapp: string, children: ReactNode) {
  const value = {
    academy: "noor",
    site: siteWith(whatsapp),
    stats: { courses: 0, lessons: 0, learners: 0, certificates: 0 },
    siteName: "Noor",
    learner: null,
    enrolled: new Set<string>(),
    loading: false,
    isEnrolled: () => false,
    refresh: async () => {},
    logout: async () => {},
    requireAuth: () => {},
    openAuth: () => {},
    openRedeem: () => {},
  } satisfies LearnContextValue;

  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LearnContext.Provider value={value}>{children}</LearnContext.Provider>
    </NextIntlClientProvider>,
  );
}

function renderButton(whatsapp: string) {
  renderInSite(whatsapp, <SiteWhatsappButton />);
}

/** Surfaces the hook's result as text, so the assertions read as the href they produce. */
function RequestCodeProbe({ course }: { course?: string }) {
  return <span data-testid="href">{useRequestCodeHref(course)}</span>;
}

function requestCodeHref(whatsapp: string, course?: string): string {
  renderInSite(whatsapp, <RequestCodeProbe course={course} />);
  return screen.getByTestId("href").textContent ?? "";
}

describe("SiteWhatsappButton", () => {
  it("links to wa.me with the number's digits and a prefilled message", () => {
    renderButton("+20 100 123 4567");

    const link = screen.getByRole("link", {
      name: enMessages.learn.whatsapp.float,
    });
    expect(link).toHaveAttribute(
      "href",
      expect.stringContaining("https://wa.me/201001234567?text="),
    );
    expect(decodeURIComponent(link.getAttribute("href") ?? "")).toContain(
      "Noor",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders nothing when the client left the number blank", () => {
    renderButton("");

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("renders nothing when the number carries no digits", () => {
    renderButton("call us");

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("omits the text param when no message is passed", () => {
    expect(whatsappHref("+20 100 123 4567")).toBe("https://wa.me/201001234567");
  });
});

describe("useRequestCodeHref", () => {
  it("asks on WhatsApp, naming the course", () => {
    const href = decodeURIComponent(
      requestCodeHref("+20 100 123 4567", "Tajweed — Level 1"),
    );

    expect(href).toContain("https://wa.me/201001234567?text=");
    expect(href).toContain("Tajweed — Level 1");
    expect(href).toContain("Noor");
  });

  it("falls back to the contact page when no number is saved", () => {
    expect(requestCodeHref("", "Tajweed — Level 1")).toBe(
      "/learn/noor/contact",
    );
  });

  it("falls back to the contact page when the number carries no digits", () => {
    expect(requestCodeHref("call us", "Tajweed — Level 1")).toBe(
      "/learn/noor/contact",
    );
  });

  it("uses the generic message when no course is named", () => {
    const href = decodeURIComponent(requestCodeHref("+20 100 123 4567"));

    expect(href).toContain("https://wa.me/201001234567?text=");
    expect(href).toContain("I have a question about your courses");
  });
});
