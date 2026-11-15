import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ManualPaymentOptions, PaymentOptions } from "./payment-options";

/**
 * The academy's manual methods on the payer's page: wallet numbers named by network, InstaPay's
 * link as a button, the academy's own "other" method under its own name — and a method this page
 * does not know about is skipped rather than crashing it.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("manual payment methods", () => {
  it("shows wallet numbers with their network, the amount and the reference", async () => {
    render(
      <PaymentOptions
        currency="EGP"
        invoiceToken="tok"
        amountMinor={50000}
        reference="INV-7F3A"
        methods={[
          { method: "WALLET", config: { numbers: ["01012345678", "01212345678"], holder: "Noor", note: "ابعت الصورة على واتساب" } },
          { method: "INSTAPAY", config: { address: "noor@instapay", link: "https://ipn.eg/S/noor" } },
        ]}
      />,
    );

    await userEvent.click(within(screen.getByTestId("pay-method-WALLET")).getAllByRole("button")[0]!);
    const wallet = screen.getByTestId("pay-method-WALLET");
    expect(within(wallet).getByText("01012345678")).toBeInTheDocument();
    expect(within(wallet).getByText("Vodafone Cash")).toBeInTheDocument();
    expect(within(wallet).getByText("Orange Cash")).toBeInTheDocument();
    expect(within(wallet).getByText("INV-7F3A")).toBeInTheDocument();
    expect(within(wallet).getByText("ابعت الصورة على واتساب")).toBeInTheDocument();
  });

  it("opens InstaPay's link in a new tab", async () => {
    render(
      <ManualPaymentOptions
        currency="EGP"
        amountMinor={50000}
        reference="Hassan Family"
        methods={[{ method: "INSTAPAY", config: { address: "noor@instapay", link: "https://ipn.eg/S/noor" } }]}
      />,
    );

    // The only method opens by itself.
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://ipn.eg/S/noor");
    expect(link).toHaveAttribute("target", "_blank");
    expect(screen.getByText("noor@instapay")).toBeInTheDocument();
  });

  it("names the academy's own method, and skips one it does not know", () => {
    render(
      <ManualPaymentOptions
        currency="USD"
        amountMinor={2500}
        reference="Hassan Family"
        methods={[
          { method: "OTHER", config: { title: "Western Union", details: "Receiver: Noor Academy, Cairo" } },
          { method: "CRYPTO" as never, config: {} },
        ]}
      />,
    );

    expect(screen.getByText("Western Union")).toBeInTheDocument();
    expect(screen.getByText("Receiver: Noor Academy, Cairo")).toBeInTheDocument();
    expect(screen.queryByTestId("pay-method-CRYPTO")).not.toBeInTheDocument();
  });
});
