import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ScanRun } from "@/lib/api/discovery-types";
import { ScanResults } from "./ScanResults";

const BASE: ScanRun = {
  id: 1,
  created_at: "2026-10-28T06:12:00",
  status: "completed",
  universe_size: 600,
  eligible: 412,
  shortlisted: 8,
  researched: 7,
  outcome: "ideas",
  summary: "",
  opportunities: 4,
  set_aside: 3,
  excluded: [
    { ticker: "ORBF", name: "Orbit Freight", reason: "thesis_invalidated", explanation: "A recall removes the growth case.", evidence: ["https://regulator.example/notice", "javascript:alert(1)"] },
    ...Array.from({ length: 8 }, (_, i) => ({ ticker: `N${i}`, name: `Quiet Co ${i}`, reason: "insufficient_data" as const, explanation: "2 core fundamentals available", evidence: [] })),
  ],
  rejected_mentions: [
    { mention: { name: "Orange", ticker_hint: "ORA", exchange_hint: null, origin: "tavily", reason: "Named in a roundup.", url: "https://news.example/roundup" }, reason: "ambiguous" },
  ],
  coverage_summary: { set_aside_ideas: [{ ticker: "HRBF", name: "Harbor Foods", overall: 48, confidence: "medium" }], missing_snapshot_symbols: ["A", "B"], mentions_available: true },
};

describe("ScanResults", () => {
  it("shows the counts from the scan, so they match the scan bar", () => {
    render(<ScanResults scan={BASE} />);
    const counts = screen.getByLabelText("Counts");
    expect(counts).toHaveTextContent("600in the universe");
    expect(counts).toHaveTextContent("4opportunities");
    expect(counts).toHaveTextContent("3set aside");
  });

  it("lists each kind with its reason in words and counts the filter", () => {
    render(<ScanResults scan={BASE} />);
    expect(screen.getByRole("button", { name: /^Set aside/ })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /^Not researched/ })).toHaveTextContent("8");
    expect(screen.getByText("Thesis no longer holds")).toBeInTheDocument();
    expect(screen.getByText("Below the bar")).toBeInTheDocument();
    expect(screen.getByText("Name matches several companies")).toBeInTheDocument();
  });

  it("cuts the long Not researched group until Show more is pressed", () => {
    render(<ScanResults scan={BASE} />);
    expect(screen.queryByText("Quiet Co 7")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show 2 more" }));
    expect(screen.getByText("Quiet Co 7")).toBeInTheDocument();
  });

  it("filters to one kind and says so when there is nothing in it", () => {
    render(<ScanResults scan={{ ...BASE, rejected_mentions: [] }} />);
    fireEvent.click(screen.getByRole("button", { name: /^Mentions/ }));
    expect(screen.getByText("No mentions were rejected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Mentions/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("opens a thesis row for the explanation in the web box and draws only safe links", () => {
    render(<ScanResults scan={BASE} />);
    const row = screen.getByRole("button", { name: /Orbit Freight/ });
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/A recall removes the growth case/)).toBeInTheDocument();
    const evidence = screen.getByRole("group", { name: "Evidence for Orbit Freight" });
    const link = within(evidence).getByRole("link", { name: /regulator\.example/ });
    expect(link).toHaveAttribute("href", "https://regulator.example/notice");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // The unsafe address is text, never a link.
    expect(within(evidence).getAllByRole("link")).toHaveLength(1);
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/A recall removes the growth case/)).not.toBeInTheDocument();
  });

  it("renders untrusted text as text, not markup", () => {
    const hostile = { ...BASE, excluded: [{ ...BASE.excluded[0], explanation: "<img src=x onerror=alert(1)> done" }] };
    const { container } = render(<ScanResults scan={hostile} />);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText(/<img src=x onerror=alert\(1\)> done/)).toBeInTheDocument();
  });

  it("says how many below-the-bar companies were not kept on a scan saved before they were", () => {
    render(<ScanResults scan={{ ...BASE, coverage_summary: {}, excluded: BASE.excluded.slice(0, 1) }} />);
    expect(screen.getByRole("note")).toHaveTextContent("2 researched companies below the bar were not kept");
  });

  it("marks a scan saved without counts and shows dashes", () => {
    render(<ScanResults scan={{ ...BASE, opportunities: null, set_aside: null }} />);
    expect(screen.getByText(/saved before its counts were kept/)).toBeInTheDocument();
    expect(screen.getByLabelText("Counts")).toHaveTextContent("—opportunities");
  });

  it("lists the coverage notes the scan recorded", () => {
    render(<ScanResults scan={BASE} />);
    expect(screen.getByText("2 companies had no market data.")).toBeInTheDocument();
    expect(screen.getByText("Research mentions were available for this scan.")).toBeInTheDocument();
  });

  it("says there is nothing to report when the scan recorded no notes", () => {
    render(<ScanResults scan={{ ...BASE, coverage_summary: { set_aside_ideas: [] } }} />);
    expect(screen.getByText("Nothing to report.")).toBeInTheDocument();
  });
});
