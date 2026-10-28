import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyXpayCheckout } from "./payment-options";

/**
 * The family page's card button: one payment for the family's whole total, opened against
 * `/api/f/{token}` with the currency it pays, and confirmed on the way back from XPay.
 */
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/f/famtok");
});

afterEach(() => vi.unstubAllGlobals());

describe("FamilyXpayCheckout", () => {
  it("opens one checkout for the family total, in the currency it pays", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ message: "stop here" }), { status: 422 }));
    render(<FamilyXpayCheckout familyToken="famtok" amountMinor={100000} currency="EGP" confirmsReturn />);

    await userEvent.click(screen.getByRole("button"));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/f\/famtok\/xpay\/session$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ currency: "EGP" });
    // The API's refusal is shown, not swallowed.
    expect(await screen.findByText("stop here")).toBeInTheDocument();
  });

  it("confirms the payment it came back with, and refreshes the page once it is settled", async () => {
    window.history.replaceState(null, "", "/f/famtok?xpay=cs_test_fam9");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ paid: true }), { status: 200 }));
    render(<FamilyXpayCheckout familyToken="famtok" amountMinor={100000} currency="EGP" confirmsReturn />);

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/\/api\/f\/famtok\/xpay\/session\/cs_test_fam9$/);
  });

  it("leaves the confirmation to one button when a family pays in two currencies", () => {
    window.history.replaceState(null, "", "/f/famtok?xpay=cs_test_fam9");
    render(<FamilyXpayCheckout familyToken="famtok" amountMinor={5000} currency="USD" confirmsReturn={false} />);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
