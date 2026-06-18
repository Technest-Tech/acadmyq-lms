import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { CertificatesScreen } from "@/app/certificates/screen";
import type { CertificateContent } from "@/lib/api";
import * as api from "@/lib/api";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  listCertificateTemplates: vi.fn(),
  saveCertificateTemplate: vi.fn(),
}));

const canMock = vi.fn((p: string) => Boolean(p));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ can: canMock }),
}));

function content(overrides: Partial<CertificateContent> = {}): CertificateContent {
  return {
    academyNameEn: "Noor Academy",
    academyNameAr: "أكاديمية نور",
    titleEn: "Certificate of Achievement",
    titleAr: "شهادة تقدير",
    presentationEn: "This certificate is proudly presented to",
    presentationAr: "تُمنح هذه الشهادة بكل فخر إلى",
    bodyEn: "In recognition of dedication.",
    bodyAr: "تقديرًا للاجتهاد.",
    signatoryNameEn: "",
    signatoryNameAr: "",
    signatoryTitleEn: "Academy Director",
    signatoryTitleAr: "مدير الأكاديمية",
    accentColor: "#C9A227",
    ...overrides,
  };
}

function renderScreen() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CertificatesScreen />
    </NextIntlClientProvider>,
  );
}

describe("CertificatesScreen", () => {
  beforeEach(() => {
    canMock.mockReset();
    canMock.mockReturnValue(true);
    vi.mocked(api.listCertificateTemplates).mockResolvedValue({
      templates: [
        { templateNumber: 1, content: content() },
        { templateNumber: 2, content: content({ titleEn: "Certificate of Excellence", accentColor: "#0E7C5A" }) },
      ],
    });
    vi.mocked(api.saveCertificateTemplate).mockResolvedValue({ ok: true, content: content() });
  });

  it("loads both templates and shows the first template's content in the editor", async () => {
    renderScreen();
    await waitFor(() => expect(api.listCertificateTemplates).toHaveBeenCalled());

    expect(screen.getByRole("button", { name: "Al-Noor" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Al-Andalus" })).toBeInTheDocument();

    const titleInput = await screen.findByLabelText("Title");
    expect(titleInput).toHaveValue("Certificate of Achievement");
  });

  it("reflects a recipient name edit in the live preview", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByLabelText("Title");

    await user.type(screen.getByLabelText("Student / recipient name"), "Yusuf Ahmad");

    // Appears in both the on-screen preview and the off-screen capture node.
    await waitFor(() => expect(screen.getAllByText("Yusuf Ahmad").length).toBeGreaterThan(0));
  });

  it("switches to the second template's content when its tab is clicked", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByLabelText("Title");

    await user.click(screen.getByRole("button", { name: "Al-Andalus" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Title")).toHaveValue("Certificate of Excellence"),
    );
  });

  it("saves the active template's edited content", async () => {
    const user = userEvent.setup();
    renderScreen();
    const titleInput = await screen.findByLabelText("Title");

    await user.clear(titleInput);
    await user.type(titleInput, "Hifz Completion");
    await user.click(screen.getByTestId("cert-save"));

    await waitFor(() =>
      expect(api.saveCertificateTemplate).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ titleEn: "Hifz Completion" }),
      ),
    );
  });

  it("hides the save button and disables fields without the manage capability", async () => {
    canMock.mockImplementation((p: string) => p === "certificate.read");
    renderScreen();

    const titleInput = await screen.findByLabelText("Title");
    expect(titleInput).toBeDisabled();
    expect(screen.queryByTestId("cert-save")).not.toBeInTheDocument();
    // Download stays available for read-only users.
    expect(screen.getByTestId("cert-download")).toBeInTheDocument();
  });

  it("shows a no-access message when the user lacks certificate.read", async () => {
    canMock.mockReturnValue(false);
    renderScreen();
    expect(
      await screen.findByText("You do not have access to certificates."),
    ).toBeInTheDocument();
  });
});

describe("CertificatesScreen — preview content", () => {
  beforeEach(() => {
    canMock.mockReturnValue(true);
    vi.mocked(api.listCertificateTemplates).mockResolvedValue({
      templates: [
        { templateNumber: 1, content: content({ titleEn: "Royal Title" }) },
        { templateNumber: 2, content: content({ titleEn: "Mosaic Title" }) },
      ],
    });
  });

  it("renders the academy name and title text inside the certificate", async () => {
    renderScreen();
    await screen.findByLabelText("Title");
    // Academy name + title render inside the design (preview + capture node).
    const previewRegion = await screen.findByText("Live preview");
    expect(previewRegion).toBeInTheDocument();
    expect(screen.getAllByText("Royal Title").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Noor Academy").length).toBeGreaterThan(0);
  });
});
