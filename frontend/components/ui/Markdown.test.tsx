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

  describe("link destinations", () => {
    it("shows the destination host after the link text", () => {
      render(<Markdown>{"[the report](https://www.Example.com/a/b?x=1)"}</Markdown>);
      expect(screen.getByRole("link", { name: "the report" })).toHaveAttribute(
        "href",
        "https://www.Example.com/a/b?x=1",
      );
      expect(screen.getByText("(www.example.com)")).toBeInTheDocument();
    });

    it("does not repeat the host when the text already is the host or URL", () => {
      const { container } = render(
        <Markdown>{"[example.com](https://example.com) and [https://news.example.org/story](https://news.example.org/story)"}</Markdown>,
      );
      expect(container.textContent).not.toContain("(");
    });

    it("shows the address for mailto links", () => {
      render(<Markdown>{"[contact us](mailto:ir@example.com)"}</Markdown>);
      expect(screen.getByText("(ir@example.com)")).toBeInTheDocument();
    });

    it("keeps javascript: links inert and unannotated", () => {
      const { container } = render(<Markdown>{"[click](javascript:alert(1))"}</Markdown>);
      expect(container.querySelector("a")?.getAttribute("href") ?? "").not.toContain("javascript");
      expect(container.textContent).not.toContain("(");
    });
  });
});
