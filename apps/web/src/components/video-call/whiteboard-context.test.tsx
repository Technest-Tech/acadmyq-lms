import { act, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { CallControlContext } from "./call-control-context";
import { WhiteboardProvider, useWhiteboard, type BoardApi } from "./whiteboard-context";
import { decodeMessage, encodeMessage, type WhiteboardMessage } from "./whiteboard-protocol";

// A controllable LiveKit data channel: capture the provider's onMessage so the test can inject remote
// packets, and spy on send. useConnectionState is forced Connected so the late-join effect runs.
const dc = vi.hoisted(() => ({
  onMessage: null as null | ((m: { payload: Uint8Array; from?: { identity?: string } }) => void),
  send: vi.fn<(payload: Uint8Array, opts: unknown) => Promise<void>>(),
}));
vi.mock("@livekit/components-react", () => ({
  useConnectionState: () => "connected",
  useDataChannel: (_topic: string, onMessage: (m: { payload: Uint8Array }) => void) => {
    dc.onMessage = onMessage as typeof dc.onMessage;
    return { send: dc.send, isSending: false };
  },
}));
vi.mock("livekit-client", () => ({ ConnectionState: { Connected: "connected" } }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

/** Decode every message the provider has sent (newest last). */
function sentMessages(): WhiteboardMessage[] {
  return dc.send.mock.calls.map((c) => decodeMessage(c[0] as Uint8Array)).filter((m): m is WhiteboardMessage => !!m);
}
function inject(msg: WhiteboardMessage, from = "host-1") {
  act(() => dc.onMessage?.({ payload: encodeMessage(msg), from: { identity: from } }));
}

function Harness() {
  const wb = useWhiteboard();
  return (
    <div>
      <span data-testid="open">{String(wb.open)}</span>
      <span data-testid="allowDraw">{String(wb.allowDraw)}</span>
      <span data-testid="canDraw">{String(wb.canDraw)}</span>
      <span data-testid="screenBaking">{String(wb.screenBaking)}</span>
      <button onClick={wb.openBoard}>open</button>
      <button onClick={wb.closeBoard}>close</button>
      <button onClick={() => wb.setAllowDraw(true)}>grant</button>
      <button onClick={wb.clearBoard}>clear</button>
      <button onClick={() => wb.setScreenBaking(true)}>bake-on</button>
      <button onClick={() => wb.setScreenBaking(false)}>bake-off</button>
    </div>
  );
}

function renderWb(canManage: boolean) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CallControlContext.Provider value={{ canManage, roomId: "r1", manageToken: null }}>
        <WhiteboardProvider>
          <Harness />
        </WhiteboardProvider>
      </CallControlContext.Provider>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  dc.onMessage = null;
  dc.send.mockReset().mockResolvedValue(undefined);
});

describe("WhiteboardProvider", () => {
  it("host open/close broadcasts board state to everyone", () => {
    renderWb(true);
    expect(screen.getByTestId("open").textContent).toBe("false");

    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId("open").textContent).toBe("true");
    expect(sentMessages().at(-1)).toEqual({ t: "state", open: true, allowDraw: false });

    fireEvent.click(screen.getByText("close"));
    expect(screen.getByTestId("open").textContent).toBe("false");
    expect(sentMessages().at(-1)).toEqual({ t: "state", open: false, allowDraw: false });
  });

  it("host is always allowed to draw; granting flips students to drawable", () => {
    renderWb(true);
    expect(screen.getByTestId("canDraw").textContent).toBe("true"); // host
    fireEvent.click(screen.getByText("grant"));
    expect(screen.getByTestId("allowDraw").textContent).toBe("true");
    expect(sentMessages().at(-1)).toEqual({ t: "state", open: false, allowDraw: true });
  });

  it("a non-host is read-only until the host grants drawing, via the state signal", () => {
    renderWb(false);
    expect(screen.getByTestId("canDraw").textContent).toBe("false");

    inject({ t: "state", open: true, allowDraw: false });
    expect(screen.getByTestId("open").textContent).toBe("true");
    expect(screen.getByTestId("canDraw").textContent).toBe("false"); // still read-only

    inject({ t: "state", open: true, allowDraw: true });
    expect(screen.getByTestId("canDraw").textContent).toBe("true"); // granted
  });

  it("a non-host asks the host for the current board on connect (late join)", () => {
    renderWb(false);
    expect(sentMessages().some((m) => m.t === "sync-request")).toBe(true);
  });

  it("the host answers a sync-request with the full board, targeted at the requester", () => {
    renderWb(true);
    fireEvent.click(screen.getByText("open"));
    dc.send.mockClear();

    inject({ t: "sync-request" }, "guest-7");

    const [payload, opts] = dc.send.mock.calls.at(-1)!;
    expect(decodeMessage(payload as Uint8Array)).toEqual({ t: "sync-full", elements: [], open: true, allowDraw: false });
    expect((opts as { destinationIdentities?: string[] }).destinationIdentities).toEqual(["guest-7"]);
  });

  it("a non-host never answers a sync-request (no reply storms)", () => {
    renderWb(false);
    dc.send.mockClear();
    inject({ t: "sync-request" }, "guest-9");
    expect(sentMessages().some((m) => m.t === "sync-full")).toBe(false);
  });

  it("a desktop host announces baking state once per change and reflects it locally", () => {
    renderWb(true);
    expect(screen.getByTestId("screenBaking").textContent).toBe("false");

    fireEvent.click(screen.getByText("bake-on"));
    expect(screen.getByTestId("screenBaking").textContent).toBe("true");
    expect(sentMessages().at(-1)).toEqual({ t: "sa-baking", baking: true });

    // Idempotent: re-asserting the same state sends nothing new.
    dc.send.mockClear();
    fireEvent.click(screen.getByText("bake-on"));
    expect(sentMessages().some((m) => m.t === "sa-baking")).toBe(false);

    fireEvent.click(screen.getByText("bake-off"));
    expect(screen.getByTestId("screenBaking").textContent).toBe("false");
    expect(sentMessages().at(-1)).toEqual({ t: "sa-baking", baking: false });
  });

  it("a viewer adopts the sharer's baking state from an sa-baking packet", () => {
    renderWb(false);
    expect(screen.getByTestId("screenBaking").textContent).toBe("false");
    inject({ t: "sa-baking", baking: true });
    expect(screen.getByTestId("screenBaking").textContent).toBe("true");
    inject({ t: "sa-baking", baking: false });
    expect(screen.getByTestId("screenBaking").textContent).toBe("false");
  });

  it("the host replays the baking flag to a late joiner's sync-request", () => {
    renderWb(true);
    fireEvent.click(screen.getByText("bake-on"));
    dc.send.mockClear();

    inject({ t: "sync-request" }, "guest-12");
    const replies = dc.send.mock.calls
      .map((c) => ({ msg: decodeMessage(c[0] as Uint8Array), opts: c[1] as { destinationIdentities?: string[] } }))
      .filter((r) => r.msg?.t === "sa-baking");
    expect(replies).toHaveLength(1);
    expect(replies[0]!.msg).toEqual({ t: "sa-baking", baking: true });
    expect(replies[0]!.opts.destinationIdentities).toEqual(["guest-12"]);
  });

  it("reconciles a remote scene into the live canvas via the registered API", () => {
    const updateScene = vi.fn();
    function ApiBinder() {
      const { registerApi } = useWhiteboard();
      const api: BoardApi = {
        updateScene,
        getSceneElementsIncludingDeleted: () => [],
        addFiles: vi.fn(),
        getFiles: () => ({}),
        scrollToContent: vi.fn(),
      };
      // Register once on mount.
      if (!updateScene.mock.calls.length) registerApi(api);
      return null;
    }
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CallControlContext.Provider value={{ canManage: false, roomId: "r1", manageToken: null }}>
          <WhiteboardProvider>
            <ApiBinder />
          </WhiteboardProvider>
        </CallControlContext.Provider>
      </NextIntlClientProvider>,
    );

    inject({ t: "scene", elements: [{ id: "a", version: 3, versionNonce: 5 }] });
    expect(updateScene).toHaveBeenCalledWith({ elements: [{ id: "a", version: 3, versionNonce: 5 }] });
  });

  it("broadcasts only the CHANGED element (delta), not the whole scene", () => {
    vi.useFakeTimers();
    let els: { id: string; version: number; versionNonce: number }[] = [
      { id: "a", version: 1, versionNonce: 1 },
      { id: "b", version: 1, versionNonce: 2 },
    ];
    let notify = () => {};
    let bound = false;
    function Binder() {
      const { registerApi, notifyLocalChange } = useWhiteboard();
      notify = notifyLocalChange;
      if (!bound) {
        bound = true;
        registerApi({
          updateScene: vi.fn(),
          getSceneElementsIncludingDeleted: () => els,
          addFiles: vi.fn(),
          getFiles: () => ({}),
          scrollToContent: vi.fn(),
        });
      }
      return null;
    }
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <CallControlContext.Provider value={{ canManage: true, roomId: "r1", manageToken: null }}>
          <WhiteboardProvider>
            <Binder />
          </WhiteboardProvider>
        </CallControlContext.Provider>
      </NextIntlClientProvider>,
    );

    // First flush: both elements are new → both go out.
    act(() => {
      notify();
      vi.advanceTimersByTime(200);
    });
    let scenes = sentMessages().filter((m) => m.t === "scene");
    expect(scenes.at(-1)).toEqual({
      t: "scene",
      elements: [
        { id: "a", version: 1, versionNonce: 1 },
        { id: "b", version: 1, versionNonce: 2 },
      ],
    });

    // Touch only b → only b is broadcast.
    els = [
      { id: "a", version: 1, versionNonce: 1 },
      { id: "b", version: 2, versionNonce: 2 },
    ];
    act(() => {
      notify();
      vi.advanceTimersByTime(200);
    });
    scenes = sentMessages().filter((m) => m.t === "scene");
    expect(scenes.at(-1)).toEqual({ t: "scene", elements: [{ id: "b", version: 2, versionNonce: 2 }] });

    vi.useRealTimers();
  });
});
