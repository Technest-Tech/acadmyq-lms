import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { TeachersList } from "./teachers-list";

/** The teachers table's transfer-number column: shown with its method, copied in one tap. */
const listTeachers = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listTeachers: (...a: unknown[]) => listTeachers(...a),
}));

const ar = arMessages.teachers;
const teacher = (over: Record<string, unknown> = {}) => ({
  id: "t1", user_id: null, full_name: "Ali Hassan", phone: "+201000000000", specialization: null,
  session_rate_minor: null, pay_type: null, fixed_salary_minor: null, currency: null, timezone: null,
  availability: [], payout_method: "WALLET", payout_handle: "01012345678", is_active: true, deleted_at: null,
  created_at: "2026-10-01T00:00:00Z", added_by_name: null, ...over,
});
// Every kind of academy sees it — nothing about the column depends on `centre`.
const session = (capabilities: string[]) => makeSession("ACADEMY_OWNER", { permissions: ["teacher.read"], capabilities });

beforeEach(() => {
  listTeachers.mockReset();
  listTeachers.mockResolvedValue({ rows: [teacher(), teacher({ id: "t2", full_name: "No Payout", payout_method: null, payout_handle: null })], total: 2, page: 1, pageSize: 25 });
});

describe("TeachersList transfer number", () => {
  it.each([[[]], [["centre"]]])("shows the number and its method, and copies it without opening the teacher (%j)", async (caps) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onOpen = vi.fn();
    render(withAuth(session(caps), <TeachersList onNew={() => {}} onOpen={onOpen} />));

    expect((await screen.findAllByText(ar.colPayout)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("01012345678").length).toBeGreaterThan(0);
    expect(screen.getAllByText(ar.form.payoutWallet).length).toBeGreaterThan(0);

    const [copy] = screen.getAllByTestId("copy-payout");
    await userEvent.click(copy!);
    expect(writeText).toHaveBeenCalledWith("01012345678");
    expect(onOpen).not.toHaveBeenCalled();
    // A teacher with no destination gets no copy button — one per row that has a number.
    expect(screen.getAllByTestId("copy-payout").length).toBe(screen.getAllByText("01012345678").length);
  });
});
