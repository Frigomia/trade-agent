import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { DiscoveryIdeas, ScanRun } from "@/lib/api/discovery-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args), ApiError: class extends Error {} }));
vi.mock("next/navigation", () => ({ usePathname: () => "/today/scan", useRouter: () => ({ push: vi.fn() }) }));

import ScanResultsPage from "./page";

const SCAN: ScanRun = {
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
  set_aside: 0,
  excluded: [],
  rejected_mentions: [],
  coverage_summary: { set_aside_ideas: [] },
};

function renderPage() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ScanResultsPage />
    </SWRConfig>,
  );
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe("ScanResultsPage", () => {
  it("shows the latest scan from the saved ideas, with a way back to Today", async () => {
    apiFetch.mockResolvedValue({ recommendations: [], latest_scan: SCAN } satisfies DiscoveryIdeas);
    renderPage();

    expect(await screen.findByLabelText("Counts")).toHaveTextContent("600in the universe");
    expect(apiFetch).toHaveBeenCalledWith("/discovery/ideas");
    expect(screen.getByRole("heading", { level: 1, name: "Scan results" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("href", "/today");
  });

  it("says nothing has run when there is no scan, and offers Today", async () => {
    apiFetch.mockResolvedValue({ recommendations: [], latest_scan: null } satisfies DiscoveryIdeas);
    renderPage();

    expect(await screen.findByText("Nothing to show yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to Today" })).toHaveAttribute("href", "/today");
  });

  it("says the results could not be loaded", async () => {
    apiFetch.mockRejectedValue(new Error("down"));
    renderPage();

    expect(await screen.findByText("Could not load the scan results.")).toBeInTheDocument();
  });
});
