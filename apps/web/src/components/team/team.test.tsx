import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import arMessages from "../../../messages/ar.json";
import { StaffForm } from "@/components/staff/staff-form";
import {
  applyLevel,
  levelOf,
  withLeftovers,
} from "@/components/team/role-areas";
import { RolesPanel } from "@/components/team/roles-panel";
import type { AcademyRoleArea, AcademyRolesResponse } from "@/lib/api";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  listAcademyRoles: vi.fn(),
  listStaffDepartments: vi.fn(),
  createAcademyRole: vi.fn(),
  createStaff: vi.fn(),
  tuneSystemRole: vi.fn(),
  resetSystemRole: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => null,
}));

import * as api from "@/lib/api";

const AREAS: AcademyRoleArea[] = [
  {
    key: "students",
    kind: "operations",
    view: ["student.read"],
    manage: ["student.create", "student.update"],
  },
  {
    key: "notifications",
    kind: "operations",
    view: ["notification.read"],
    manage: [],
  },
  {
    key: "supervision",
    kind: "operations",
    view: [],
    manage: ["session.follow"],
  },
  {
    key: "invoices",
    kind: "financial",
    view: ["invoice.read"],
    manage: ["invoice.mark_paid"],
  },
  {
    key: "teacher_pay",
    kind: "financial",
    view: [],
    manage: ["teacher.set_pay"],
  },
  {
    key: "statistics",
    kind: "statistics",
    view: ["supervision.stats"],
    manage: [],
  },
];
const GRANTABLE = AREAS.flatMap((a) => [...a.view, ...a.manage]);

const SUPERVISOR = [
  "student.read",
  "student.create",
  "student.update",
  "notification.read",
  "session.follow",
];
const ACCOUNTANT = [
  "student.read",
  "invoice.read",
  "invoice.mark_paid",
  "teacher.set_pay",
];

const ROLES: AcademyRolesResponse = {
  system: [
    {
      code: "ACADEMY_OWNER",
      name: "ACADEMY_OWNER",
      system: true,
      permissions: GRANTABLE,
      assignedCount: 1,
    },
    {
      code: "MANAGER",
      name: "MANAGER",
      system: true,
      editable: true,
      permissions: GRANTABLE,
      assignedCount: 0,
    },
    {
      code: "SUPERVISOR",
      name: "SUPERVISOR",
      system: true,
      editable: true,
      permissions: SUPERVISOR,
      assignedCount: 2,
    },
    {
      code: "ACCOUNTANT",
      name: "ACCOUNTANT",
      system: true,
      editable: true,
      permissions: ACCOUNTANT,
      assignedCount: 0,
    },
    {
      code: "CUSTOMER_SERVICE",
      name: "CUSTOMER_SERVICE",
      system: true,
      editable: true,
      permissions: ["student.read", "student.create"],
      assignedCount: 0,
    },
    {
      code: "STAFF",
      name: "STAFF",
      system: true,
      editable: true,
      permissions: ["student.read"],
      assignedCount: 0,
    },
  ],
  custom: [],
  grantable: GRANTABLE,
  areas: AREAS,
  financial: ["invoice.read", "invoice.mark_paid", "teacher.set_pay"],
  statistics: ["supervision.stats"],
  presets: [
    { key: "supervisor", role: "SUPERVISOR", permissions: SUPERVISOR },
    { key: "accountant", role: "ACCOUNTANT", permissions: ACCOUNTANT },
  ],
};

describe("role sections", () => {
  const students = AREAS[0]!;
  const notifications = AREAS[1]!;

  it("reads a role as None / View / Manage / Partial per section", () => {
    expect(levelOf(students, new Set())).toBe("none");
    expect(levelOf(students, new Set(["student.read"]))).toBe("view");
    expect(
      levelOf(
        students,
        new Set(["student.read", "student.create", "student.update"]),
      ),
    ).toBe("manage");
    expect(levelOf(students, new Set(["student.read", "student.create"]))).toBe(
      "partial",
    );
    // A read-only section tops out at View, never Manage.
    expect(levelOf(notifications, new Set(["notification.read"]))).toBe("view");
  });

  it("sets one section without touching the others", () => {
    const held = new Set(["invoice.read", "student.create"]);
    expect([...applyLevel(students, held, "view")].sort()).toEqual([
      "invoice.read",
      "student.read",
    ]);
    expect([...applyLevel(students, held, "none")]).toEqual(["invoice.read"]);
  });

  it("never drops a grantable code no section claims", () => {
    const areas = withLeftovers(AREAS, [...GRANTABLE, "brand.new"]);
    expect(areas.at(-1)).toEqual({
      key: "other",
      kind: "operations",
      view: [],
      manage: ["brand.new"],
    });
  });
});

describe("RolesPanel", () => {
  beforeEach(() => {
    vi.mocked(api.listAcademyRoles).mockResolvedValue(ROLES);
    vi.mocked(api.createAcademyRole).mockResolvedValue({
      roleId: "r1",
      code: "CR_1",
    });
  });

  it("edits the supervisor for this academy only", async () => {
    const user = userEvent.setup();
    vi.mocked(api.tuneSystemRole).mockResolvedValue({
      ok: true,
      added: ["invoice.read", "invoice.mark_paid"],
      removed: [],
    });
    vi.mocked(api.resetSystemRole).mockResolvedValue({ ok: true });
    render(
      withAuth(
        makeSession("ACADEMY_OWNER", { permissions: ["role.manage"] }),
        <RolesPanel />,
      ),
    );

    // The owner and teacher are not editable; the shared staff roles are.
    await screen.findByTestId("role-card-SUPERVISOR");
    expect(screen.queryByTestId("edit-role-ACADEMY_OWNER")).toBeNull();
    await user.click(screen.getByTestId("edit-role-SUPERVISOR"));

    // No name to type — it is the supervisor — just its sections.
    expect(screen.queryByTestId("role-name")).toBeNull();
    await user.click(screen.getByTestId("level-invoices-manage"));
    await user.click(screen.getByTestId("save-role"));
    expect(api.tuneSystemRole).toHaveBeenCalledWith(
      "SUPERVISOR",
      expect.arrayContaining([
        ...SUPERVISOR,
        "invoice.read",
        "invoice.mark_paid",
      ]),
    );
  });

  it("offers an edited built-in role its way back to the default", async () => {
    const user = userEvent.setup();
    vi.mocked(api.resetSystemRole).mockResolvedValue({ ok: true });
    vi.mocked(api.listAcademyRoles).mockResolvedValue({
      ...ROLES,
      system: ROLES.system.map((r) =>
        r.code === "SUPERVISOR" ? { ...r, tuned: true } : r,
      ),
    });
    render(
      withAuth(
        makeSession("ACADEMY_OWNER", { permissions: ["role.manage"] }),
        <RolesPanel />,
      ),
    );

    const card = await screen.findByTestId("role-card-SUPERVISOR");
    expect(within(card).getByTestId("role-edited")).toBeInTheDocument();
    await user.click(screen.getByTestId("edit-role-SUPERVISOR"));
    await user.click(screen.getByTestId("reset-role"));
    expect(api.resetSystemRole).toHaveBeenCalledWith("SUPERVISOR");
  });

  it("marks which built-in roles reach money", async () => {
    render(
      withAuth(
        makeSession("ACADEMY_OWNER", { permissions: ["role.manage"] }),
        <RolesPanel />,
      ),
    );

    const supervisor = await screen.findByTestId("role-card-SUPERVISOR");
    expect(
      within(supervisor).getByText(arMessages.academyRoles.noMoney),
    ).toBeInTheDocument();
    const accountant = screen.getByTestId("role-card-ACCOUNTANT");
    expect(
      within(accountant).getByText(arMessages.academyRoles.seesMoney),
    ).toBeInTheDocument();
  });

  it("builds a role by section, starting from a preset, money in its own block", async () => {
    const user = userEvent.setup();
    render(
      withAuth(
        makeSession("ACADEMY_OWNER", { permissions: ["role.manage"] }),
        <RolesPanel />,
      ),
    );
    await user.click(await screen.findByTestId("new-role"));

    // Every section speaks Arabic, not capability codes.
    for (const area of AREAS) {
      const row = screen.getByTestId(`area-${area.key}`);
      expect(row.textContent).toContain(
        (arMessages.academyRoles.areas as Record<string, { label: string }>)[
          area.key
        ]!.label,
      );
    }
    expect(
      within(screen.getByTestId("builder-kind-financial")).getByTestId(
        "area-invoices",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("builder-kind-statistics")).getByTestId(
        "area-statistics",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByTestId("preset-supervisor"));
    expect(screen.getByTestId("level-students-manage")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("level-invoices-none")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Narrow it: students view-only, then hand over invoices to read.
    await user.click(screen.getByTestId("level-students-view"));
    await user.click(screen.getByTestId("level-invoices-view"));
    await user.click(screen.getByTestId("save-role"));

    const sent = vi.mocked(api.createAcademyRole).mock.calls[0]![0];
    expect(new Set(sent.permissions)).toEqual(
      new Set([
        "student.read",
        "notification.read",
        "session.follow",
        "invoice.read",
      ]),
    );
  });
});

describe("StaffForm — adding a member", () => {
  beforeEach(() => {
    vi.mocked(api.listAcademyRoles).mockResolvedValue(ROLES);
    vi.mocked(api.listStaffDepartments).mockResolvedValue({ departments: [] });
    vi.mocked(api.createStaff).mockResolvedValue({
      staffId: "s1",
      userId: "u1",
    });
  });

  it("offers the shared roles weakest first and only those the user can hand out", async () => {
    // An HR-style user: can add people, holds the student caps, but not money.
    const session = makeSession("ACADEMY_OWNER", {
      permissions: [
        "staff.create",
        "user.invite",
        "role.assign",
        "student.read",
        "student.create",
      ],
    });
    render(
      withAuth(session, <StaffForm onDone={vi.fn()} onCancel={vi.fn()} />),
    );

    await screen.findByTestId("role-option-CUSTOMER_SERVICE");
    const order = screen
      .getAllByRole("radio")
      .map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual([
      "role-option-STAFF",
      "role-option-CUSTOMER_SERVICE",
    ]);
    expect(
      screen.queryByTestId("role-option-ACCOUNTANT"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("role-option-MANAGER")).not.toBeInTheDocument();
  });

  it("keeps the salary out of the form for someone who may not set it", async () => {
    const user = userEvent.setup();
    const session = makeSession("ACADEMY_OWNER", {
      permissions: ["staff.create"],
    });
    render(
      withAuth(session, <StaffForm onDone={vi.fn()} onCancel={vi.fn()} />),
    );

    await user.click(screen.getByTestId("staff-details-toggle"));
    expect(screen.queryByTestId("staff-salary-fields")).not.toBeInTheDocument();

    await user.type(
      screen.getByLabelText(arMessages.staff.form.fullName),
      "Mona",
    );
    await user.click(screen.getByTestId("create-login"));
    await user.click(screen.getByTestId("staff-submit"));

    const sent = vi.mocked(api.createStaff).mock.calls.at(-1)![0];
    expect(sent).not.toHaveProperty("salary_minor");
    expect(sent).not.toHaveProperty("currency");
  });

  it("shows the salary to the owner", async () => {
    const user = userEvent.setup();
    render(
      withAuth(
        makeSession("ACADEMY_OWNER"),
        <StaffForm onDone={vi.fn()} onCancel={vi.fn()} />,
      ),
    );

    await user.click(screen.getByTestId("staff-details-toggle"));
    expect(screen.getByTestId("staff-salary-fields")).toBeInTheDocument();
  });
});
