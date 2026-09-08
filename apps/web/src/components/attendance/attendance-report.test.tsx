import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import type { Session } from "@/lib/api";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { AttendanceReport } from "./attendance-report";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getSession: vi.fn(),
  markAttendance: vi.fn(),
  putSessionReport: vi.fn(),
  markWhatsappSent: vi.fn(),
  getStudentReports: vi.fn(),
  requestFree: vi.fn(),
  previewSessionDuration: vi.fn(),
  updateSessionDuration: vi.fn(),
}));

import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";

function detail(
  overrides: Partial<api.SessionDetailResponse> = {},
): api.SessionDetailResponse {
  return {
    session: {
      id: "se1",
      student_id: "st1",
      teacher_id: "t1",
      student_name: "Abdullah",
      teacher_name: "Ustadh",
      academy_name: "Test Academy",
      scheduled_at_utc: "2026-06-01T15:00:00Z",
      duration_minutes: 30,
      session_number: null,
      session_number_scope: null,
      status: "SCHEDULED",
      status_reason: null,
      billed: false,
      outcome_set_at: null,
      classification: { billableToStudent: false, countsForTeacher: false },
      pending_cancellation: null,
      pending_free: null,
    },
    report: null,
    reportFields: [
      {
        id: "f1",
        academy_id: "a1",
        key: "surah_from",
        label_ar: "من",
        label_en: "From surah",
        field_type: "TEXT",
        options: null,
        sort_order: 0,
        is_required: true,
        is_active: true,
      },
      {
        id: "f2",
        academy_id: "a1",
        key: "tajweed_rating",
        label_ar: "تجويد",
        label_en: "Tajweed",
        field_type: "SELECT",
        options: ["ممتاز", "جيد"],
        sort_order: 1,
        is_required: false,
        is_active: true,
      },
      {
        id: "f3",
        academy_id: "a1",
        key: "notes",
        label_ar: "ملاحظات",
        label_en: "Notes",
        field_type: "TEXTAREA",
        options: null,
        sort_order: 2,
        is_required: false,
        is_active: true,
      },
    ],
    inactiveReportFields: [],
    ...overrides,
  };
}

function ownerSession(): Session {
  return makeSession("ACADEMY_OWNER", {
    permissions: [
      "session.read",
      "session.mark_attendance",
      "session.write_report",
    ],
  });
}

function renderPanel(session: Session = ownerSession()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(session)}>
        <AttendanceReport sessionId="se1" onError={vi.fn()} />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("AttendanceReport (Sprint 6 §2/§6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSession).mockResolvedValue(detail());
    vi.mocked(api.markAttendance).mockResolvedValue({
      status: "ATTENDED",
      billed: true,
      classification: { billableToStudent: true, countsForTeacher: true },
    });
    vi.mocked(api.putSessionReport).mockResolvedValue({ ok: true, values: {} });
    vi.mocked(api.getStudentReports).mockResolvedValue({
      reports: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
  });

  it("renders the rich lesson-report editor", async () => {
    renderPanel();

    expect(await screen.findByTestId("report-text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bullet list" })).toBeInTheDocument();
  });

  it("stages an outcome and records it when the report is saved (AC-6.1)", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByTestId("outcome-ATTENDED"));
    expect(api.markAttendance).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("save-report"));

    await waitFor(() =>
      expect(api.markAttendance).toHaveBeenCalledWith("se1", {
        status: "ATTENDED",
        override_timing: true,
      }),
    );
  });

  it("shows report validation errors returned by the API (AC-6.5)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.putSessionReport).mockRejectedValueOnce(
      new ApiError(422, "invalid", {
        errors: { "values.surah_from": ["From surah is required."] },
      }),
    );
    renderPanel();

    await user.click(await screen.findByTestId("save-report"));

    expect(await screen.findByRole("alert")).toHaveTextContent("invalid");
  });

  it("surfaces a timing rejection from the API (AC-6.9)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.markAttendance).mockRejectedValueOnce(
      new ApiError(422, "This session has not started yet."),
    );
    renderPanel();

    await user.click(await screen.findByTestId("outcome-ATTENDED"));
    await user.click(screen.getByTestId("save-report"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This session has not started yet.",
    );
  });

  it("composes the WhatsApp report and surfaces a deep link on click", async () => {
    const user = userEvent.setup();
    const d = detail({
      report: {
        values: { surah_from: "Al-Imran 85" },
        filled_by_user_id: "u1",
        filled_at: "2026-06-01T16:00:00Z",
        whatsapp_sent_at: null,
        whatsapp_channel: null,
      },
    });
    d.session.status = "ATTENDED"; // WhatsApp send is offered only once the lesson is attended
    vi.mocked(api.getSession).mockResolvedValue(d);
    vi.mocked(api.markWhatsappSent).mockResolvedValue({
      ok: true,
      sentAt: "2026-06-01T17:00:00Z",
      channel: "MANUAL_WHATSAPP",
      message: {
        text: "📋 Session Report\n• Surah from: Al-Imran 85",
        phone: "+201001234567",
        deeplink: "https://wa.me/201001234567?text=hi",
      },
    });
    renderPanel();

    // The button is enabled; clicking it records the send and reveals the deep link.
    const btn = await screen.findByTestId("compose-whatsapp");
    expect(btn).toBeEnabled();
    await user.click(btn);

    expect(api.markWhatsappSent).toHaveBeenCalledWith("se1");
    const result = await screen.findByTestId("whatsapp-result");
    expect(result).toHaveTextContent("Al-Imran 85");
    const openLink = within(result).getByRole("link");
    expect(openLink).toHaveAttribute(
      "href",
      "https://wa.me/201001234567?text=hi",
    );
  });

  it("shows a success alert after recording an outcome", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByTestId("outcome-ATTENDED"));
    await user.click(screen.getByTestId("save-report"));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Report saved.",
    );
  });

  it("opens the report-history popup (AC-6.11)", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByTestId("open-history"));

    // The history modal mounts the archive DataTable.
    expect(
      await screen.findByTestId("report-archive-table"),
    ).toBeInTheDocument();
  });

  it("previews invoice and salary changes before correcting an attended duration", async () => {
    const user = userEvent.setup();
    const d = detail();
    d.session.status = "ATTENDED";
    d.session.billed = true;
    d.session.duration_minutes = 30;
    d.session.classification = {
      billableToStudent: true,
      countsForTeacher: true,
    };
    vi.mocked(api.getSession).mockResolvedValue(d);
    vi.mocked(api.previewSessionDuration).mockResolvedValue({
      session_id: "se1",
      duration_before: 30,
      duration_after: 60,
      can_change: true,
      blockers: [],
      invoice: {
        invoice_id: "inv1",
        status: "OPEN",
        currency: "EGP",
        pricing_basis: "PER_HOUR",
        amount_before: 3000,
        amount_after: 6000,
      },
      package: null,
      payout: {
        payout_id: "pay1",
        currency: "EGP",
        finalized: false,
        amount_before: 5000,
        amount_after: 10000,
      },
    });
    vi.mocked(api.updateSessionDuration).mockResolvedValue({
      ok: true,
      impact: {
        session_id: "se1",
        duration_before: 30,
        duration_after: 60,
        can_change: true,
        blockers: [],
        invoice: null,
        package: null,
        payout: null,
      },
    });

    renderPanel(
      makeSession("ACADEMY_OWNER", {
        permissions: [
          "session.read",
          "session.mark_attendance",
          "session.write_report",
          "student.set_price",
        ],
      }),
    );

    await user.click(await screen.findByTestId("edit-session-duration"));
    const input = screen.getByLabelText("Correct duration");
    fireEvent.change(input, { target: { value: "60" } });
    await user.click(screen.getByTestId("review-duration-change"));

    expect(await screen.findByTestId("duration-impact")).toHaveTextContent(
      "Student invoice",
    );
    expect(api.updateSessionDuration).not.toHaveBeenCalled();
    const confirm = await screen.findByTestId("confirm-duration-change");
    expect(input).toHaveValue(60);
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() =>
      expect(api.updateSessionDuration).toHaveBeenCalledWith("se1", 60),
    );
  });

  it("hides attendance controls when the user lacks the capability (AC-6.8)", async () => {
    renderPanel(makeSession("TEACHER", { permissions: ["session.read"] }));

    await screen.findByTestId("attendance-report");
    // No write capabilities → the outcome buttons are disabled and the save button is absent.
    expect(screen.getByTestId("outcome-ATTENDED")).toBeDisabled();
    expect(screen.queryByTestId("save-report")).not.toBeInTheDocument();
  });

  // ── FREE lesson: admin gets the billing popup; teacher goes through approval ──

  it("opens the billing popup when an OWNER marks a lesson free (like cancel)", async () => {
    const user = userEvent.setup();
    renderPanel(
      makeSession("ACADEMY_OWNER", {
        permissions: [
          "session.read",
          "session.mark_attendance",
          "session.write_report",
          "session.free",
        ],
      }),
    );

    await user.click(await screen.findByTestId("outcome-FREE"));

    // The shared charge-student / pay-teacher popup appears — same as a cancellation.
    expect(
      await screen.findByTestId("cancel-billing-confirm"),
    ).toBeInTheDocument();
    // Nothing is applied until the owner confirms the billing decision.
    expect(api.markAttendance).not.toHaveBeenCalled();
    expect(api.requestFree).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("cancel-billing-confirm"));
    expect(api.markAttendance).toHaveBeenCalledWith(
      "se1",
      expect.objectContaining({ status: "FREE" }),
    );
  });

  it("routes a TEACHER's free mark through the approval request flow", async () => {
    const user = userEvent.setup();
    vi.mocked(api.requestFree).mockResolvedValue({
      requestId: "r1",
      status: "PENDING",
    });
    renderPanel(
      makeSession("TEACHER", {
        permissions: [
          "session.read",
          "session.mark_attendance",
          "session.write_report",
          "session.free_request",
        ],
      }),
    );

    // Picking FREE never opens the billing popup for a teacher…
    await user.click(await screen.findByTestId("outcome-FREE"));
    expect(
      screen.queryByTestId("cancel-billing-confirm"),
    ).not.toBeInTheDocument();

    // …saving raises a free request for the owner to approve, not a direct mark.
    await user.click(await screen.findByTestId("save-report"));
    expect(api.requestFree).toHaveBeenCalledWith("se1", {});
    expect(api.markAttendance).not.toHaveBeenCalled();
  });
});
