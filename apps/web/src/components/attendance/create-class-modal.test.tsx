import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import type { DataTableQuery } from "@/lib/api";
import { CreateClassModal } from "./create-class-modal";

/**
 * The "add a lesson" dialog lists students from the API, which clamps a page to 100 rows. Lingo
 * (2026-11-15): "the student names stop at the letter س" — the dialog asked for one page of 200
 * and got the first 100, alphabetically. It must load the whole roster.
 */

const listStudents = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listStudents: (q: DataTableQuery) => listStudents(q),
  listTeachers: () => Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 100 }),
}));

function student(i: number) {
  return { id: `s${i}`, full_name: `Student ${String(i).padStart(3, "0")}` };
}

beforeEach(() => listStudents.mockReset());

describe("CreateClassModal", () => {
  it("lists every student of a centre, past the API's 100-row page", async () => {
    // 150 students: page 1 = the first 100, page 2 = the other 50.
    listStudents.mockImplementation((q?: DataTableQuery) => {
      const page = q?.page ?? 1;
      const rows = Array.from({ length: page === 1 ? 100 : 50 }, (_, i) => student((page - 1) * 100 + i + 1));
      return Promise.resolve({ rows, total: 150, page, pageSize: 100 });
    });
    const owner = makeSession("ACADEMY_OWNER", { capabilities: ["centre", "invoicing"] });
    render(withAuth(owner, <CreateClassModal day="2026-11-15" open onClose={() => {}} onCreated={() => {}} />));

    const select = (await screen.findByTestId("create-class-student")) as HTMLSelectElement;
    // The placeholder + all 150.
    await waitFor(() => expect(select.options.length).toBe(151));
    expect([...select.options].some((o) => o.textContent === "Student 150")).toBe(true);
    // Never more than a page the API serves.
    expect(listStudents.mock.calls.every(([q]) => (q as DataTableQuery | undefined)?.pageSize === 100)).toBe(true);
  });
});
