import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import type { PaymentSetting } from "@/lib/api";
import { makeSession, withAuth } from "@/test/auth";
import { PaymentMethodsManager } from "./payment-methods-manager";

/**
 * Settings → Payment methods: the academy switches on the ways its payers can send money (wallet
 * numbers, InstaPay, PayPal, bank, its own text) and fills in where the money goes. A method with
 * nowhere to send the money is refused before it reaches the API.
 */

const listPaymentSettings = vi.fn();
const savePaymentSetting = vi.fn();
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listPaymentSettings: () => listPaymentSettings(),
  savePaymentSetting: (method: string, body: unknown) => savePaymentSetting(method, body),
}));

const ar = arMessages.settings.payments;

const rows = (over: Partial<Record<string, Partial<PaymentSetting>>> = {}): { payment_settings: PaymentSetting[] } => ({
  payment_settings: (["WALLET", "INSTAPAY", "BANK_TRANSFER", "PAYPAL", "OTHER", "XPAY"] as const).map((method) => ({
    method,
    is_active: false,
    config: {},
    ...(method === "XPAY" ? { configured: false } : {}),
    ...over[method],
  })) as PaymentSetting[],
});

const owner = () => makeSession("ACADEMY_OWNER");

beforeEach(() => {
  vi.clearAllMocks();
  listPaymentSettings.mockResolvedValue(rows());
  savePaymentSetting.mockResolvedValue({ ok: true });
});

describe("PaymentMethodsManager", () => {
  it("lists every method switched off, and says card payment is not set up", async () => {
    render(withAuth(owner(), <PaymentMethodsManager />));

    expect(await screen.findByText(ar.methods.WALLET.title)).toBeInTheDocument();
    expect(screen.getByText(ar.methods.INSTAPAY.title)).toBeInTheDocument();
    expect(screen.getByText(ar.methods.PAYPAL.title)).toBeInTheDocument();
    expect(screen.getByText(ar.noneActive)).toBeInTheDocument();
    expect(screen.getByText(ar.xpayNotSetUp)).toBeInTheDocument();
    expect(screen.getByTestId("pay-toggle-XPAY")).toBeDisabled();
  });

  it("refuses to switch wallets on without a number", async () => {
    render(withAuth(owner(), <PaymentMethodsManager />));

    await userEvent.click(await screen.findByTestId("pay-toggle-WALLET"));
    await userEvent.click(screen.getByTestId("pay-save-WALLET"));

    expect(screen.getByText(ar.errors.WALLET)).toBeInTheDocument();
    expect(savePaymentSetting).not.toHaveBeenCalled();
  });

  it("saves wallet numbers, naming the network of each as it is typed", async () => {
    render(withAuth(owner(), <PaymentMethodsManager />));

    await userEvent.click(await screen.findByTestId("pay-toggle-WALLET"));
    await userEvent.type(screen.getByTestId("pay-WALLET-number-0"), "01012345678");
    expect(screen.getByText("فودافون كاش")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("pay-WALLET-add-number"));
    await userEvent.type(screen.getByTestId("pay-WALLET-number-1"), "01112345678");
    expect(screen.getByText("اتصالات كاش")).toBeInTheDocument();

    listPaymentSettings.mockResolvedValue(
      rows({ WALLET: { is_active: true, config: { numbers: ["01012345678", "01112345678"], holder: "", note: "" } } }),
    );
    await userEvent.click(screen.getByTestId("pay-save-WALLET"));

    expect(savePaymentSetting).toHaveBeenCalledWith("WALLET", {
      is_active: true,
      config: { holder: "", numbers: ["01012345678", "01112345678"], note: "" },
    });
    expect(await within(screen.getByTestId("pay-method-WALLET")).findByText(ar.saved)).toBeInTheDocument();
  });

  it("refuses a link that is not a web link", async () => {
    render(withAuth(owner(), <PaymentMethodsManager />));

    await userEvent.click(await screen.findByTestId("pay-toggle-INSTAPAY"));
    await userEvent.type(screen.getByTestId("pay-INSTAPAY-link"), "javascript:alert(1)");
    await userEvent.click(screen.getByTestId("pay-save-INSTAPAY"));

    expect(screen.getByText(ar.errors.link)).toBeInTheDocument();
    expect(savePaymentSetting).not.toHaveBeenCalled();
  });

  it("sends PayPal's payer-facing fields only, so its API keys stay as they are", async () => {
    listPaymentSettings.mockResolvedValue(
      rows({ PAYPAL: { is_active: true, config: { email: "", client_id: "AcId", mode: "live" }, has_client_secret: true } }),
    );
    render(withAuth(owner(), <PaymentMethodsManager />));

    expect(await screen.findByText(ar.paypalAuto)).toBeInTheDocument();
    await userEvent.type(screen.getByTestId("pay-PAYPAL-email"), "pay@noor.test");
    await userEvent.click(screen.getByTestId("pay-save-PAYPAL"));

    expect(savePaymentSetting).toHaveBeenCalledWith("PAYPAL", {
      is_active: true,
      config: { email: "pay@noor.test", paypal_me: "", note: "" },
    });
  });
});
