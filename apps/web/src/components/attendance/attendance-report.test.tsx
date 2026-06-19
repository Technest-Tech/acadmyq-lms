import { render, screen, within } from "@testing-library/react";
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
}));

import * as api from "@/lib/api";
import { ApiError } from "@/lib/api";

function detail(overrides: Partial<api.SessionDetailResponse> = {}): api.SessionDetailResponse {
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
      status: "SCHEDULED",
      status_reason: null,
      billed: false,
      outcome_set_at: null,
      classification: { billableToStudent: false, countsForTeacher: false },
      pending_cancellation: null,
    },
    report: null,
    reportFields: [
      { id: "f1", academy_id: "a1", key: "surah_from", label_ar: "من", label_en: "From surah", field_type: "TEXT", options: null, sort_order: 0, is_required: true, is_active: true },
      { id: "f2", academy_id: "a1", key: "tajweed_rating", label_ar: "تجويد", label_en: "Tajweed", field_type: "SELECT", options: ["ممتاز", "جيد"], sort_order: 1, is_required: false, is_active: true },
      { id: "f3", academy_id: "a1", key: "notes", label_ar: "ملاحظات", label_en: "Notes", field_type: "TEXTAREA", options: null, sort_order: 2, is_required: false, is_active: true },
    ],
    inactiveReportFields: [],
    ...overrides,
  };
}

function ownerSession(): Session {
  return makeSession("ACADEMY_OWNER", {
    permissions: ["session.read", "session.mark_attendance", "session.write_report"],
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
    vi.mocked(api.markAttendance).mockResolvedValue({ status: "ATTENDED", billed: true, classification: { billableToStudent: true, countsForTeacher: true } });
    vi.mocked(api.putSessionReport).mockResolvedValue({ ok: true, values: {} });
    vi.mocked(api.getStudentReports).mockResolvedValue({
      reports: [],
      total: 0,
      page: 1,
      pageSize: 25,
    });
  });

  it("renders the academy report fields by type, in order (AC-6.4)", async () => {
    renderPanel();

    expect(await screen.findByLabelText(/From surah/)).toBeInTheDocument();
    // SELECT renders its options.
    expect(screen.getByRole("option", { name: "ممتاز" })).toBeInTheDocument();
    // TEXTAREA for notes.
    expect(screen.getByLabelText(/Notes/).tagName).toBe("TEXTAREA");
    // Required marker on surah_from.
    expect(screen.getByLabelText(/From surah/).closest("div")?.textContent).toContain("*");
  });

  it("records an outcome via markAttendance (AC-6.1)", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByTestId("outcome-ATTENDED"));

    expect(api.markAttendance).toHaveBeenCalledWith("se1", {
      status: "ATTENDED",
      override_timing: false,
    });
  });

  it("shows field-level validation errors returned by the API (AC-6.5)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.putSessionReport).mockRejectedValueOnce(
      new ApiError(422, "invalid", {
        errors: { "values.surah_from": ["From surah is required."] },
      }),
    );
    renderPanel();

    await user.click(await screen.findByTestId("save-report"));

    expect(await screen.findByTestId("error-surah_from")).toHaveTextContent(
      "From surah is required.",
    );
  });

  it("offers a timing override after a 422 timing rejection (AC-6.9)", async () => {
    const user = userEvent.setup();
    vi.mocked(api.markAttendance).mockRejectedValueOnce(
      new ApiError(422, "This session has not started yet."),
    );
    renderPanel();

    await user.click(await screen.findByTestId("outcome-ATTENDED"));

    expect(await screen.findByTestId("override-timing")).toBeInTheDocument();
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

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Attendance recorded.",
    );
  });

  it("opens the report-history popup (AC-6.11)", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByTestId("open-history"));

    // The history modal mounts the archive DataTable.
    expect(await screen.findByTestId("report-archive-table")).toBeInTheDocument();
  });

  it("hides attendance controls when the user lacks the capability (AC-6.8)", async () => {
    renderPanel(
      makeSession("TEACHER", { permissions: ["session.read"] }),
    );

    await screen.findByTestId("attendance-report");
    // No write capabilities → the outcome buttons are disabled and the save button is absent.
    expect(screen.getByTestId("outcome-ATTENDED")).toBeDisabled();
    expect(screen.queryByTestId("save-report")).not.toBeInTheDocument();
  });
});
