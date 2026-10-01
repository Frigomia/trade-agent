import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AskAboutThis } from "./AskAboutThis";

describe("AskAboutThis", () => {
  it("links to chat with the question typed in", () => {
    render(<AskAboutThis ticker="KO" action="WATCH" />);

    const link = screen.getByRole("link", { name: /ask about this/i });
    expect(link).toHaveAttribute("href", `/chat?ask=${encodeURIComponent("Why WATCH on KO?")}`);
  });
});
