import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enMessages from "../../../messages/en.json";
import { MonitorFrame } from "./monitor-frame";

function renderFrame() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <MonitorFrame />
    </NextIntlClientProvider>,
  );
}

describe("MonitorFrame (supervisor observation console)", () => {
  it("shows the ethical observation banner (hidden + logged)", () => {
    renderFrame();
    const frame = screen.getByTestId("monitor-frame");
    expect(frame).toBeInTheDocument();
    expect(frame).toHaveAttribute("role", "status");
    expect(screen.getByText(enMessages.videoCall.monitorBannerTitle)).toBeInTheDocument();
    // The ethics line names that the watcher is hidden + the session is logged.
    expect(screen.getByText(enMessages.videoCall.monitorBannerNote)).toBeInTheDocument();
  });
});
