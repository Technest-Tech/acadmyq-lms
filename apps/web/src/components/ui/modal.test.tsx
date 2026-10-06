import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Modal } from "./modal";

/** Input state lives BESIDE the Modal, and onClose is a fresh inline arrow on every render. */
function ReportForm() {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(true);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Report">
      <textarea
        aria-label="report"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </Modal>
  );
}

describe("Modal", () => {
  // jsdom has no layout, so offsetParent is always null and the Modal would see nothing as visible
  // — the header X included. Give elements a parent so the X counts, as it does in a browser.
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", {
      configurable: true,
      get() {
        return (this as HTMLElement).parentNode;
      },
    });
  });
  afterAll(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, "offsetParent", original);
  });

  it("keeps focus in the field while the parent re-renders with a new onClose", async () => {
    render(<ReportForm />);
    const field = screen.getByLabelText("report");
    await userEvent.click(field);
    await userEvent.type(field, "Student cancelled");

    expect(field).toHaveValue("Student cancelled");
    expect(field).toHaveFocus();
  });

  it("still closes on Escape with the latest onClose", async () => {
    render(<ReportForm />);
    await userEvent.type(screen.getByLabelText("report"), "x");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
