import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { subRow } from "@/components/subscriptions/test-fixtures";
import { formatMoney } from "@/lib/money";
import { makeSession, withAuth } from "@/test/auth";
import { EditSubscriptionForm } from "./edit-subscription-form";

/** Everything on a block is editable (PATCH /subscriptions/{id}); the floor is what was taught. */
const updateSubscription = vi.fn();
vi.mock("@/lib/subscriptions-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subscriptions-api")>()),
  updateSubscription: (...a: unknown[]) => updateSubscription(...a),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listTeachers: () => Promise.resolve({ rows: [{ id: "t1", full_name: "Mr Ali" }, { id: "t7", full_name: "Mr Hany" }], total: 2, page: 1, pageSize: 200 }),
}));

const ar = arMessages.subscriptions.edit;
const money = (minor: number) => formatMoney({ amount: minor, currency: "EGP" }, "ar");
const session = () => makeSession("ACADEMY_OWNER", { permissions: ["package.manage"], capabilities: ["centre"] });

beforeEach(() => {
  updateSubscription.mockReset();
});

describe("EditSubscriptionForm", () => {
  it("opens on the block as sold, moves it to another teacher and start date, and says what the edit gave back", async () => {
    updateSubscription.mockResolvedValue({ subscription: subRow(), invoice_id: "i1", credited_minor: 9000, due_minor: 0, moved_lessons: 3 });
    const onSaved = vi.fn();
    render(withAuth(session(), <EditSubscriptionForm row={subRow()} onSaved={onSaved} onCancel={() => {}} />));
    expect(screen.getByTestId("edit-lessons")).toHaveValue(8);
    expect(screen.getByTestId("edit-unit-price")).toHaveValue(90);
    expect(screen.getByTestId("edit-total")).toHaveValue(720);
    expect(screen.getByTestId("edit-starts-on")).toHaveValue("2026-10-01");
    expect(screen.getByTestId("edit-course")).toHaveValue("English");
    expect(screen.getByTestId("edit-bill-note").textContent).toContain(money(72000));

    await waitFor(() => expect((screen.getByTestId("edit-teacher") as HTMLSelectElement).options.length).toBeGreaterThan(1));
    await userEvent.selectOptions(screen.getByTestId("edit-teacher"), "t7");
    await userEvent.clear(screen.getByTestId("edit-starts-on"));
    await userEvent.type(screen.getByTestId("edit-starts-on"), "2026-10-05");
    await userEvent.clear(screen.getByTestId("edit-unit-price"));
    await userEvent.type(screen.getByTestId("edit-unit-price"), "80");
    expect(screen.getByTestId("edit-total")).toHaveValue(640);
    await userEvent.click(screen.getByTestId("edit-confirm"));
    await waitFor(() =>
      expect(updateSubscription).toHaveBeenCalledWith("sub1", { lessons_sold: 8, lesson_minutes: 40, lesson_price_minor: 8000, price_minor: 64000, label: "8 × English", starts_on: "2026-10-05", teacher_id: "t7", course: "English" }),
    );
    expect(onSaved).toHaveBeenCalledWith(expect.stringContaining(ar.movedLessons.split("{count")[0]!.trim() || "3"));
    expect(onSaved.mock.calls[0]![0]).toContain(money(9000));
  });

  it("will not shrink a block under what was taught", async () => {
    render(withAuth(session(), <EditSubscriptionForm row={subRow({ lessons_used: 5, lessons_left: 3 })} onSaved={() => {}} onCancel={() => {}} />));
    const lessons = screen.getByTestId("edit-lessons");
    await userEvent.clear(lessons);
    await userEvent.type(lessons, "4");
    expect(screen.getByTestId("edit-too-few")).toBeTruthy();
    expect(screen.getByTestId("edit-confirm")).toBeDisabled();
    await userEvent.clear(lessons);
    await userEvent.type(lessons, "12");
    expect(screen.queryByTestId("edit-too-few")).toBeNull();
    expect(screen.getByTestId("edit-confirm")).toBeEnabled();
  });
});
