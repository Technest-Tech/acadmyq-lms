import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  SiteFooter,
  SiteWhatsappButton,
  useRequestCodeHref,
  whatsappHref,
} from "@/components/learn/site-chrome";
import { renderInSite } from "@/test/learn-site";
import enMessages from "../../../messages/en.json";

/**
 * The chrome every LMS client shares (docs/lms/09). Two contracts are load-bearing here:
 *
 *  - the floating WhatsApp button is "the client's number or nothing" — a blank number must not
 *    leave a dead link on a page students visit;
 *  - the footer never advertises what the client HASN'T configured. A public page that says
 *    "contact details haven't been added yet" tells every visitor the shop is unfinished.
 */

function renderButton(whatsapp: string) {
  renderInSite(<SiteWhatsappButton />, { site: { contact: { whatsapp } } });
}

/** Surfaces the hook's result as text, so the assertions read as the href they produce. */
function RequestCodeProbe({ course }: { course?: string }) {
  return <span data-testid="href">{useRequestCodeHref(course)}</span>;
}

function requestCodeHref(whatsapp: string, course?: string): string {
  renderInSite(<RequestCodeProbe course={course} />, {
    site: { contact: { whatsapp } },
  });
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

describe("SiteFooter", () => {
  it("lists only the contact channels the client filled in", () => {
    renderInSite(<SiteFooter />, {
      site: { contact: { email: "hello@noor.test", phone: "", whatsapp: "" } },
    });

    expect(screen.getByText("hello@noor.test")).toBeInTheDocument();
    expect(screen.queryByText(/haven't been added/i)).toBeNull();
  });

  it("says nothing about missing contact details when none are configured", () => {
    renderInSite(<SiteFooter />);

    // The whole column disappears rather than announcing the gap to every visitor.
    expect(screen.queryByText(/haven't been added/i)).toBeNull();
    expect(
      screen.queryByRole("heading", { name: enMessages.learn.footer.contact }),
    ).toBeNull();
  });

  it("credits the platform with a real link", () => {
    renderInSite(<SiteFooter />);

    expect(screen.getByRole("link", { name: "Acadmyq" })).toHaveAttribute(
      "href",
      "https://acadmyq.com",
    );
  });

  it("only promises payment confirmation when checkout is actually open", () => {
    renderInSite(<SiteFooter />, { commerce: { checkout: true, paid: true } });
    expect(screen.getByText(/Payments are confirmed by Noor/)).toBeInTheDocument();
  });

  it("omits the payment note on a site that sells nothing online", () => {
    renderInSite(<SiteFooter />);
    expect(screen.queryByText(/Payments are confirmed/)).toBeNull();
  });
});
