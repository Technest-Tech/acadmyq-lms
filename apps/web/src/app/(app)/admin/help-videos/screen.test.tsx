import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetHelpVideos } from "@/components/help/help-data";
import { ToastProvider } from "@/components/ui/toast";
import { videoSlots } from "@/content/help/resolve";
import { HELP_TOPICS } from "@/content/help/topics";
import { makeSession, withAuth } from "@/test/auth";
import { HelpVideosScreen } from "./screen";

// Super Admin → help videos: every slot the help can play a video in, and attaching one.

const getHelpVideos = vi.fn();
const setHelpVideoLink = vi.fn();
const removeHelpVideo = vi.fn();
const uploadHelpVideo = vi.fn();
vi.mock("@/lib/help-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/help-api")>()),
  getHelpVideos: (...a: unknown[]) => getHelpVideos(...a),
  setHelpVideoLink: (...a: unknown[]) => setHelpVideoLink(...a),
  removeHelpVideo: (...a: unknown[]) => removeHelpVideo(...a),
  uploadHelpVideo: (...a: unknown[]) => uploadHelpVideo(...a),
}));

const video = (slot: string) => ({
  slot,
  source: "LINK" as const,
  url: "https://youtu.be/dQw4w9WgXcQ",
  filename: null,
  sizeBytes: null,
  updatedAt: "2026-11-15T10:00:00Z",
});

function renderScreen(permissions = ["platform.manage"]) {
  return render(
    withAuth(
      makeSession("SUPER_ADMIN", { permissions }),
      <ToastProvider>
        <HelpVideosScreen />
      </ToastProvider>,
    ),
  );
}

const row = (slot: string) => document.querySelector<HTMLElement>(`[data-slot-row="${slot}"]`)!;

beforeEach(() => {
  forgetHelpVideos();
  getHelpVideos.mockReset().mockResolvedValue({ videos: [] });
  setHelpVideoLink.mockReset().mockResolvedValue({ ok: true });
  removeHelpVideo.mockReset().mockResolvedValue({ ok: true });
  uploadHelpVideo.mockReset().mockResolvedValue(undefined);
});

describe("HelpVideosScreen", () => {
  it("lists every slot of the help, all still to record", async () => {
    renderScreen();

    await waitFor(() => expect(row("students")).not.toBeNull());
    expect(document.querySelectorAll("[data-slot-row]")).toHaveLength(videoSlots(HELP_TOPICS).length);
    expect(within(row("students")).getByText("جولة في الصفحة")).toBeInTheDocument();
    expect(within(row("students.add")).getByText("كيف أضيف طالبًا جديدًا؟")).toBeInTheDocument();
    expect(within(row("students.add")).getByText("لم يُسجَّل بعد")).toBeInTheDocument();
  });

  it("attaches a link to a slot and reads the list again", async () => {
    renderScreen();
    await waitFor(() => expect(row("students.add")).not.toBeNull());

    getHelpVideos.mockResolvedValue({ videos: [video("students.add")] });
    await userEvent.click(within(row("students.add")).getByRole("button", { name: "رابط" }));
    await userEvent.type(within(row("students.add")).getByLabelText("رابط الفيديو"), "https://youtu.be/dQw4w9WgXcQ");
    await userEvent.click(within(row("students.add")).getByRole("button", { name: "حفظ الرابط" }));

    await waitFor(() => expect(setHelpVideoLink).toHaveBeenCalledWith("students.add", "https://youtu.be/dQw4w9WgXcQ"));
    // The row now reads as recorded, with preview and replace in place of the first upload.
    expect(await within(row("students.add")).findByRole("button", { name: "معاينة" })).toBeInTheDocument();
    expect(within(row("students.add")).getByRole("button", { name: "استبدال" })).toBeInTheDocument();
  });

  it("refuses something that is not a link before asking the server", async () => {
    renderScreen();
    await waitFor(() => expect(row("students")).not.toBeNull());

    await userEvent.click(within(row("students")).getByRole("button", { name: "رابط" }));
    await userEvent.type(within(row("students")).getByLabelText("رابط الفيديو"), "youtube dot com");
    await userEvent.click(within(row("students")).getByRole("button", { name: "حفظ الرابط" }));

    expect(setHelpVideoLink).not.toHaveBeenCalled();
  });

  it("uploads a recording into the slot it was dropped on", async () => {
    renderScreen();
    await waitFor(() => expect(row("attendance.mark")).not.toBeNull());

    const file = new File(["bytes"], "mark.mp4", { type: "video/mp4" });
    await userEvent.upload(within(row("attendance.mark")).getByLabelText("رفع فيديو", { selector: "input" }), file);

    await waitFor(() => expect(uploadHelpVideo).toHaveBeenCalledTimes(1));
    expect(uploadHelpVideo.mock.calls[0]![0]).toBe("attendance.mark");
    expect(uploadHelpVideo.mock.calls[0]![1]).toBe(file);
  });

  it("removes a video only after a second, explicit press", async () => {
    getHelpVideos.mockResolvedValue({ videos: [video("students")] });
    renderScreen();
    await waitFor(() => expect(within(row("students")).getByRole("button", { name: "حذف الفيديو" })).toBeInTheDocument());

    await userEvent.click(within(row("students")).getByRole("button", { name: "حذف الفيديو" }));
    expect(removeHelpVideo).not.toHaveBeenCalled();

    await userEvent.click(within(row("students")).getByRole("button", { name: "تأكيد الحذف" }));
    await waitFor(() => expect(removeHelpVideo).toHaveBeenCalledWith("students"));
  });

  it("filters down to what is still to record", async () => {
    getHelpVideos.mockResolvedValue({ videos: [video("students")] });
    renderScreen();
    await waitFor(() => expect(within(row("students")).getByText("رابط", { selector: "span" })).toBeInTheDocument());

    await userEvent.click(screen.getByRole("tab", { name: "لم يُسجَّل" }));
    expect(row("students")).toBeNull();
    expect(row("students.add")).not.toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "جاهز" }));
    expect(document.querySelectorAll("[data-slot-row]")).toHaveLength(1);
  });

  it("is closed to anyone who does not manage the platform", () => {
    renderScreen(["academy.read"]);

    expect(screen.getByText("هذه الصفحة لمدير المنصة فقط.")).toBeInTheDocument();
    expect(document.querySelector("[data-slot-row]")).toBeNull();
  });
});
