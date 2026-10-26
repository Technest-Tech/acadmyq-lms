import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import type { LeadRow } from "@/lib/api";
import { LeadDetail } from "./lead-detail";

const lead: LeadRow = {
  id: "l1",
  full_name: "Omar Ali",
  whatsapp_phone: "+201000000000",
  source: "WHATSAPP",
  interested_in: null,
  status: "NEW",
  lost_reason: null,
  follow_up_at: null,
  converted_student_id: null,
  created_at: "2026-10-20T10:00:00Z",
  trial_id: null,
  trial_status: null,
  trial_teacher_id: null,
  trial_teacher_name: null,
  trial_scheduled_at_utc: null,
  trial_duration_minutes: null,
  trial_notes: null,
};

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getLead: () => Promise.resolve({ lead, activities: [], today: "2026-10-26" }),
}));

function renderDetail(canManage: boolean, onDelete = vi.fn()) {
  render(
    withAuth(
      makeSession("ACADEMY_OWNER", { permissions: ["crm.read", ...(canManage ? ["crm.manage"] : [])] }),
      <LeadDetail
        leadId="l1"
        canManage={canManage}
        refreshToken={0}
        onChanged={() => {}}
        onMove={() => {}}
        onBookTrial={() => {}}
        onDelete={onDelete}
      />,
    ),
  );
  return onDelete;
}

describe("LeadDetail — delete from the lead itself", () => {
  it("offers delete to whoever manages leads, and hands the lead to the manager's confirm", async () => {
    const onDelete = renderDetail(true);

    await userEvent.click(await screen.findByTestId("crm-detail-delete"));

    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "l1" }));
  });

  it("hides it from a read-only role", async () => {
    renderDetail(false);

    await screen.findByText("Omar Ali");
    expect(screen.queryByTestId("crm-detail-delete")).toBeNull();
  });
});
