import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import pkg from "./package.json";

// Inject the app version into the preload bundle so the bridge can report it without reaching
// into Electron's `app` (unavailable in a sandboxed preload).
const define = { __APP_VERSION__: JSON.stringify(pkg.version) };

// The main window loads the existing web client by URL. From Phase 2 we also build a LOCAL
// `renderer` — the transparent annotation overlay (a debug grid in the Phase 2 capture spike).
export default defineConfig({
  main: {
    define,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: resolve(__dirname, "src/main/index.ts") },
    },
  },
  preload: {
    define,
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
          "overlay-preload": resolve(__dirname, "src/preload/overlay-preload.ts"),
          "picker-preload": resolve(__dirname, "src/preload/picker-preload.ts"),
          "toolbar-preload": resolve(__dirname, "src/preload/toolbar-preload.ts"),
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    build: {
      rollupOptions: {
        input: {
          home: resolve(__dirname, "src/renderer/home/index.html"),
          overlay: resolve(__dirname, "src/renderer/overlay/index.html"),
          picker: resolve(__dirname, "src/renderer/picker/index.html"),
          toolbar: resolve(__dirname, "src/renderer/toolbar/index.html"),
        },
      },
    },
  },
});
