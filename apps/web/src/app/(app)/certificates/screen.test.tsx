import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../../messages/en.json";
import { CertificatesScreen } from "./screen";
import type { CertificateContent, CertificateTemplate, StudentRow } from "@/lib/api";
import * as api from "@/lib/api";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  listCertificateTemplates: vi.fn(),
  saveCertificateTemplate: vi.fn(),
  listStudents: vi.fn(),
}));

const canMock = vi.fn((p: string) => Boolean(p));
vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ can: canMock, session: null }),
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
    signatory2NameEn: "",
    signatory2NameAr: "",
    signatory2TitleEn: "",
    signatory2TitleAr: "",
    showLogo: true,
    accentColor: "#C9A227",
    ...overrides,
  };
}

function template(templateNumber: number, overrides: Partial<CertificateContent> = {}, customized = false): CertificateTemplate {
  return {
    templateNumber,
    content: content(overrides),
    defaults: content(overrides),
    customized,
    updatedAt: null,
  };
}

function student(id: string, full_name: string): StudentRow {
  return { id, full_name, teacher_name: "Ustadh Omar", deleted_at: null } as StudentRow;
}

function renderScreen() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CertificatesScreen />
    </NextIntlClientProvider>,
  );
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("tab", { name }));
}

describe("CertificatesScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canMock.mockReset();
    canMock.mockReturnValue(true);
    vi.mocked(api.listCertificateTemplates).mockResolvedValue({
      templates: [
        template(1),
        template(2, { titleEn: "Certificate of Excellence", accentColor: "#0E7C5A" }, true),
        template(4, { titleEn: "Certificate of Completion", accentColor: "#1E3A5F" }),
      ],
    });
    vi.mocked(api.saveCertificateTemplate).mockResolvedValue({ ok: true, content: content() });
    vi.mocked(api.listStudents).mockResolvedValue({
      // s1 twice: the API returns one row per subscription/teacher join.
      rows: [student("s1", "Yusuf Ahmad"), student("s1", "Yusuf Ahmad"), student("s2", "Maryam Hassan"), student("s3", "Omar Khaled")],
      total: 4,
      page: 1,
      pageSize: 100,
    });
  });

  it("shows every design the API returns in the gallery, with the first one open", async () => {
    renderScreen();

    const gallery = await screen.findByTestId("design-gallery");
    expect(within(gallery).getByRole("button", { name: "Al-Noor" })).toHaveAttribute("aria-pressed", "true");
    expect(within(gallery).getByRole("button", { name: "Al-Andalus" })).toBeInTheDocument();
    expect(within(gallery).getByRole("button", { name: "Diwan" })).toBeInTheDocument();
    // A design the API did not list is not offered.
    expect(within(gallery).queryByRole("button", { name: "Layl" })).not.toBeInTheDocument();
    // The saved one wears its badge.
    expect(within(gallery).getByText("Customised")).toBeInTheDocument();

    await openTab(userEvent.setup(), "Wording");
    expect(screen.getByLabelText("Title")).toHaveValue("Certificate of Achievement");
  });

  it("narrows the gallery to one category", async () => {
    const user = userEvent.setup();
    renderScreen();
    const gallery = await screen.findByTestId("design-gallery");

    await user.click(within(gallery).getByRole("button", { name: /Classic/ }));

    expect(within(gallery).getByRole("button", { name: "Diwan" })).toBeInTheDocument();
    expect(within(gallery).queryByRole("button", { name: "Al-Noor" })).not.toBeInTheDocument();
  });

  it("reflects a recipient name edit in the live preview", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(await screen.findByLabelText("Student / recipient name"), "Zaid Tariq");

    // Appears in both the on-screen preview and the off-screen capture node.
    await waitFor(() => expect(screen.getAllByText("Zaid Tariq").length).toBeGreaterThanOrEqual(2));
  });

  it("offers the academy's students as recipient suggestions", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(await screen.findByLabelText("Student / recipient name"), "Mar");
    await user.click(await screen.findByRole("option", { name: /Maryam Hassan/ }));

    expect(screen.getByLabelText("Student / recipient name")).toHaveValue("Maryam Hassan");
    expect(api.listStudents).toHaveBeenCalledWith(expect.objectContaining({ search: "Mar" }));
  });

  it("prints the programme and certificate number on the certificate", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.type(await screen.findByLabelText(/Programme or achievement/), "Juz Amma");
    await user.type(screen.getByLabelText(/Certificate no\./), "2026-007");

    await waitFor(() => expect(screen.getAllByText("Juz Amma").length).toBeGreaterThanOrEqual(2));
    expect(screen.getAllByText(/No\. 2026-007/).length).toBeGreaterThanOrEqual(2);
  });

  it("switches to another design's wording when its thumbnail is clicked", async () => {
    const user = userEvent.setup();
    renderScreen();
    const gallery = await screen.findByTestId("design-gallery");

    await user.click(within(gallery).getByRole("button", { name: "Al-Andalus" }));
    await openTab(user, "Wording");

    expect(screen.getByLabelText("Title")).toHaveValue("Certificate of Excellence");
  });

  it("marks an edit unsaved, then saves the active template's content", async () => {
    const user = userEvent.setup();
    renderScreen();
    await openTab(user, "Wording");

    expect(screen.getByTestId("cert-save")).toBeDisabled();

    const titleInput = screen.getByLabelText("Title");
    await user.clear(titleInput);
    await user.type(titleInput, "Hifz Completion");

    expect(screen.getByTestId("save-status")).toHaveTextContent("Unsaved changes");
    expect(within(screen.getByTestId("design-gallery")).getByText("Unsaved")).toBeInTheDocument();

    await user.click(screen.getByTestId("cert-save"));

    await waitFor(() =>
      expect(api.saveCertificateTemplate).toHaveBeenCalledWith(1, expect.objectContaining({ titleEn: "Hifz Completion" })),
    );
    await waitFor(() => expect(screen.getByTestId("save-status")).toHaveTextContent("Saved to your academy"));
  });

  it("restores the design's starting wording", async () => {
    const user = userEvent.setup();
    renderScreen();
    await openTab(user, "Wording");

    const titleInput = screen.getByLabelText("Title");
    await user.clear(titleInput);
    await user.type(titleInput, "Something else");
    await user.click(screen.getByTestId("restore-wording"));

    expect(screen.getByLabelText("Title")).toHaveValue("Certificate of Achievement");
  });

  it("adds a second signature from the branding tab", async () => {
    const user = userEvent.setup();
    renderScreen();
    await openTab(user, "Branding");

    await user.click(screen.getByTestId("add-second-signature"));
    const names = screen.getAllByLabelText("Signatory name");
    await user.type(names[1]!, "Ustadha Maryam");

    await waitFor(() => expect(screen.getAllByText("Ustadha Maryam").length).toBeGreaterThanOrEqual(2));
  });

  it("builds a batch from ticked students and typed names", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(within(await screen.findByTestId("issue-mode")).getByRole("button", { name: "Whole class" }));
    const list = await screen.findByTestId("student-checklist");
    await user.click(await within(list).findByRole("checkbox", { name: /Yusuf Ahmad/ }));
    await user.click(within(list).getByRole("checkbox", { name: /Omar Khaled/ }));
    // A duplicate of a ticked student is printed once.
    await user.type(screen.getByLabelText(/Other names/), "Layla Nour{enter}Yusuf Ahmad");

    expect(screen.getByTestId("bulk-count")).toHaveTextContent("3 certificates");
    expect(screen.getByTestId("cert-bulk-download")).toHaveTextContent("Generate 3 certificates");
    expect(screen.queryByTestId("cert-download")).not.toBeInTheDocument();
  });

  it("hides the save button and disables fields without the manage capability", async () => {
    canMock.mockImplementation((p: string) => p === "certificate.read");
    const user = userEvent.setup();
    renderScreen();
    await openTab(user, "Wording");

    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.queryByTestId("cert-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("restore-wording")).not.toBeInTheDocument();
    // Download stays available for read-only users.
    expect(screen.getByTestId("cert-download")).toBeInTheDocument();
  });

  it("falls back to free-typed names without student access", async () => {
    canMock.mockImplementation((p: string) => p.startsWith("certificate."));
    const user = userEvent.setup();
    renderScreen();

    await user.type(await screen.findByLabelText("Student / recipient name"), "Mar");
    await user.click(within(screen.getByTestId("issue-mode")).getByRole("button", { name: "Whole class" }));

    expect(screen.getByText(/can't browse the student list/)).toBeInTheDocument();
    expect(api.listStudents).not.toHaveBeenCalled();
  });

  it("shows a no-access message when the user lacks certificate.read", async () => {
    canMock.mockReturnValue(false);
    renderScreen();
    expect(await screen.findByText("You do not have access to certificates.")).toBeInTheDocument();
    expect(api.listCertificateTemplates).not.toHaveBeenCalled();
  });

  it("renders the academy name and title inside the certificate", async () => {
    vi.mocked(api.listCertificateTemplates).mockResolvedValue({
      templates: [template(1, { titleEn: "Royal Title" }), template(2, { titleEn: "Mosaic Title" })],
    });
    renderScreen();

    expect(await screen.findByText("Live preview")).toBeInTheDocument();
    // Gallery thumbnail + preview + capture node.
    expect(screen.getAllByText("Royal Title").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Noor Academy").length).toBeGreaterThan(0);
  });
});
