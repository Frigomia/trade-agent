import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// @testing-library/dom's waitFor only auto-advances fake timers when it detects a global `jest`
// (it checks `typeof jest !== "undefined"` before looking at whether `setTimeout` is mocked).
// Vitest doesn't define that global, so without this shim `waitFor` silently falls back to
// real-timer polling while `vi.useFakeTimers()` has already replaced `setTimeout` — every
// `waitFor` then hangs until the outer test timeout. See testing-library/dom's helpers.js
// (`jestFakeTimersAreEnabled`) for the exact check this satisfies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).jest = vi;
