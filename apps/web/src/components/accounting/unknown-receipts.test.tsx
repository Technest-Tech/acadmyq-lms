import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { UnknownCollectModal } from "./unknown-collect-modal";

const recordReceipt = vi.fn();
vi.mock("@/lib/accounting-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounting-api")>()),
  recordReceipt: (i: unknown) => recordReceipt(i),
}));

const t = arMessages.accounting.unknown;
const owner = () => makeSession("ACADEMY_OWNER", { capabilities: ["invoicing", "accounting"] });

describe("Money from an unknown payer (lingo)", () => {
  beforeEach(() => recordReceipt.mockReset());

  it("records the money as unknown — a transfer still needs its picture", async () => {
    recordReceipt.mockResolvedValue({ receipt: { id: "r9" } });
    const onRecorded = vi.fn();
    render(withAuth(owner(), <UnknownCollectModal open onClose={() => {}} onRecorded={onRecorded} />));
    expect(screen.getByText(t.hint)).toBeTruthy();
    await userEvent.type(screen.getByTestId("unknown-amount"), "450");
    expect(screen.getByTestId("unknown-submit")).toBeDisabled();
    await userEvent.upload(screen.getByTestId("unknown-proof"), new File(["img"], "t.png", { type: "image/png" }));
    await userEvent.click(screen.getByTestId("unknown-submit"));
    await waitFor(() => expect(recordReceipt).toHaveBeenCalledTimes(1));
    expect(recordReceipt.mock.calls[0]![0]).toMatchObject({ unknown_payer: true, amount_minor: 45000, method: "INSTAPAY" });
    expect(onRecorded).toHaveBeenCalled();
  });
});
