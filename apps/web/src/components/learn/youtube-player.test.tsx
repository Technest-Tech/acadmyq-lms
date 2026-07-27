import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { YoutubePlayer } from "@/components/learn/youtube-player";
import enMessages from "../../../messages/en.json";

/**
 * The player's contract is "the video, none of YouTube's chrome". These cover the two halves of
 * that: the player vars that switch YouTube's own UI off, and the two independent guards that keep
 * the mouse off whatever the vars can't remove.
 */

const L = enMessages.learn.player;

interface FakePlayerOptions {
  videoId: string;
  host?: string;
  playerVars?: Record<string, number | string>;
  events?: {
    onReady?: (e: { target: unknown }) => void;
    onStateChange?: (e: { data: number; target: unknown }) => void;
  };
}

let lastOptions: FakePlayerOptions | null = null;
let iframe: HTMLIFrameElement;
let fire: { ready: () => void; state: (data: number) => void };

/** A stand-in for the IFrame API — the real one needs a network fetch and a live YouTube frame. */
function installFakeApi(duration = 600) {
  iframe = document.createElement("iframe");
  const player = {
    playVideo: vi.fn(),
    pauseVideo: vi.fn(),
    seekTo: vi.fn(),
    getCurrentTime: () => 0,
    getDuration: () => duration,
    setPlaybackRate: vi.fn(),
    mute: vi.fn(),
    unMute: vi.fn(),
    isMuted: () => false,
    getIframe: () => iframe,
    destroy: vi.fn(),
  };

  // A function expression, not an arrow: the component calls `new YT.Player(...)`, and an arrow
  // cannot be constructed. Returning an object from a constructor overrides `this`.
  window.YT = {
    Player: vi.fn(function (_el: unknown, options: FakePlayerOptions) {
      lastOptions = options;
      fire = {
        ready: () => options.events?.onReady?.({ target: player }),
        state: (data: number) =>
          options.events?.onStateChange?.({ data, target: player }),
      };
      return player;
    }) as unknown as NonNullable<typeof window.YT>["Player"],
    PlayerState: { PLAYING: 1, PAUSED: 2, ENDED: 0 },
  };

  return player;
}

function renderPlayer(
  props: Partial<React.ComponentProps<typeof YoutubePlayer>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <YoutubePlayer videoId="kWhXAtj2M6s" title="Lesson one" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("YoutubePlayer", () => {
  beforeEach(() => {
    lastOptions = null;
    // The API promise is cached on window for the document's lifetime — reset it per test so each
    // render goes through the load path again.
    window.__ytApiPromise = undefined;
    window.onYouTubeIframeAPIReady = undefined;
  });

  it("shows a poster and loads nothing from YouTube until play is pressed", () => {
    installFakeApi();
    renderPlayer();

    expect(screen.getByAltText("Lesson one")).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/kWhXAtj2M6s/hqdefault.jpg",
    );
    expect(window.YT?.Player).not.toHaveBeenCalled();
  });

  it("builds the player with every piece of YouTube's own UI switched off", async () => {
    installFakeApi();
    renderPlayer();

    await userEvent.click(screen.getByRole("button", { name: L.play }));
    await waitFor(() => expect(lastOptions).not.toBeNull());

    expect(lastOptions?.host).toBe("https://www.youtube-nocookie.com");
    expect(lastOptions?.playerVars).toMatchObject({
      controls: 0, // no YouTube control bar (and so no logo in it)
      rel: 0, // no related-video end screen
      modestbranding: 1,
      iv_load_policy: 3, // no annotation cards
      disablekb: 1, // YouTube's shortcuts off; ours replace them
      fs: 0, // YouTube's fullscreen button off; ours replaces it
    });
  });

  it("makes the iframe itself refuse the mouse once ready", async () => {
    installFakeApi();
    renderPlayer();

    await userEvent.click(screen.getByRole("button", { name: L.play }));
    await waitFor(() => expect(fire).toBeDefined());
    fire.ready();

    await waitFor(() => expect(iframe.style.pointerEvents).toBe("none"));
  });

  it("resumes from the saved position, but not from the last few seconds", async () => {
    const player = installFakeApi(600);
    renderPlayer({ startAt: 120 });

    await userEvent.click(screen.getByRole("button", { name: L.play }));
    await waitFor(() => expect(fire).toBeDefined());
    fire.ready();

    expect(player.seekTo).toHaveBeenCalledWith(120, true);
    expect(player.playVideo).toHaveBeenCalled();
  });

  it("does not resume into the outro", async () => {
    const player = installFakeApi(600);
    renderPlayer({ startAt: 595 });

    await userEvent.click(screen.getByRole("button", { name: L.play }));
    await waitFor(() => expect(fire).toBeDefined());
    fire.ready();

    expect(player.seekTo).not.toHaveBeenCalled();
  });

  it("reports the lesson finished so the course can advance", async () => {
    installFakeApi();
    const onEnded = vi.fn();
    renderPlayer({ onEnded });

    await userEvent.click(screen.getByRole("button", { name: L.play }));
    await waitFor(() => expect(fire).toBeDefined());
    fire.ready();
    fire.state(0); // YT.PlayerState.ENDED

    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("renders our own controls, not YouTube's", async () => {
    installFakeApi();
    renderPlayer();

    await userEvent.click(screen.getByRole("button", { name: L.play }));
    await waitFor(() => expect(fire).toBeDefined());
    fire.ready();
    fire.state(1); // YT.PlayerState.PLAYING — the button flips to Pause

    await waitFor(() =>
      expect(screen.getByRole("slider", { name: L.seek })).toBeVisible(),
    );
    expect(screen.getByRole("button", { name: L.pause })).toBeVisible();
    expect(screen.getByRole("button", { name: L.speed })).toBeVisible();
    expect(screen.getByRole("button", { name: L.fullscreen })).toBeVisible();
  });
});
