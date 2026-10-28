import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
import ScanResultsPage from "./page";

function renderPage() {
  return render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}><ScanResultsPage /></SWRConfig>);
}

describe("scan results page", () => {
  it("loads the existing saved feed without starting a scan", async () => {
    apiFetch.mockResolvedValue({ recommendations: [], latest_scan: null });
    renderPage();
    expect(await screen.findByRole("heading", { name: "No scan yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to Today/ })).toHaveAttribute("href", "/today");
    expect(apiFetch.mock.calls.every(([path]) => path === "/discovery/ideas")).toBe(true);
  });

  it("shows a retry action for a failed read", async () => {
    apiFetch.mockRejectedValue(new Error("unavailable"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Saved scan results are unavailable");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
