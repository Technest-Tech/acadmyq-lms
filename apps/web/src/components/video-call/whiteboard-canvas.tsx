"use client";

import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { BoardApi, BoardElement } from "./whiteboard-context";

/**
 * The raw Excalidraw surface, isolated in its own module so the panel can `next/dynamic` it with
 * `ssr:false` (Excalidraw touches `window`). Splitting it out also lets us import `MainMenu`
 * statically and render a CURATED menu — the stock menu ships GitHub/Discord/X social links and an
 * "Excalidraw+" promo, which don't belong in an academy classroom. Supplying our own <MainMenu>
 * replaces the default one entirely, so only the items below remain (no external links).
 */
export default function WhiteboardCanvas({
  registerApi,
  initialElements,
  canDraw,
  langCode,
  onChange,
}: {
  registerApi: (api: BoardApi | null) => void;
  initialElements: readonly BoardElement[];
  canDraw: boolean;
  langCode: string;
  onChange: () => void;
}) {
  return (
    <Excalidraw
      excalidrawAPI={(api) => registerApi(api as unknown as BoardApi)}
      initialData={{
        elements: initialElements as never,
        appState: { viewBackgroundColor: "#ffffff" },
        scrollToContent: true,
      }}
      viewModeEnabled={!canDraw}
      langCode={langCode}
      onChange={onChange}
      UIOptions={{
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          export: false,
          toggleTheme: false,
        },
      }}
    >
      <MainMenu>
        <MainMenu.DefaultItems.ChangeCanvasBackground />
        <MainMenu.DefaultItems.ToggleTheme />
      </MainMenu>
    </Excalidraw>
  );
}
