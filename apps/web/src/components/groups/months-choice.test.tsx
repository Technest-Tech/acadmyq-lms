import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import type { GroupDetail, GroupMember } from "@/lib/groups-api";
import { MemberPriceForm } from "./group-members-panel";

const updateGroupMember = vi.fn();
vi.mock("@/lib/groups-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/groups-api")>()),
  updateGroupMember: (...a: unknown[]) => updateGroupMember(...a),
}));

const pricing = { billing_mode: "MONTHLY", price_minor: 45000, currency: "EGP", charge_absent: false, prorate_join: true, month_minutes: null, solo_billed_minutes: null, two_month_price_minor: 80000 } as const;
const group = { id: "g1", pricing, timezone: "Africa/Cairo" } as unknown as GroupDetail;
const member = { id: "m1", student_id: "s1", price_minor: null, months_per_charge: 1 } as unknown as GroupMember;

function renderForm(g: GroupDetail = group) {
  const onSaved = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MemberPriceForm group={g} member={member} onCancel={vi.fn()} onSaved={onSaved} />
    </NextIntlClientProvider>,
  );
  return onSaved;
}

describe("MemberPriceForm — one month or two (lingo)", () => {
  it("switches a member to two months at the offer without touching their price", async () => {
    updateGroupMember.mockResolvedValue({ group });
    const user = userEvent.setup();
    const onSaved = renderForm();
    // Nothing changed yet: nothing to save.
    expect(screen.getByTestId("member-price-save")).toBeDisabled();
    expect(screen.getByTestId("member-months-2")).toHaveTextContent(enMessages.groups.months.twoOffer);
    expect(screen.getByTestId("member-months-2")).toHaveTextContent("800");
    await user.click(screen.getByTestId("member-months-2"));
    await user.click(screen.getByTestId("member-price-save"));
    expect(updateGroupMember).toHaveBeenCalledWith("g1", "s1", { months_per_charge: 2 });
    expect(onSaved).toHaveBeenCalled();
  });

  it("is not offered for a group that does not bill by the month", () => {
    renderForm({ ...group, pricing: { ...pricing, billing_mode: "PER_LESSON" } } as unknown as GroupDetail);
    expect(screen.queryByTestId("member-months")).not.toBeInTheDocument();
  });
});
