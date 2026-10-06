import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClaudeRequired } from "./ClaudeRequired";

describe("ClaudeRequired", () => {
  it("chat, not connected", () => {
    render(<ClaudeRequired variant="chat" lock="connect" />);
    expect(screen.getByText("Connect Claude to use Chat")).toBeInTheDocument();
    expect(screen.getByText(/takes about five minutes, once/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Claude" })).toHaveAttribute("href", "/more/connect-claude");
  });

  it("chat, needs reconnect", () => {
    render(<ClaudeRequired variant="chat" lock="reconnect" />);
    expect(screen.getByText("Your Claude key needs attention")).toBeInTheDocument();
    expect(screen.getByText(/did not accept your key/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", "/more/connect-claude");
  });

  it("today, not connected", () => {
    render(<ClaudeRequired variant="today" lock="connect" />);
    expect(screen.getByText("Connect Claude to start analyzing")).toBeInTheDocument();
    expect(screen.getByText(/about five minutes, once/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up" })).toHaveAttribute("href", "/more/connect-claude");
  });

  it("today, needs reconnect", () => {
    render(<ClaudeRequired variant="today" lock="reconnect" />);
    expect(screen.getByText("Your Claude key needs attention")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toBeInTheDocument();
  });
});
