import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { LessonReportManager } from "./lesson-report-manager";

// Settings → Lesson report: the academy's form (its report fields) and the WhatsApp message they
// fill. A ready-made template replaces both after a confirm; the message is built by tapping
// placeholders and previewed server-side.

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getLessonReport: vi.fn(),
  previewLessonReport: vi.fn(),
  saveLessonReportMessage: vi.fn(),
  applyLessonReportPreset: vi.fn(),
  addReportField: vi.fn(),
  updateReportField: vi.fn(),
}));

import * as api from "@/lib/api";

const score: api.ReportField = {
  id: "f1",
  academy_id: "academy-1",
  key: "hifz_score",
  label_ar: "درجة الحفظ",
  label_en: "Memorisation",
  field_type: "NUMBER",
  options: null,
  sort_order: 1,
  is_required: false,
  is_active: true,
  section: "التقييم",
  max_value: 10,
};

const settings = (over: Partial<api.LessonReportSettings> = {}): api.LessonReportSettings => ({
  fields: [],
  message: "",
  facts: ["academy", "teacher", "student", "day", "date", "attendance", "duration"],
  presets: { quran: { name_ar: "حلقة قرآن", name_en: "Quran circle" } },
  ...over,
});

function renderManager() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("ACADEMY_OWNER"))}>
        <LessonReportManager />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("LessonReportManager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(api.previewLessonReport).mockResolvedValue({ text: "" });
    vi.mocked(api.saveLessonReportMessage).mockResolvedValue({ ok: true });
  });

  it("starts from the Quran circle template only after a confirm", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getLessonReport).mockResolvedValue(settings());
    vi.mocked(api.applyLessonReportPreset).mockResolvedValue(
      settings({ fields: [score], message: "✅️ درجة الحفظ: {hifz_score}" }),
    );
    renderManager();

    await user.click(await screen.findByTestId("preset-quran"));
    expect(api.applyLessonReportPreset).not.toHaveBeenCalled();
    await user.click(screen.getByTestId("confirm-preset"));

    await waitFor(() => expect(api.applyLessonReportPreset).toHaveBeenCalledWith("quran"));
    expect(await screen.findByTestId("field-hifz_score")).toHaveTextContent("out of 10");
    expect(screen.getByTestId("lesson-report-message")).toHaveValue("✅️ درجة الحفظ: {hifz_score}");
  });

  it("builds the message by tapping placeholders, previews it, and saves it", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getLessonReport).mockResolvedValue(settings({ fields: [score] }));
    vi.mocked(api.previewLessonReport).mockResolvedValue({ text: "Student: Manar" });
    renderManager();

    const box = await screen.findByTestId("lesson-report-message");
    await user.click(box);
    await user.click(screen.getByRole("button", { name: "Student" }));
    await user.click(screen.getByRole("button", { name: "Memorisation" }));
    expect(box).toHaveValue("{student}{hifz_score}");

    await waitFor(() => expect(screen.getByTestId("lesson-report-preview")).toHaveTextContent("Student: Manar"));

    await user.click(screen.getByTestId("save-message"));
    await waitFor(() => expect(api.saveLessonReportMessage).toHaveBeenCalledWith("{student}{hifz_score}"));
  });

  it("adds a score field with its out-of and section", async () => {
    const user = userEvent.setup();
    vi.mocked(api.getLessonReport).mockResolvedValue(settings());
    vi.mocked(api.addReportField).mockResolvedValue({ reportFieldId: "new" });
    renderManager();

    await user.click(await screen.findByTestId("add-field"));
    await user.type(screen.getByTestId("field-label-ar"), "درجة السلوك");
    await user.type(screen.getByLabelText("Name (English, optional)"), "Behaviour");
    await user.type(screen.getByLabelText("Section (optional)"), "التقييم");
    await user.click(screen.getByTestId("save-field"));

    await waitFor(() =>
      expect(api.addReportField).toHaveBeenCalledWith("academy-1", {
        key: "behaviour",
        label_ar: "درجة السلوك",
        label_en: "Behaviour",
        field_type: "NUMBER",
        max_value: 10,
        options: null,
        section: "التقييم",
        is_required: false,
        sort_order: 1,
      }),
    );
  });
});
