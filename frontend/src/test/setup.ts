/**
 * @file Vitest isolation boundary for DOM/component tests. Install jest-dom matchers and,
 * after every test, unmount rendered views, clear synthetic browser storage and restore
 * stubbed globals so authentication, network and UI fixtures cannot contaminate another case.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});
