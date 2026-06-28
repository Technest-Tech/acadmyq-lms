import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../../messages/en.json";
import { AddAcademyModal } from "./add-academy-modal";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  listAcademies: vi.fn(),
  getVideoPlans: vi.fn(),
  setVideoAccess: vi.fn(),
}));

import * as api from "@/lib/api";

function renderModal(onDone = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AddAcademyModal enabledIds={new Set(["a2"])} onClose={vi.fn()} onDone={onDone} />
    </NextIntlClientProvider>,
  );
  return onDone;
}

describe("AddAcademyModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listAcademies).mockResolvedValue({
      academies: [
        { id: "a1", name: "Noor Academy", status: "ACTIVE", plan_id: "p1" },
        { id: "a2", name: "Falah Academy", status: "ACTIVE", plan_id: "p1" },
      ],
    } as Awaited<ReturnType<typeof api.listAcademies>>);
    vi.mocked(api.getVideoPlans).mockResolvedValue({ plans: [{ id: "vt1", code: "VID", name: "Video Tier", grants_video: true, options: {}, video_capable: true }] });
    vi.mocked(api.setVideoAccess).mockResolvedValue({ ok: true, academy: null });
  });

  it("grants a trial to the picked academy with a tier", async () => {
    const user = userEvent.setup();
    const onDone = renderModal();

    await waitFor(() => expect(screen.getByRole("option", { name: "Noor Academy" })).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId("add-academy-select"), "a1");
    await user.selectOptions(screen.getByTestId("add-tier-select"), "vt1");
    // Default mode is "trial" with 14 days.
    await user.click(screen.getByRole("button", { name: enMessages.adminVideo.add.submit }));

    await waitFor(() =>
      expect(api.setVideoAccess).toHaveBeenCalledWith("a1", expect.objectContaining({ action: "trial", trial_days: 14, video_plan_id: "vt1" })),
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("switches to enable-now mode", async () => {
    const user = userEvent.setup();
    renderModal();

    await waitFor(() => expect(screen.getByRole("option", { name: "Noor Academy" })).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId("add-academy-select"), "a1");
    await user.click(screen.getByRole("button", { name: enMessages.adminVideo.add.modeEnable }));
    await user.click(screen.getByRole("button", { name: enMessages.adminVideo.add.submit }));

    await waitFor(() => expect(api.setVideoAccess).toHaveBeenCalledWith("a1", expect.objectContaining({ action: "enable" })));
  });
});
