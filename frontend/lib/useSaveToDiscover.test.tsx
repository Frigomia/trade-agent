import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class extends Error {},
}));

import { useDiscoverList } from "./useDiscoverList";
import { useSaveToDiscover } from "./useSaveToDiscover";

const company = { ticker: "HLDN", asset_type: "STOCK", name: "Halden Systems", source: "today", added_at: "2026-10-22T08:00:00", note: null, price: 1, change_pct: 0, status: "none", report_id: null };

function DiscoverPage() {
  const list = useDiscoverList();
  return <p>{list.loading ? "loading" : list.items.map((i) => i.ticker).join(",") || "empty"}</p>;
}

function TodayPage() {
  const save = useSaveToDiscover("HLDN", "STOCK");
  return <button onClick={() => void save.save()}>{save.saved ? "saved" : "save"}</button>;
}

describe("useSaveToDiscover", () => {
  it("lets Discover read the list again when it opens while an earlier read was still pending", async () => {
    let finishFirstRead: (list: unknown) => void = () => {};
    let listReads = 0;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path !== "/discover" || init?.method === "POST") return Promise.resolve({});
      if (listReads++ === 0) return new Promise((resolve) => (finishFirstRead = resolve)); // a read left pending
      return Promise.resolve({ items: [company], missing: [] });
    });
    // The provider stays up for the whole visit, as in the app: the cache outlives the Discover page.
    const app = (page: "discover" | "today") => (
      <SWRConfig value={{ provider: () => new Map() }}>{page === "discover" ? <DiscoverPage /> : <TodayPage />}</SWRConfig>
    );
    const { rerender } = render(app("discover"));
    expect(screen.getByText("loading")).toBeInTheDocument();

    rerender(app("today")); // left Discover before its read finished
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await screen.findByRole("button", { name: "saved" });
    rerender(app("discover")); // View in Discover, the old read still pending
    await act(async () => finishFirstRead({ items: [], missing: [] })); // it ends, with the list as it was

    await waitFor(() => expect(screen.getByText("HLDN")).toBeInTheDocument());
  });
});
