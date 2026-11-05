import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import { StudentForm } from "@/components/students/student-form";
import { LevelSelect } from "./level-select";

/**
 * The picker every level field shares, and the student form around it, read the academy's own word
 * for the classification (docs/centre-profile/02-COHERENCE-AUDIT §3) — and say what they always said
 * until an academy picks another.
 */

const listLevels = vi.fn();
vi.mock("@/lib/levels-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/levels-api")>()),
  listLevels: () => listLevels(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listTeachers: () => Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 200 }),
  listGuardians: () => Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 200 }),
}));

function session(levelLabel?: "LEVEL" | "GRADE" | "YEAR") {
  const s = makeSession("ACADEMY_OWNER", { capabilities: ["centre", "groups", "accounting"] });
  s.academy = { ...s.academy!, levelLabel };
  return s;
}

beforeEach(() => {
  vi.clearAllMocks();
  listLevels.mockResolvedValue({ levels: [] });
});

describe("LevelSelect", () => {
  it("says level until the academy chooses", async () => {
    render(withAuth(session(), <LevelSelect value="" onChange={() => {}} withAddLink />));

    expect(await screen.findByRole("option", { name: "بدون مستوى" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "المستوى / الصف" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "أضف مستوى" })).toBeInTheDocument();
  });

  it("says grade for a grade-keeping academy", async () => {
    render(withAuth(session("GRADE"), <LevelSelect value="" onChange={() => {}} withAddLink />));

    expect(await screen.findByRole("option", { name: "بدون صف" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "الصف" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "أضف صفًا" })).toBeInTheDocument();
  });

  it("says year for a year-keeping academy", async () => {
    render(withAuth(session("YEAR"), <LevelSelect value="" onChange={() => {}} withAddLink />));

    expect(await screen.findByRole("option", { name: "بدون سنة" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "أضف سنة" })).toBeInTheDocument();
  });
});

describe("StudentForm's level field", () => {
  it("is named in the academy's word", async () => {
    render(withAuth(session("GRADE"), <StudentForm onCreated={() => {}} onCancel={() => {}} />));

    await waitFor(() => expect(listLevels).toHaveBeenCalled());
    expect(await screen.findByText("الصف")).toBeInTheDocument();
    expect(screen.queryByText("المستوى / الصف")).toBeNull();
  });
});
