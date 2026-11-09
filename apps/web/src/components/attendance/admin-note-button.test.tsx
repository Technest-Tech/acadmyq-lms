import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { AdminNoteButton } from "./admin-note-button";

const t = enMessages.attendance.adminNote;

function renderButton(note: string | null, onSave = vi.fn(async () => {})) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AdminNoteButton note={note} onSave={onSave} />
    </NextIntlClientProvider>,
  );
  return onSave;
}

describe("AdminNoteButton — the office's note on a lesson (lingo)", () => {
  it("writes a note, trimmed, and says who may read it", async () => {
    const onSave = renderButton(null);
    expect(screen.getByTestId("admin-note")).toHaveTextContent(t.add);
    await userEvent.click(screen.getByTestId("admin-note"));
    expect(screen.getByText(t.hint)).toBeTruthy();
    await userEvent.type(screen.getByTestId("admin-note-text"), "  Came late  ");
    await userEvent.click(screen.getByTestId("admin-note-save"));
    expect(onSave).toHaveBeenCalledWith("Came late");
  });

  it("shows a saved note on the button and can remove it", async () => {
    const onSave = renderButton("Mother called");
    expect(screen.getByTestId("admin-note")).toHaveTextContent("Mother called");
    await userEvent.click(screen.getByTestId("admin-note"));
    await userEvent.click(screen.getByTestId("admin-note-clear"));
    expect(onSave).toHaveBeenCalledWith(null);
  });
});
