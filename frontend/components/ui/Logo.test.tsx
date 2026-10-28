import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Logo } from "./Logo";

let images: HTMLImageElement[];

beforeEach(() => {
  images = [];
  vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "pk_test");
  // Avatar detects failures through a separate Image, rather than the rendered img.
  vi.stubGlobal("Image", vi.fn(function () {
    const image = document.createElement("img");
    images.push(image);
    return image;
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Logo", () => {
  it("shows initials without requesting an image when the token is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "");
    const { container } = render(<Logo name="Apple" ticker="AAPL" />);

    expect(screen.getByText("AP")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(images).toHaveLength(0);
  });

  it("shows initials without requesting an image when the ticker is missing", () => {
    const { container } = render(<Logo name="Apple" />);

    expect(screen.getByText("AP")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(images).toHaveLength(0);
  });

  it.each([
    [" azn.l ", "AZN.L"],
    [" brk/b ", "BRK%2FB"],
  ])("normalizes and encodes ticker %s in this app's own logo URL", (ticker, encoded) => {
    const { container } = render(<Logo name="Company" ticker={ticker} size={32} />);

    expect(container.querySelector("img")).toHaveAttribute("src", `/api/logo/${encoded}?size=64`);
  });

  it("never puts the token or Logo.dev in the page", () => {
    const { container } = render(<Logo name="Apple" ticker="AAPL" />);
    const src = container.querySelector("img")?.getAttribute("src") ?? "";

    expect(src).not.toContain("pk_test");
    expect(src).not.toContain("logo.dev");
  });

  it("replaces an unavailable image with initials", () => {
    const { container } = render(<Logo name="Apple" ticker="AAPL" />);
    expect(container.querySelector("img")).not.toBeNull();
    expect(images).toHaveLength(1);

    fireEvent.error(images[0]);

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("AP")).toBeInTheDocument();
  });
});
