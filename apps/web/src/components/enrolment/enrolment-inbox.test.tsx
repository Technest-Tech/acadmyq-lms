import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { EnrolmentForm, EnrolmentRequest } from "@/lib/enrolment-api";
import { EnrolmentInbox } from "./enrolment-inbox";

/**
 * The enrolment inbox: the public link on top, the requests cut by status, "contacted" and "close"
 * in one tap, and the placement modal posting what the API needs to book the trial.
 */

const listEnrolmentRequests = vi.fn();
const updateEnrolmentRequest = vi.fn();
const getEnrolmentForm = vi.fn();
const updateEnrolmentForm = vi.fn();
const rotateEnrolmentToken = vi.fn();
const bookPlacement = vi.fn();
const listTrialTeachers = vi.fn();

vi.mock("@/lib/enrolment-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/enrolment-api")>()),
  listEnrolmentRequests: (params: unknown) => listEnrolmentRequests(params),
  updateEnrolmentRequest: (id: string, patch: unknown) => updateEnrolmentRequest(id, patch),
  getEnrolmentForm: () => getEnrolmentForm(),
  updateEnrolmentForm: (patch: unknown) => updateEnrolmentForm(patch),
  rotateEnrolmentToken: () => rotateEnrolmentToken(),
  bookPlacement: (id: string, input: unknown) => bookPlacement(id, input),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listTrialTeachers: () => listTrialTeachers(),
}));

const ar = arMessages.enrolment;

const FORM: EnrolmentForm = {
  id: "f1",
  url: "https://lingo.acadmyq.com/e/abcDEF123456abcDEF123456abcDEF12",
  title: "التسجيل في المركز",
  intro: null,
  is_open: true,
  ask_subject: true,
  ask_level: true,
  ask_schedule: true,
  success_message: null,
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
};

function request(id: string, over: Partial<EnrolmentRequest> = {}): EnrolmentRequest {
  return {
    id,
    student_name: `Child ${id}`,
    guardian_name: "Hassan",
    phone: "+201012345678",
    email: null,
    age: 9,
    subject_id: "s-en",
    subject: "English",
    level: "الصف الثالث",
    preferred_days: [6, 1],
    preferred_time: "17:00",
    message: "يفضّل المساء",
    source: "LINK",
    status: "NEW",
    staff_note: null,
    handled_by: null,
    trial: null,
    student: null,
    status_changed_at: "2026-11-02T10:00:00Z",
    created_at: "2026-11-02T10:00:00Z",
    ...over,
  };
}

const COUNTS = { NEW: 2, CONTACTED: 1, PLACEMENT_BOOKED: 0, ENROLLED: 0, CLOSED: 0 };

const centreSession = {
  academy: { name: "Lingo", displayName: "Lingo", logoUrl: null, country: "EG", defaultCurrency: "EGP", profile: "CENTRE" as const },
  capabilities: ["groups", "trials", "centre"],
  permissions: ["trial.read", "trial.manage", "settings.manage"],
};

function renderInbox() {
  return render(withAuth(makeSession("ACADEMY_OWNER", centreSession), <EnrolmentInbox />));
}

beforeEach(() => {
  vi.clearAllMocks();
  getEnrolmentForm.mockResolvedValue({ form: FORM });
  listEnrolmentRequests.mockImplementation((params: { status?: string }) =>
    Promise.resolve({
      rows: params.status === "CONTACTED" ? [request("r3", { status: "CONTACTED" })] : [request("r1"), request("r2")],
      counts: COUNTS,
    }),
  );
  updateEnrolmentRequest.mockImplementation((id: string, patch: { status?: EnrolmentRequest["status"]; staff_note?: string | null }) =>
    Promise.resolve({ request: request(id, { status: patch.status ?? "NEW", staff_note: patch.staff_note ?? null }) }),
  );
  listTrialTeachers.mockResolvedValue({ teachers: [{ id: "t1", full_name: "Miss Mona", specialization: null }], durations: [30, 45, 60], timezone: "Africa/Cairo" });
  bookPlacement.mockResolvedValue({
    trialId: "tr1",
    warnings: [],
    request: request("r1", { status: "PLACEMENT_BOOKED", trial: { id: "tr1", scheduled_at_utc: "2026-11-10T15:00:00Z", status: "SCHEDULED", teacher_name: "Miss Mona" } }),
  });
});

describe("EnrolmentInbox", () => {
  it("shows the public link, the NEW requests with a WhatsApp tap, and the counts on the tabs", async () => {
    renderInbox();

    expect(await screen.findByTestId("enrolment-link-url")).toHaveTextContent(FORM.url);
    expect(await screen.findByTestId("enrolment-request-r1")).toHaveTextContent("Child r1");
    expect(listEnrolmentRequests).toHaveBeenCalledWith({ status: "NEW", q: "" });

    const card = screen.getByTestId("enrolment-request-r1");
    expect(within(card).getByTestId("enrolment-request-wa")).toHaveAttribute("href", expect.stringContaining("https://wa.me/201012345678"));
    expect(card).toHaveTextContent("English");
    expect(card).toHaveTextContent(ar.weekdays["6"]);
    expect(card).toHaveTextContent("17:00");
    expect(screen.getByTestId("enrolment-tab-NEW")).toHaveTextContent("2");
    expect(screen.getByTestId("enrolment-tab-CONTACTED")).toHaveTextContent("1");
    expect(screen.getByTestId("enrolment-tab-ALL")).toHaveTextContent("3");
  });

  it("marks a request contacted (it leaves the NEW tab) and closes one from the Contacted tab", async () => {
    const user = userEvent.setup();
    renderInbox();
    await screen.findByTestId("enrolment-request-r1");

    await user.click(within(screen.getByTestId("enrolment-request-r1")).getByTestId("enrolment-mark-contacted"));
    await waitFor(() => expect(updateEnrolmentRequest).toHaveBeenCalledWith("r1", { status: "CONTACTED" }));
    await waitFor(() => expect(screen.queryByTestId("enrolment-request-r1")).toBeNull());
    expect(screen.getByTestId("enrolment-tab-NEW")).toHaveTextContent("1");
    expect(screen.getByTestId("enrolment-tab-CONTACTED")).toHaveTextContent("2");

    await user.click(screen.getByTestId("enrolment-tab-CONTACTED"));
    const r3 = await screen.findByTestId("enrolment-request-r3");
    await user.click(within(r3).getByTestId("enrolment-close"));
    await waitFor(() => expect(updateEnrolmentRequest).toHaveBeenCalledWith("r3", { status: "CLOSED" }));
  });

  it("books the placement lesson with the teacher, the academy-clock slot and the length", async () => {
    const user = userEvent.setup();
    renderInbox();
    await screen.findByTestId("enrolment-request-r1");

    await user.click(within(screen.getByTestId("enrolment-request-r1")).getByTestId("enrolment-book-placement"));
    const form = await screen.findByTestId("placement-form");
    // One teacher on the roster is picked for them; the time opens on what the parent asked for.
    await waitFor(() => expect(within(form).getByTestId("placement-teacher")).toHaveTextContent("Miss Mona"));
    expect(within(form).getByTestId("placement-time")).toHaveValue("17:00");

    const date = within(form).getByTestId("placement-date");
    await user.clear(date);
    await user.type(date, "2026-11-10");
    await user.click(within(form).getByRole("button", { name: ar.placement.minutes.replace("{n}", "45") }));
    await user.click(within(form).getByTestId("placement-submit"));

    await waitFor(() =>
      expect(bookPlacement).toHaveBeenCalledWith("r1", {
        teacher_id: "t1",
        local_datetime: "2026-11-10 17:00",
        timezone: "Africa/Cairo",
        duration_minutes: 45,
      }),
    );
    // The row leaves NEW, the count moves, and the page says so.
    await waitFor(() => expect(screen.queryByTestId("placement-form")).toBeNull());
    expect(screen.getByTestId("enrolment-tab-PLACEMENT_BOOKED")).toHaveTextContent("1");
    expect(screen.getByRole("status")).toHaveTextContent(ar.placement.booked);
  });
});
