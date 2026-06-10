import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportField } from "@/lib/api";
import * as api from "@/lib/api";
import enMessages from "../../../messages/en.json";
import { ReportFieldsEditor } from "./report-fields-editor";

// Keep ApiError real (the component does instanceof checks); mock the network functions.
vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  listReportFields: vi.fn(),
  addReportField: vi.fn(),
  updateReportField: vi.fn(),
  deleteReportField: vi.fn(),
}));

function field(overrides: Partial<ReportField> = {}): ReportField {
  return {
    id: "f1",
    academy_id: "a1",
    key: "surah_from",
    label_ar: "من سورة",
    label_en: "From surah",
    field_type: "TEXT",
    options: null,
    sort_order: 1,
    is_required: true,
    is_active: true,
    ...overrides,
  };
}

function renderEditor() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ReportFieldsEditor academyId="a1" />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listReportFields).mockResolvedValue({
    reportFields: [field()],
  });
  vi.mocked(api.addReportField).mockResolvedValue({ reportFieldId: "f2" });
  vi.mocked(api.updateReportField).mockResolvedValue({ ok: true });
  vi.mocked(api.deleteReportField).mockResolvedValue({ ok: true });
});

describe("ReportFieldsEditor (Sprint 3 §4.2)", () => {
  it("lists fields sorted by sort_order", async () => {
    vi.mocked(api.listReportFields).mockResolvedValue({
      reportFields: [field({ id: "f2", key: "notes", sort_order: 2 }), field()],
    });
    renderEditor();

    const items = await screen.findAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-field", "surah_from");
    expect(items[1]).toHaveAttribute("data-field", "notes");
  });

  // TC-3.9: add a field
  it("adds a new field via the API", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByText("From surah");

    await user.type(
      screen.getByLabelText(enMessages.academies.fields.key),
      "memorized",
    );
    await user.type(
      screen.getByLabelText(enMessages.academies.fields.labelAr),
      "محفوظ",
    );
    await user.type(
      screen.getByLabelText(enMessages.academies.fields.labelEn),
      "Memorized",
    );
    await user.click(
      screen.getByRole("button", { name: enMessages.academies.fields.add }),
    );

    await waitFor(() =>
      expect(api.addReportField).toHaveBeenCalledWith(
        "a1",
        expect.objectContaining({ key: "memorized", field_type: "TEXT" }),
      ),
    );
  });

  // TC-3.10 (UI): a SELECT with no options is blocked client-side before any call
  it("blocks a SELECT field with no options", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByText("From surah");

    await user.type(
      screen.getByLabelText(enMessages.academies.fields.key),
      "rating",
    );
    await user.type(
      screen.getByLabelText(enMessages.academies.fields.labelAr),
      "تقييم",
    );
    await user.type(
      screen.getByLabelText(enMessages.academies.fields.labelEn),
      "Rating",
    );
    await user.selectOptions(
      screen.getByLabelText(enMessages.academies.fields.type),
      "SELECT",
    );
    await user.click(
      screen.getByRole("button", { name: enMessages.academies.fields.add }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      enMessages.academies.fields.selectNeedsOptions,
    );
    expect(api.addReportField).not.toHaveBeenCalled();
  });

  // TC-3.13: deactivate toggles is_active via PATCH
  it("deactivates a field", async () => {
    const user = userEvent.setup();
    renderEditor();
    await screen.findByText("From surah");

    await user.click(
      screen.getByRole("button", {
        name: enMessages.academies.fields.deactivate,
      }),
    );
    expect(api.updateReportField).toHaveBeenCalledWith("a1", "f1", {
      is_active: false,
    });
  });

  // TC-3.14 (UI): a delete blocked by the server (422) shows the deactivate-instead notice
  it("surfaces the deactivate-only message when delete is blocked", async () => {
    vi.mocked(api.deleteReportField).mockRejectedValue(
      new api.ApiError(422, "blocked"),
    );
    const user = userEvent.setup();
    renderEditor();
    await screen.findByText("From surah");

    await user.click(
      screen.getByRole("button", { name: enMessages.academies.fields.delete }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      enMessages.academies.fields.deleteBlocked,
    );
  });
});
