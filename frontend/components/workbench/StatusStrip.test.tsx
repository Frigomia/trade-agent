import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import { StatusStrip } from "./StatusStrip";

function rec(over: Partial<DiscoveryRecommendation> = {}): DiscoveryRecommendation {
  return {
    id: 1,
    created_at: "2026-10-20T12:00:00Z",
    reviewed_at: "2026-10-21T12:00:00Z",
    dismissal_reason: null,
    withdrawal: null,
    ...over,
  } as unknown as DiscoveryRecommendation;
}

describe("StatusStrip", () => {
  it("renders the approved strip with the no-order sentence", () => {
    render(<StatusStrip kind="approved" rec={rec()} />);
    expect(screen.getByRole("status")).toHaveTextContent("You approved this idea. No order was placed; trade-agent never trades.");
    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/2026/);
  });

  it("renders the dismissed strip with and without a note", () => {
    const { rerender } = render(<StatusStrip kind="dismissed" rec={rec({ dismissal_reason: "Too expensive." })} />);
    expect(screen.getByRole("status")).toHaveTextContent("You dismissed this idea. The research below is what you decided on.");
    expect(screen.getByText("Too expensive.")).toBeInTheDocument();
    expect(screen.getByText(/Your note:/)).toBeInTheDocument();
    rerender(<StatusStrip kind="dismissed" rec={rec()} />);
    expect(screen.queryByText(/Your note:/)).toBeNull();
  });

  it("shows a long unbroken note wrapped, as text", () => {
    const note = "x".repeat(400);
    render(<StatusStrip kind="dismissed" rec={rec({ dismissal_reason: note })} />);
    expect(screen.getByText(note, { exact: false })).toHaveStyle({ overflowWrap: "anywhere" });
  });

  it("shows the withdrawn reason in the dashed box as text, not markup", () => {
    const reason = "<img src=x onerror=alert(1)>";
    const { container } = render(
      <StatusStrip kind="withdrawn" rec={rec({ withdrawal: { kind: "not_compelling", reason, as_of: "2026-11-08T06:00:00Z" } })} />,
    );
    expect(container.querySelector("img")).toBeNull();
    const text = screen.getByText(reason);
    expect(text.closest("div")).toHaveStyle({ borderStyle: "dashed" });
    expect(screen.getByText(/From the latest scan · /)).toBeInTheDocument();
  });

  it("withdrawn without a reason has no dashed box", () => {
    const { container } = render(<StatusStrip kind="withdrawn" rec={rec({ withdrawal: { kind: "not_compelling", reason: null, as_of: null } })} />);
    expect(screen.getByRole("status")).toHaveTextContent("The latest scan no longer found this compelling.");
    expect(screen.queryByText(/From the latest scan/)).toBeNull();
    expect(Array.from(container.querySelectorAll("div")).some((d) => getComputedStyle(d).borderStyle === "dashed")).toBe(false);
  });

  it("labels the reason without a date when the scan date is unknown", () => {
    render(<StatusStrip kind="withdrawn" rec={rec({ withdrawal: { kind: "not_compelling", reason: "Slower growth.", as_of: null } })} />);
    expect(screen.getByText("From the latest scan")).toBeInTheDocument();
  });

  it("an invalidated withdrawal says it was withdrawn", () => {
    render(<StatusStrip kind="withdrawn" rec={rec({ withdrawal: { kind: "invalidated", reason: "Thesis broke.", as_of: null } })} />);
    expect(screen.getByRole("status")).toHaveTextContent("This idea was withdrawn.");
    expect(screen.getByRole("status")).not.toHaveTextContent("no longer found this compelling");
  });

  it("the withdrawn strip never says replaced", () => {
    render(<StatusStrip kind="withdrawn" rec={rec({ withdrawal: { kind: "not_compelling", reason: "Slower growth.", as_of: "2026-11-08T06:00:00Z" } })} />);
    // The approved copy says "nothing replaced it"; what must not appear is a claim that a newer idea took its place.
    expect(screen.queryByText(/(was|been|got) replaced|replaced by|replacement|superseded/i)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("nothing replaced it");
  });

  it("the newer strip says still waiting for your decision", () => {
    render(<StatusStrip kind="newer" rec={rec()} />);
    expect(screen.getByText("Newer analysis")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("still waiting for your decision");
    expect(screen.getByRole("status")).toHaveTextContent(/Updated .*2026/);
  });

  it.each([
    ["approved", "Approved"],
    ["dismissed", "Dismissed"],
    ["withdrawn", "Withdrawn"],
    ["newer", "Newer analysis"],
  ] as const)("each strip pairs a word with a shape: %s", (kind, word) => {
    render(<StatusStrip kind={kind} rec={rec()} />);
    const status = screen.getByRole("status");
    expect(screen.getByText(word)).toBeInTheDocument();
    // The icon circle always; a chip adds its own shape beside its word.
    expect(status.querySelectorAll("svg").length).toBe(kind === "newer" ? 1 : 2);
    if (kind !== "newer") expect(screen.getByText(word).querySelector("svg")).not.toBeNull();
  });
});
