import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { TrialRow } from "@/lib/api";
import { ConvertTrialFlow } from "./convert-trial-flow";

const convertTrial = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  convertTrial: (...args: unknown[]) => convertTrial(...args),
}));
// The student form has its own tests: here it only has to hand back the student it made.
vi.mock("@/components/students/student-form", () => ({
  StudentForm: ({ onCreated }: { onCreated: (id: string) => void }) => (
    <button type="button" data-testid="stub-create" onClick={() => onCreated("st-new")}>
      create
    </button>
  ),
}));

const ar = arMessages.trials.convert.count;
const yes = arMessages.attendance.cancelBilling.yes;

const trial: TrialRow = {
  id: "tr1", teacher_id: "t1", teacher_name: "Mona", student_id: null, student_name: null, lead_id: null,
  crm_lead_name: null, crm_source: null, from_crm: false, lead_name: "Shaimaa", lead_whatsapp: "+201012345678",
  lead_email: null, display_name: "Shaimaa", is_lead: true, timezone: "Africa/Cairo",
  scheduled_at_utc: "2026-11-10T08:30:00Z", ends_at_utc: "2026-11-10T09:15:00Z", duration_minutes: 45,
  status: "COMPLETED", outcome_notes: null, converted_student_id: null, created_at: "2026-11-09T10:00:00Z",
  needs_decision: false, contact_whatsapp: "+201012345678",
};

function renderFlow(permissions: string[], over: Partial<TrialRow> = {}) {
  const onConverted = vi.fn();
  render(
    withAuth(
      makeSession("ACADEMY_OWNER", { permissions: ["trial.read", "trial.manage", ...permissions] }),
      <ConvertTrialFlow trial={{ ...trial, ...over }} onConverted={onConverted} onCancel={vi.fn()} />,
    ),
  );
  return onConverted;
}

describe("ConvertTrialFlow — does the trial lesson count?", () => {
  beforeEach(() => {
    convertTrial.mockReset().mockResolvedValue({ ok: true, studentId: "st-new", sessionId: null });
  });

  it("counts the trial on the student and for the teacher when the office says so", async () => {
    const user = userEvent.setup();
    const onConverted = renderFlow(["session.bill_override"]);

    expect(screen.getByText(ar.title)).toBeInTheDocument();
    await user.click(within(screen.getByTestId("convert-trial-charge")).getByText(yes));
    await user.click(within(screen.getByTestId("convert-trial-pay")).getByText(yes));
    await user.click(screen.getByTestId("stub-create"));

    await waitFor(() =>
      expect(convertTrial).toHaveBeenCalledWith("tr1", "st-new", {
        charge_student: true,
        pay_teacher: true,
        reason: ar.reason,
      }),
    );
    expect(onConverted).toHaveBeenCalled();
  });

  it("counts it nowhere unless asked", async () => {
    const user = userEvent.setup();
    renderFlow(["session.bill_override"]);
    await user.click(screen.getByTestId("stub-create"));
    await waitFor(() => expect(convertTrial).toHaveBeenCalledWith("tr1", "st-new", undefined));
  });

  it("does not ask someone who may not make the money call", () => {
    renderFlow([]);
    expect(screen.queryByTestId("convert-trial-count")).toBeNull();
  });

  it("does not ask about a trial nobody attended", () => {
    renderFlow(["session.bill_override"], { status: "NO_SHOW" });
    expect(screen.queryByTestId("convert-trial-count")).toBeNull();
  });
});
