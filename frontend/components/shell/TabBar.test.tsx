import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TabBar } from "./TabBar";

describe("TabBar", () => {
  it("renders the four phone tabs regardless of role", () => {
    render(<TabBar role="user" />);
    expect(screen.getByRole("link", { name: /today/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /portfolio/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /chat/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /more/i })).toBeInTheDocument();
  });

  it("does not show the Admin tab for a non-admin role", () => {
    render(<TabBar role="user" />);
    expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("shows the Admin tab for an admin role", () => {
    render(<TabBar role="admin" />);
    expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });

  describe("--tabbar-h", () => {
    afterEach(() => vi.unstubAllGlobals());

    // Screens that pin something just above the tab bar (the chat composer) read this instead of
    // guessing the bar's height.
    it("publishes its measured height and follows resizes", () => {
      let notify: () => void = () => {};
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(cb: () => void) {
            notify = cb;
          }
          observe() {}
          disconnect() {}
        },
      );
      let height = 64;
      const spy = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => height);

      const { unmount } = render(<TabBar role="user" />);
      expect(document.documentElement.style.getPropertyValue("--tabbar-h")).toBe("64px");

      height = 72;
      notify();
      expect(document.documentElement.style.getPropertyValue("--tabbar-h")).toBe("72px");

      unmount();
      expect(document.documentElement.style.getPropertyValue("--tabbar-h")).toBe("");
      spy.mockRestore();
    });
  });
});
