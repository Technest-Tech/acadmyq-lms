import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PublicEnrolmentPayload } from "@/lib/enrolment-api";
import { EnrolForm } from "./enrol-form";

/**
 * The centre's public enrolment form: branded with the academy, asks only what the centre chose, and
 * posts exactly what the API stores — the phone as E.164 on the academy's dial code, the days as
 * weekday ints, the honeypot empty.
 */

const DATA: PublicEnrolmentPayload = {
  academy: { name: "Lingo Academy", displayName: "Lingo", logoUrl: null, timezone: "Africa/Cairo", country: "EG" },
  form: {
    title: "سجّل ابنك في لينجو",
    intro: "نتصل بك خلال يوم عمل.",
    is_open: true,
    ask_subject: true,
    ask_level: true,
    ask_schedule: true,
    success_message: "شكرًا! هنكلمك بكرة.",
  },
  subjects: [
    { id: "s-en", name: "English" },
    { id: "s-fr", name: "French" },
  ],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("EnrolForm — the public registration page", () => {
  it("shows the centre's name and words, and posts the request as the API stores it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true, success_message: DATA.form.success_message }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<EnrolForm token="tok123" data={DATA} initialLang="ar" />);

    expect(screen.getByTestId("enrol-academy")).toHaveTextContent("Lingo");
    expect(screen.getByTestId("enrol-title")).toHaveTextContent("سجّل ابنك في لينجو");
    // The academy's country opens the dial code.
    expect(screen.getByTestId("enrol-dial")).toHaveValue("EG");

    await user.type(screen.getByTestId("enrol-student"), "Adam Hassan");
    await user.type(screen.getByTestId("enrol-guardian"), "Hassan");
    await user.type(screen.getByTestId("enrol-phone"), "01012345678");
    await user.type(screen.getByTestId("enrol-age"), "9");
    await user.selectOptions(screen.getByTestId("enrol-subject"), "s-en");
    await user.type(screen.getByTestId("enrol-level"), "الصف الثالث");
    await user.click(screen.getByTestId("enrol-day-6"));
    await user.click(screen.getByTestId("enrol-day-1"));
    await user.type(screen.getByTestId("enrol-time"), "17:00");
    await user.type(screen.getByTestId("enrol-message"), "يفضّل المساء");
    await user.click(screen.getByTestId("enrol-submit"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/e\/tok123$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      student_name: "Adam Hassan",
      guardian_name: "Hassan",
      // The trunk zero dropped, the dial code added.
      phone: "+201012345678",
      email: null,
      age: 9,
      subject_id: "s-en",
      subject_text: null,
      level_text: "الصف الثالث",
      preferred_days: [1, 6],
      preferred_time: "17:00",
      message: "يفضّل المساء",
      website: "",
    });

    expect(await screen.findByTestId("enrol-success")).toHaveTextContent("شكرًا! هنكلمك بكرة.");
  });

  it("asks only what the form asks, and sends 'other' as typed text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true, success_message: null }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<EnrolForm token="tok123" data={{ ...DATA, form: { ...DATA.form, ask_level: false, ask_schedule: false } }} initialLang="en" />);

    expect(screen.queryByTestId("enrol-level")).toBeNull();
    expect(screen.queryByTestId("enrol-day-6")).toBeNull();

    await user.type(screen.getByTestId("enrol-student"), "Sara");
    await user.type(screen.getByTestId("enrol-phone"), "1098765432");
    await user.selectOptions(screen.getByTestId("enrol-subject"), "__other__");
    await user.type(screen.getByTestId("enrol-subject-text"), "Robotics");
    await user.click(screen.getByTestId("enrol-submit"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.subject_id).toBeNull();
    expect(body.subject_text).toBe("Robotics");
    expect(body.level_text).toBeNull();
    expect(body.preferred_days).toEqual([]);
    expect(body.preferred_time).toBeNull();
    // No academy message → the page's own thank-you.
    expect(await screen.findByTestId("enrol-success")).toHaveTextContent("Thank you!");
  });

  it("refuses to send without a name or a phone, and shows the closed state on a 410", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(410, { message: "closed" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<EnrolForm token="tok123" data={DATA} initialLang="ar" />);
    await user.click(screen.getByTestId("enrol-submit"));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert")).toHaveLength(2);

    await user.type(screen.getByTestId("enrol-student"), "Adam");
    await user.type(screen.getByTestId("enrol-phone"), "01012345678");
    await user.click(screen.getByTestId("enrol-submit"));
    expect(await screen.findByTestId("enrol-closed")).toBeInTheDocument();
  });

  it("opens straight on the closed card when the centre paused the form", () => {
    render(<EnrolForm token="tok123" data={{ ...DATA, form: { ...DATA.form, is_open: false } }} initialLang="ar" />);
    expect(screen.getByTestId("enrol-closed")).toBeInTheDocument();
    expect(screen.queryByTestId("enrol-form")).toBeNull();
  });
});
