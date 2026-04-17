import "@testing-library/jest-dom/vitest";

// jsdom does not ship ResizeObserver; components that rely on it must not
// throw when rendered in tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
