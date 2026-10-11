import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bookingWhatsappHref } from "@/components/courses/bookings-manager";
import { BookingBand } from "@/components/learn/booking-band";
import { useHeroCta } from "@/components/learn/storefront";
import { LearnApiError, type LearnBookingForm, type LearnSiteBooking } from "@/lib/learn-api";
import { renderInSite } from "@/test/learn-site";
import { BookingScreen } from "./booking-screen";

/**
 * Booking forms on the course site (docs/lms/13). What these protect:
 *  - the visitor is asked ONLY what this client's form asks, under the client's own name;
 *  - nothing is sent until the required bits are there, and the API's verdict comes back in the
 *    visitor's language, per field;
 *  - "Book this course" lands with the course already picked;
 *  - the storefront promotes a form by its own name, and never one the client kept off the site.
 */

const submit = vi.hoisted(() => vi.fn());
vi.mock("@/lib/learn-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/learn-api")>()),
  learnSubmitBooking: submit,
}));

function form(patch: Partial<LearnBookingForm> = {}): LearnBookingForm {
  return {
    slug: "consultation",
    title: "احجز استشارة",
    description: null,
    submit_label: null,
    success_message: null,
    ask_email: false,
    ask_course: false,
    ask_date: false,
    ask_message: false,
    choice_label: null,
    choices: [],
    ...patch,
  };
}

const courses = [
  { id: "c-1", title: "Tajweed Level 1", slug: "tajweed-1" },
  { id: "c-2", title: "Arabic Basics", slug: "arabic-basics" },
];

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  submit.mockReset();
  submit.mockResolvedValue({ ok: true });
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("BookingScreen", () => {
  it("asks only what the form asks, under the client's own name", () => {
    renderInSite(
      <BookingScreen
        form={form({ ask_date: true, choice_label: "Kind", choices: ["Individual", "Family"] })}
        courses={courses}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("احجز استشارة");
    expect(screen.getByLabelText(/Full name/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Phone/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Preferred date/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Family" })).toBeInTheDocument();
    // Not asked by this form.
    expect(screen.queryByLabelText(/Email/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Which course/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Anything we should know/)).not.toBeInTheDocument();
  });

  it("holds the request until a choice is picked, then sends only the asked fields", async () => {
    renderInSite(
      <BookingScreen
        form={form({ choices: ["Individual", "Family"], success_message: "See you soon!" })}
        courses={courses}
      />,
    );

    fill(/Full name/, "Mona Adel");
    fill(/Phone/, "0100 123 4567");
    fireEvent.click(screen.getByRole("button", { name: /Send request/ }));

    expect(await screen.findByText("Please choose an option.")).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Family" }));
    fireEvent.click(screen.getByRole("button", { name: /Send request/ }));

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(
      "noor",
      "consultation",
      expect.objectContaining({
        full_name: "Mona Adel",
        phone: "0100 123 4567",
        choice: "Family",
        email: null,
        course_id: null,
        preferred_date: null,
        message: null,
        website: "",
      }),
    );
    expect(await screen.findByText("See you soon!")).toBeInTheDocument();
  });

  it("arrives from a course page with that course already picked", () => {
    window.history.replaceState({}, "", "/learn/noor/book/consultation?course=arabic-basics");
    renderInSite(<BookingScreen form={form({ ask_course: true })} courses={courses} />);

    expect(screen.getByLabelText(/Which course/)).toHaveValue("c-2");
  });

  it("reports the API's verdict per field, in the visitor's language", async () => {
    submit.mockRejectedValue(
      new LearnApiError(422, "The phone field format is invalid.", {
        errors: { phone: ["The phone field format is invalid."] },
      }),
    );
    renderInSite(<BookingScreen form={form()} courses={[]} />);

    fill(/Full name/, "Omar");
    fill(/Phone/, "+20 100 000 0000");
    fireEvent.click(screen.getByRole("button", { name: /Send request/ }));

    expect(
      await screen.findByText("Please enter a phone number we can reach you on."),
    ).toBeInTheDocument();
    expect(screen.queryByText("The phone field format is invalid.")).not.toBeInTheDocument();
  });
});

// ── the storefront promotes the forms ───────────────────────────────────────

function booking(patch: Partial<LearnSiteBooking> = {}): LearnSiteBooking {
  return {
    slug: "consultation",
    title: "احجز استشارة",
    description: null,
    ask_course: false,
    nav: true,
    home: true,
    ...patch,
  };
}

function HeroProbe() {
  const cta = useHeroCta();
  return (
    <ul>
      <li data-testid="primary">{cta.primaryLabel}</li>
      <li data-testid="primary-href">{cta.primaryHref ?? "—"}</li>
      <li data-testid="secondary">{cta.secondary?.label ?? "—"}</li>
    </ul>
  );
}

describe("booking on the storefront", () => {
  it("puts the form in the hero under its own name when the client chose it", () => {
    renderInSite(<HeroProbe />, {
      site: { hero: { primary_cta: "booking" } },
      commerce: { bookings: [booking()] },
    });

    expect(screen.getByTestId("primary")).toHaveTextContent("احجز استشارة");
    expect(screen.getByTestId("primary-href")).toHaveTextContent("/learn/noor/book/consultation");
  });

  it("offers an advertised form as the second door, but never one kept off the site", () => {
    renderInSite(<HeroProbe />, {
      commerce: { checkout: true, bookings: [booking({ title: "Book a course" })] },
    });
    expect(screen.getByTestId("secondary")).toHaveTextContent("Book a course");
    cleanup();

    renderInSite(<HeroProbe />, {
      site: { pages: { contact: false } },
      commerce: { checkout: true, bookings: [booking({ nav: false, home: false })] },
    });
    expect(screen.getByTestId("secondary")).toHaveTextContent("—");
  });

  it("gives one form the whole home band, and several a card each", () => {
    renderInSite(<BookingBand />, {
      commerce: { bookings: [booking({ description: "Talk to an expert" })] },
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("احجز استشارة");
    expect(screen.getByText("Talk to an expert")).toBeInTheDocument();
    cleanup();

    renderInSite(<BookingBand />, {
      commerce: {
        bookings: [
          booking(),
          booking({ slug: "course", title: "احجز كورس" }),
          booking({ slug: "hidden", title: "Not on home", home: false }),
        ],
      },
    });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("How can we help?");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "احجز استشارة",
      "احجز كورس",
    ]);
  });
});

describe("bookingWhatsappHref", () => {
  it("completes a local Egyptian mobile and passes international numbers through", () => {
    expect(bookingWhatsappHref("0100 123 4567")).toBe("https://wa.me/201001234567");
    expect(bookingWhatsappHref("+966 50 123 4567")).toBe("https://wa.me/966501234567");
    expect(bookingWhatsappHref("00971501234567")).toBe("https://wa.me/971501234567");
    expect(bookingWhatsappHref("12")).toBeNull();
  });
});
