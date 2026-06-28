import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { ChatButton } from "./chat-button";

const chatState = { unread: 0, isOpen: false, toggle: vi.fn() };

vi.mock("./chat-context", () => ({
  CHAT_MAX_LENGTH: 1000,
  useChatPanel: () => chatState,
}));

function renderButton() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ChatButton />
    </NextIntlClientProvider>,
  );
}

describe("ChatButton", () => {
  beforeEach(() => {
    chatState.unread = 0;
    chatState.isOpen = false;
    chatState.toggle.mockClear();
  });
  afterEach(() => vi.clearAllMocks());

  it("shows no badge when there are no unread messages", () => {
    renderButton();
    expect(screen.queryByText(/^\d/)).not.toBeInTheDocument();
  });

  it("shows the unread count as a badge", () => {
    chatState.unread = 3;
    renderButton();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("caps the badge at 9+", () => {
    chatState.unread = 25;
    renderButton();
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("toggles the panel on click", () => {
    renderButton();
    fireEvent.click(screen.getByRole("button"));
    expect(chatState.toggle).toHaveBeenCalled();
  });
});
