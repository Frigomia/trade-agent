import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageBubble } from "./MessageBubble";

describe("MessageBubble", () => {
  it("shows a user message as plain text", () => {
    render(<MessageBubble message={{ role: "user", content: "Why TRIM on NVDA?" }} />);
    expect(screen.getByText("Why TRIM on NVDA?")).toBeInTheDocument();
  });

  it("renders a reply as markdown", () => {
    render(<MessageBubble message={{ role: "assistant", content: "You hold **8 shares**." }} />);
    expect(screen.getByText("8 shares").tagName).toBe("STRONG");
  });

  it("puts the web section in the From the web box", () => {
    render(
      <MessageBubble
        message={{ role: "assistant", content: "Numbers first.\n\n## From the web\n\nCoverage is positive." }}
      />,
    );
    expect(screen.getByText("Numbers first.")).toBeInTheDocument();
    expect(screen.getByText(/from the web · not part of the score/i)).toBeInTheDocument();
    expect(screen.getByText("Coverage is positive.")).toBeInTheDocument();
  });

  it("shows no web box for a reply without the section", () => {
    render(<MessageBubble message={{ role: "assistant", content: "Just an answer." }} />);
    expect(screen.queryByText(/not part of the score/i)).not.toBeInTheDocument();
  });

  it("does not render raw HTML from a reply", () => {
    const { container } = render(
      <MessageBubble message={{ role: "assistant", content: "hi <b>raw</b> <script>alert(1)</script>" }} />,
    );
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});
