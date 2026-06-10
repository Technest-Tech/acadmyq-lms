import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  // Reset locale cookie between tests.
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});
