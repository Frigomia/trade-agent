import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { RecommendationOut } from "@/lib/api/recommendation-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));
import { TodayDesktop } from "./TodayDesktop";

beforeEach(() => vi.clearAllMocks());

describe("TodayDesktop", () => {
  it("shows the Portfolio alerts panel and no portfolio value chart, and asks for no snapshots", () => {
    const recs = [{ id: 1, ticker: "AAPL", action: "TRIM", status: "PENDING" }] as RecommendationOut[];
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><TodayDesktop recommendations={recs} /></SWRConfig>);

    expect(screen.getByRole("heading", { name: "Portfolio alerts" })).toBeInTheDocument();
    expect(screen.queryByText("Portfolio value")).not.toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalledWith("/portfolio/snapshots");
  });
});
