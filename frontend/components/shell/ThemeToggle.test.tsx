import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("flips data-theme on click and persists the choice", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("button", { name: /switch theme/i }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("still flips the visible theme when localStorage throws", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };

    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /switch theme/i }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");

    Storage.prototype.setItem = original;
  });
});
