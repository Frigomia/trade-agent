import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthHeading, AuthNote, AuthShell, BackToSignIn } from "./AuthShell";

afterEach(() => vi.unstubAllEnvs());

describe("AuthShell", () => {
  it("shows the promise, the form and the advisory line, with the heading as the one h1", () => {
    render(
      <AuthShell>
        <AuthHeading title="Sign in" subtitle="to your trade-agent account" />
      </AuthShell>,
    );

    expect(screen.getByText(/It shows its work, remembers how past calls turned out, and never places a trade\./)).toBeInTheDocument();
    expect(screen.getByText("An advisory-only reasoning partner. You stay the decision-maker.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Advisory information only, not investment advice.")).toBeInTheDocument();
  });

  it("labels the research card as an illustration, so it cannot be read as a recommendation", () => {
    render(<AuthShell>x</AuthShell>);

    const card = screen.getByRole("article", { name: "An illustrative research card" });
    expect(card).toHaveTextContent("Illustrative example, not a real recommendation");
    expect(card).toHaveTextContent("Risk to the thesis.");
  });

  it("does not carry the Logo.dev credit: these screens show no logo", () => {
    vi.stubEnv("NEXT_PUBLIC_LOGO_DEV_TOKEN", "pk_test");
    render(<AuthShell>x</AuthShell>);

    expect(screen.queryByText(/Logo\.dev/)).not.toBeInTheDocument();
  });

  it("offers a way back to sign in and a quiet invitation note", () => {
    render(
      <AuthShell>
        <AuthNote>trade-agent is by invitation only.</AuthNote>
        <BackToSignIn />
      </AuthShell>,
    );

    expect(screen.getByText("trade-agent is by invitation only.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });
});
