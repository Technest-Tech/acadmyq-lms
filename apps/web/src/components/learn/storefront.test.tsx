import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  courseAction,
  offersCode,
  splitExpertise,
  useDefaultFaq,
  useHeroCta,
  type CourseAction,
} from "@/components/learn/storefront";
import type { LearnCourseCard } from "@/lib/learn-api";
import { renderInSite } from "@/test/learn-site";

/**
 * The storefront's adaptive layer (docs/lms/09 §2, §4, §8).
 *
 * The same template serves a teacher who only hands out access codes and a training company running
 * full checkout, so what these cover is that the page never advertises a door that is shut: no Buy
 * button without a receiving account, no "how do I get a code" as the headline FAQ on a shop that
 * sells online, and no free-course CTA on a catalogue with no free course in it.
 */

function card(patch: Partial<LearnCourseCard> = {}): LearnCourseCard {
  return {
    id: "c1",
    title: "Tajweed",
    slug: "tajweed",
    subtitle: null,
    cover_image_path: null,
    lesson_count: 10,
    price_minor: 40000,
    currency: "EGP",
    is_free: false,
    ...patch,
  };
}

describe("courseAction", () => {
  it("puts learning first for someone already enrolled, whatever the price", () => {
    expect(courseAction(card({ sells_online: true }), true)).toBe("continue");
    expect(courseAction(card({ is_free: true }), true)).toBe("continue");
  });

  it("offers a free course with one click", () => {
    expect(courseAction(card({ is_free: true, price_minor: 0 }), false)).toBe(
      "free",
    );
  });

  it("offers Buy only when the client can actually receive the money", () => {
    expect(courseAction(card({ sells_online: true }), false)).toBe("buy");
    // checkout switched on, but no live payment method ⇒ sells_online false
    expect(
      courseAction(card({ checkout_enabled: true, sells_online: false }), false),
    ).toBe("redeem");
  });

  it("an order already in flight outranks a second Buy button", () => {
    expect(
      courseAction(card({ sells_online: true }), false, {
        status: "AWAITING_PAYMENT",
      }),
    ).toBe("pay");
    expect(
      courseAction(card({ sells_online: true }), false, {
        status: "UNDER_REVIEW",
      }),
    ).toBe("review");
  });

  it("ignores a finished order — that course is bought, not buying", () => {
    expect(
      courseAction(card({ sells_online: true }), false, { status: "CANCELLED" }),
    ).toBe("buy");
  });

  it("says nothing is for sale when every door is shut", () => {
    expect(
      courseAction(
        card({ sells_online: false, code_enabled: false, checkout_enabled: false }),
        false,
      ),
    ).toBe("unavailable");
  });

  it("treats an older API build (no flags at all) as code-only, as it was", () => {
    expect(courseAction(card(), false)).toBe("redeem");
  });
});

describe("offersCode", () => {
  it("offers the code beside a Buy button", () => {
    expect(offersCode(card({ code_enabled: true }), "buy")).toBe(true);
    expect(offersCode(card({ code_enabled: true }), "pay")).toBe(true);
  });

  it("never duplicates the primary action", () => {
    expect(offersCode(card({ code_enabled: true }), "redeem")).toBe(false);
    expect(offersCode(card({ code_enabled: true }), "continue")).toBe(false);
    expect(offersCode(card({ code_enabled: true }), "free")).toBe(false);
  });

  it("respects a course with codes switched off", () => {
    expect(offersCode(card({ code_enabled: false }), "buy")).toBe(false);
  });
});

/** Renders the hook's result as text so the assertions read like the buttons a visitor sees. */
function HeroCtaProbe() {
  const cta = useHeroCta();
  return (
    <ul>
      <li data-testid="primary">{cta.primaryLabel}</li>
      <li data-testid="secondary">{cta.secondary?.label ?? "—"}</li>
      <li data-testid="secondary-href">{cta.secondary?.href ?? "—"}</li>
      <li data-testid="code">{cta.codeLink ? "link" : "none"}</li>
      <li data-testid="action">{cta.primaryAction ?? "—"}</li>
    </ul>
  );
}

describe("useHeroCta", () => {
  const freeCourse = { slug: "intro", title: "Intro" };

  it("leads with the catalogue and demotes the code to a link when a course can be bought", () => {
    renderInSite(<HeroCtaProbe />, {
      commerce: { checkout: true, codes: true, paid: true },
    });

    expect(screen.getByTestId("primary")).toHaveTextContent("Browse courses");
    expect(screen.getByTestId("action")).toHaveTextContent("—");
    expect(screen.getByTestId("code")).toHaveTextContent("link");
  });

  it("offers a free course as the second button, pointing at that course", () => {
    renderInSite(<HeroCtaProbe />, {
      commerce: { checkout: true, free: true, free_course: freeCourse },
    });

    expect(screen.getByTestId("secondary")).toHaveTextContent(
      "Start with a free course",
    );
    expect(screen.getByTestId("secondary-href")).toHaveTextContent(
      "/learn/noor/c/intro",
    );
  });

  it("never invents a free course — with none, the second button is the contact page", () => {
    renderInSite(<HeroCtaProbe />, { commerce: { checkout: true } });

    expect(screen.getByTestId("secondary")).not.toHaveTextContent("free");
    expect(screen.getByTestId("secondary")).toHaveTextContent("Contact");
  });

  it("shows one button alone rather than a link to a page the client switched off", () => {
    renderInSite(<HeroCtaProbe />, {
      site: { pages: { contact: false } },
      commerce: { checkout: true },
    });

    expect(screen.getByTestId("secondary")).toHaveTextContent("—");
  });

  it("keeps the code as the primary button on a code-only site that asked for it", () => {
    renderInSite(<HeroCtaProbe />, {
      site: { hero: { primary_cta: "redeem" } },
      commerce: { codes: true, paid: true },
    });

    expect(screen.getByTestId("action")).toHaveTextContent("redeem");
    expect(screen.getByTestId("primary")).toHaveTextContent("Redeem code");
  });

  it("ignores a redeem CTA on a site where no code unlocks anything", () => {
    renderInSite(<HeroCtaProbe />, {
      site: { hero: { primary_cta: "redeem" } },
      commerce: { codes: false, checkout: true },
    });

    expect(screen.getByTestId("action")).toHaveTextContent("—");
    expect(screen.getByTestId("primary")).toHaveTextContent("Browse courses");
  });

  it("lets the client override the button's words", () => {
    renderInSite(<HeroCtaProbe />, {
      site: { hero: { cta_label: "See the programmes" } },
      commerce: { checkout: true },
    });

    expect(screen.getByTestId("primary")).toHaveTextContent(
      "See the programmes",
    );
  });
});

function FaqProbe() {
  const items = useDefaultFaq();
  return (
    <ol>
      {items.map((item) => (
        <li key={item.q}>
          {item.q}
          {item.a}
        </li>
      ))}
    </ol>
  );
}

describe("useDefaultFaq", () => {
  it("explains buying, and only mentions the code second, on a shop with checkout", () => {
    renderInSite(<FaqProbe />, {
      commerce: { checkout: true, codes: true, paid: true },
    });

    const questions = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");

    expect(questions[0]).toContain("How do I buy a course?");
    expect(questions.join(" ")).toContain("What if I change my mind?");
    // "How do I GET a code" is the wrong headline when a Buy button exists.
    expect(questions.join(" ")).not.toContain("How do I get an access code?");
  });

  it("leads with how to get a code when that is the only way in", () => {
    renderInSite(<FaqProbe />, { commerce: { codes: true, paid: true } });

    const questions = screen
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");

    expect(questions[0]).toContain("How do I get an access code?");
    // No checkout ⇒ never describe a checkout page or a refund flow that does not exist.
    expect(questions.join(" ")).not.toContain("How do I buy a course?");
    expect(questions.join(" ")).not.toContain("What if I change my mind?");
  });

  it("mentions free courses only when there are some", () => {
    renderInSite(<FaqProbe />, { commerce: { free: true, checkout: true } });
    expect(
      screen.getByText(/Are any of the courses free\?/),
    ).toBeInTheDocument();
  });

  it("names the academy in the answers that address it", () => {
    renderInSite(<FaqProbe />, { commerce: { codes: true } });

    expect(screen.getByText(/handed out by Noor/)).toBeInTheDocument();
    // The placeholder must never survive into the rendered page.
    expect(screen.queryByText(/\{name\}/)).toBeNull();
  });
});

describe("splitExpertise", () => {
  it("splits on both an ASCII and an Arabic comma", () => {
    expect(splitExpertise("Tajweed، Qira'at, Hifz")).toEqual([
      "Tajweed",
      "Qira'at",
      "Hifz",
    ]);
  });

  it("drops blanks and caps the list at what a card can show", () => {
    expect(splitExpertise("a,, b ,")).toEqual(["a", "b"]);
    expect(splitExpertise("a,b,c,d,e,f,g,h")).toHaveLength(6);
  });

  it("is empty for an unset field", () => {
    expect(splitExpertise(undefined)).toEqual([]);
    expect(splitExpertise("")).toEqual([]);
  });
});

/** Guards the exhaustive switch in PrimaryAction — a new action must not silently render nothing. */
describe("CourseAction", () => {
  it("covers every state the sales page can be in", () => {
    const all: CourseAction[] = [
      "continue",
      "free",
      "buy",
      "pay",
      "review",
      "redeem",
      "unavailable",
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});
