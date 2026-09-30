import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders headings, bold text and lists", () => {
    render(<Markdown>{"## What the news adds\n\n**Solid results.**\n\n- first\n- second"}</Markdown>);
    expect(screen.getByRole("heading", { name: "What the news adds" })).toBeInTheDocument();
    expect(screen.getByText("Solid results.").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("does not render raw HTML or images, and opens links safely", () => {
    const { container } = render(
      <Markdown>{"<script>alert(1)</script>\n\nhi <b>raw</b> ![x](https://e.com/p.png) [site](https://e.com)"}</Markdown>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    const link = screen.getByRole("link", { name: "site" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
