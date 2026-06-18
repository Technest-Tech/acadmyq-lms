import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportEditor } from "./report-editor";

describe("ReportEditor", () => {
  it("renders the initial value into the editable area on mount", () => {
    // Regression: reopening the editor (e.g. via the Edit toggle) must show the
    // existing report text, not an empty box. The editable div is populated by an
    // effect, so a fresh mount with a non-empty value must still write it through.
    render(
      <ReportEditor value="<p>Hello world</p>" onChange={() => {}} />,
    );

    const editable = screen.getByTestId("report-text");
    expect(editable).toHaveTextContent("Hello world");
  });

  it("shows the placeholder when mounted with an empty value", () => {
    render(
      <ReportEditor value="" onChange={() => {}} placeholder="Write notes…" />,
    );

    expect(screen.getByText("Write notes…")).toBeInTheDocument();
    expect(screen.getByTestId("report-text")).toHaveTextContent("");
  });
});
