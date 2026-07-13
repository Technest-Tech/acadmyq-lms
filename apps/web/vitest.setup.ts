import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements no layout, so it ships no scrollIntoView — components that scroll a
// section into view would throw. A no-op keeps those code paths testable.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom ships no matchMedia either. ThemeProvider asks it whether the OS prefers dark; without a
// stub every render inside the app shell throws. Reports "light", which is the light-theme default
// the assertions already expect — a test that cares about dark mode should stub this itself.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  cleanup();
  // Reset locale cookie between tests.
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});
