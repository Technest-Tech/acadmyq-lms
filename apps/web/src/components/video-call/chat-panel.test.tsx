import { fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { ChatPanel } from "./chat-panel";

// A controllable stand-in for the ChatProvider so the panel can render without a live room.
const chatState = {
  messages: [] as Array<{
    id: string;
    timestamp: number;
    message: string;
    from?: { identity?: string; name?: string; isLocal?: boolean; metadata?: string };
  }>,
  send: vi.fn(() => Promise.resolve()),
  isSending: false,
  connected: true,
  unread: 0,
  isOpen: true,
  open: vi.fn(),
  close: vi.fn(),
  toggle: vi.fn(),
};

vi.mock("./chat-context", () => ({
  CHAT_MAX_LENGTH: 1000,
  useChatPanel: () => chatState,
}));

// Other live participants — the direct-message targets the panel reads via useParticipants.
let mockParticipants: Array<{ identity: string; name?: string; isLocal?: boolean }> = [];
vi.mock("@livekit/components-react", () => ({
  useParticipants: () => mockParticipants,
}));

const c = enMessages.videoCall;

function renderPanel() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ChatPanel />
    </NextIntlClientProvider>,
  );
}

function resetState() {
  chatState.messages = [];
  chatState.isSending = false;
  chatState.connected = true;
  chatState.isOpen = true;
  chatState.send.mockClear();
  chatState.close.mockClear();
  mockParticipants = [
    { identity: "me", name: "Me", isLocal: true },
    { identity: "teacher", name: "Teacher Noor" },
  ];
}

describe("ChatPanel", () => {
  beforeEach(resetState);
  afterEach(() => vi.clearAllMocks());

  it("shows the empty state when there are no messages", () => {
    renderPanel();
    expect(screen.getByText(c.chatEmptyTitle)).toBeInTheDocument();
  });

  it("renders own messages as 'You' and remote host messages with a Host badge", () => {
    chatState.messages = [
      { id: "1", timestamp: 1_000, message: "hi all", from: { identity: "me", isLocal: true } },
      {
        id: "2",
        timestamp: 2_000,
        message: "welcome",
        from: { identity: "h", name: "Teacher", metadata: '{"role":"host"}' },
      },
    ];
    renderPanel();
    expect(screen.getByText("hi all")).toBeInTheDocument();
    expect(screen.getByText(c.chatYou)).toBeInTheDocument();
    expect(screen.getByText("Teacher")).toBeInTheDocument();
    expect(screen.getByText(c.chatHostBadge)).toBeInTheDocument();
  });

  it("sends a trimmed message on the send button and clears the composer", () => {
    renderPanel();
    const input = screen.getByLabelText(c.chatPlaceholder) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "  hello  " } });
    fireEvent.click(screen.getByRole("button", { name: c.send }));
    expect(chatState.send).toHaveBeenCalledWith("hello", null);
    expect(input.value).toBe("");
  });

  it("sends on Enter but inserts a newline on Shift+Enter", () => {
    renderPanel();
    const input = screen.getByLabelText(c.chatPlaceholder);
    fireEvent.change(input, { target: { value: "line" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(chatState.send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chatState.send).toHaveBeenCalledWith("line", null);
  });

  it("does not send an empty or whitespace-only message", () => {
    renderPanel();
    const input = screen.getByLabelText(c.chatPlaceholder);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chatState.send).not.toHaveBeenCalled();
  });

  it("disables the composer until connected", () => {
    chatState.connected = false;
    renderPanel();
    expect(screen.getByLabelText(c.chatPlaceholder)).toBeDisabled();
  });

  it("closes via the header close button", () => {
    renderPanel();
    const header = screen.getByRole("complementary", { name: c.chatTitle });
    const closeButtons = within(header).getAllByRole("button", { name: c.close });
    fireEvent.click(closeButtons[0]!);
    expect(chatState.close).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    renderPanel();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(chatState.close).toHaveBeenCalled();
  });

  it("defaults the recipient selector to Everyone and lists other participants", () => {
    renderPanel();
    const selector = screen.getByTestId("chat-recipient");
    expect(selector).toHaveTextContent(c.chatEveryone);
    fireEvent.click(selector);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Teacher Noor/ })).toBeInTheDocument();
  });

  it("sends a private direct message to the chosen recipient", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("chat-recipient"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Teacher Noor/ }));
    const input = screen.getByLabelText(c.chatPlaceholder);
    fireEvent.change(input, { target: { value: "psst" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(chatState.send).toHaveBeenCalledWith("psst", {
      identity: "teacher",
      name: "Teacher Noor",
    });
  });

  it("marks an incoming private message with a Private tag", () => {
    chatState.messages = [
      {
        id: "1",
        timestamp: 1_000,
        message: "for your eyes only",
        from: { identity: "teacher", name: "Teacher Noor" },
        attributes: { aq_private: "1" },
      } as never,
    ];
    renderPanel();
    expect(screen.getByText("for your eyes only")).toBeInTheDocument();
    expect(screen.getByText(c.chatPrivate)).toBeInTheDocument();
  });
});
