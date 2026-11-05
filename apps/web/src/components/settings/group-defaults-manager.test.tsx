import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { GroupDefaults } from "@/lib/group-defaults-api";
import { GroupDefaultsManager } from "./group-defaults-manager";
import { SettingsManager } from "./settings-manager";

/**
 * Settings → group defaults (docs/centre-profile/02-COHERENCE-AUDIT §3): opens on what is saved,
 * saves amounts in minor units and the share in basis points, keeps each money half from whoever
 * may not set it — and is a centre's only.
 */

const getGroupDefaults = vi.fn();
const updateGroupDefaults = vi.fn();
vi.mock("@/lib/group-defaults-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/group-defaults-api")>()),
  getGroupDefaults: () => getGroupDefaults(),
  updateGroupDefaults: (patch: unknown) => updateGroupDefaults(patch),
}));
vi.mock("@/lib/rooms-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rooms-api")>()),
  listRooms: () => Promise.resolve({ rooms: [] }),
}));
vi.mock("@/lib/levels-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/levels-api")>()),
  listLevels: () => Promise.resolve({ levels: [] }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listSpecializations: () => Promise.resolve({ specializations: [] }),
}));

const ar = arMessages.groupDefaults;

const empty: GroupDefaults = {
  lesson_minutes: null,
  mode: null,
  billing_mode: null,
  month_lessons: null,
  teacher_pay_mode: null,
  teacher_pay_minor: null,
  teacher_share_bp: null,
};

const owner = (permissions = ["specialization.manage", "student.set_price", "teacher.set_pay"]) =>
  makeSession("ACADEMY_OWNER", { permissions, capabilities: ["centre", "groups", "accounting"] });

beforeEach(() => {
  vi.clearAllMocks();
  getGroupDefaults.mockResolvedValue({ defaults: empty });
  updateGroupDefaults.mockResolvedValue({ defaults: empty });
});

describe("GroupDefaultsManager", () => {
  it("opens on what is saved", async () => {
    getGroupDefaults.mockResolvedValue({
      defaults: { ...empty, lesson_minutes: 90, mode: "OFFLINE", billing_mode: "MONTHLY", month_lessons: 8, teacher_pay_mode: "PER_LESSON", teacher_pay_minor: 15000 },
    });
    render(withAuth(owner(), <GroupDefaultsManager />));

    expect(await screen.findByTestId("defaults-minutes")).toHaveValue("90");
    expect(screen.getByTestId("defaults-mode")).toHaveValue("OFFLINE");
    expect(screen.getByTestId("defaults-billing")).toHaveValue("MONTHLY");
    expect(screen.getByTestId("defaults-month-lessons")).toHaveValue(8);
    expect(screen.getByTestId("defaults-pay-mode")).toHaveValue("PER_LESSON");
    expect(screen.getByTestId("defaults-pay-amount")).toHaveValue("150");
  });

  it("saves the amount in minor units", async () => {
    const user = userEvent.setup();
    render(withAuth(owner(), <GroupDefaultsManager />));

    await user.selectOptions(await screen.findByTestId("defaults-minutes"), "60");
    await user.selectOptions(screen.getByTestId("defaults-mode"), "OFFLINE");
    await user.selectOptions(screen.getByTestId("defaults-billing"), "MONTHLY");
    await user.type(screen.getByTestId("defaults-month-lessons"), "8");
    await user.selectOptions(screen.getByTestId("defaults-pay-mode"), "PER_LESSON");
    await user.type(screen.getByTestId("defaults-pay-amount"), "150");
    await user.click(screen.getByTestId("defaults-save"));

    await waitFor(() =>
      expect(updateGroupDefaults).toHaveBeenCalledWith({
        lesson_minutes: 60,
        mode: "OFFLINE",
        billing_mode: "MONTHLY",
        month_lessons: 8,
        teacher_pay_mode: "PER_LESSON",
        teacher_pay_minor: 15000,
      }),
    );
    expect(await screen.findByText(ar.saved)).toBeInTheDocument();
  });

  it("saves a revenue share in basis points, and refuses a pay mode with no amount", async () => {
    const user = userEvent.setup();
    render(withAuth(owner(), <GroupDefaultsManager />));

    await user.selectOptions(await screen.findByTestId("defaults-pay-mode"), "PER_HOUR");
    await user.click(screen.getByTestId("defaults-save"));
    expect(await screen.findByText(arMessages.groups.form.errors.payAmount)).toBeInTheDocument();
    expect(updateGroupDefaults).not.toHaveBeenCalled();

    await user.selectOptions(screen.getByTestId("defaults-pay-mode"), "REVENUE_SHARE");
    await user.type(screen.getByTestId("defaults-share"), "40");
    await user.click(screen.getByTestId("defaults-save"));
    await waitFor(() => expect(updateGroupDefaults).toHaveBeenCalledTimes(1));
    expect(updateGroupDefaults.mock.calls[0]![0]).toMatchObject({ teacher_pay_mode: "REVENUE_SHARE", teacher_share_bp: 4000 });
  });

  it("shows and sends no money to someone who may not set it", async () => {
    const user = userEvent.setup();
    render(withAuth(owner(["specialization.manage"]), <GroupDefaultsManager />));

    await user.selectOptions(await screen.findByTestId("defaults-minutes"), "45");
    expect(screen.queryByTestId("defaults-billing")).toBeNull();
    expect(screen.queryByTestId("defaults-pay-mode")).toBeNull();
    await user.click(screen.getByTestId("defaults-save"));

    await waitFor(() => expect(updateGroupDefaults).toHaveBeenCalledWith({ lesson_minutes: 45, mode: null }));
  });
});

describe("Settings → the group defaults card", () => {
  it("is there for a centre", async () => {
    render(withAuth(owner(), <SettingsManager />));
    expect(await screen.findByTestId("group-defaults-manager")).toBeInTheDocument();
  });

  it("is not there for an academy without the centre switch", async () => {
    render(withAuth(makeSession("ACADEMY_OWNER"), <SettingsManager />));
    await waitFor(() => expect(screen.getByTestId("settings-tab-courses")).toBeInTheDocument());
    expect(screen.queryByTestId("group-defaults-manager")).toBeNull();
    expect(getGroupDefaults).not.toHaveBeenCalled();
  });
});
