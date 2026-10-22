import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig } from "swr";
import { testHistory, testIdea, testRec } from "./testData";

const apiFetch = vi.fn();
const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) {
      super(detail);
      this.status = status;
      this.detail = detail;
    }
  }
  return { FakeApiError };
});
vi.mock("@/lib/api/client", () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args), ApiError: FakeApiError }));

let desktop = true;
vi.mock("@mui/material", async (importOriginal) => ({ ...(await importOriginal<typeof import("@mui/material")>()), useMediaQuery: () => desktop }));

import { Workbench } from "./Workbench";

function show(rec = testRec(), onDecided = vi.fn()) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Workbench recommendation={rec} onDecided={onDecided} />
    </SWRConfig>,
  );
  return { onDecided };
}

beforeEach(() => {
  vi.clearAllMocks();
  desktop = true;
  apiFetch.mockImplementation((path: string) =>
    path.startsWith("/discovery/ideas/1/history") ? Promise.resolve(testHistory()) : Promise.reject(new Error("unexpected " + path)),
  );
});

describe("Workbench identity and rail", () => {
  it("shows the company, its listing and tags, and one h1", async () => {
    show();

    expect(await screen.findByRole("heading", { level: 1, name: "Halden Systems" })).toBeInTheDocument();
    expect(screen.getByText("HLDN · NASDAQ")).toBeInTheDocument();
    expect(screen.getByText(/Software · Infrastructure/)).toBeInTheDocument();
    expect(screen.getByText(/United States/)).toBeInTheDocument();
  });

  it("keeps the decision rail beside the evidence with price, meters, last analysis and fit", async () => {
    show();

    const rail = await screen.findByRole("complementary", { name: "Decision" });
    expect(within(rail).getByText("USD 184.20")).toBeInTheDocument();
    expect(within(rail).getByText("High confidence")).toBeInTheDocument();
    expect(within(rail).getByText("Medium risk")).toBeInTheDocument();
    expect(within(rail).getByText(/Last analysis .*2026/)).toBeInTheDocument(); // an absolute date and time
    expect(within(rail).getByText("61")).toBeInTheDocument();
    expect(within(rail).getByText(/nothing is sent to a broker/i)).toBeInTheDocument();
  });

  it("says Not applicable for fit when there is nothing to compare with", async () => {
    show(testRec({ scores: [{ name: "fit", score: null, reasons: [] }] }));

    expect(await screen.findByText("Not applicable")).toBeInTheDocument();
  });

  it("approves and dismisses through the rail", async () => {
    const decided = { ...testRec(), status: "APPROVED" };
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path === "/analysis/recommendations/1/approve" && init?.method === "POST") return Promise.resolve(decided);
      if (path === "/analysis/recommendations/1/reject" && init?.method === "POST") return Promise.resolve({ ...decided, status: "REJECTED" });
      return Promise.resolve(testHistory());
    });
    const { onDecided } = show();

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(decided));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(2));
  });

  it("saves to Discover through the rail without recording a decision", async () => {
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      path === "/discover" && init?.method === "POST" ? Promise.resolve({}) : Promise.resolve(testHistory()),
    );
    const { onDecided } = show();

    fireEvent.click(await screen.findByRole("button", { name: "Save to Discover" }));

    const link = await screen.findByRole("link", { name: "View in Discover" });
    expect(link).toHaveAttribute("href", "/discover");
    expect(screen.getByRole("button", { name: "Saved" })).toHaveAttribute("aria-disabled", "true");
    expect(apiFetch).toHaveBeenCalledWith("/discover", { method: "POST", body: JSON.stringify({ ticker: "HLDN", asset_type: "STOCK", source: "today" }) });
    expect(onDecided).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining("/analysis/recommendations"), expect.anything());
  });

  it("shows why a save was refused next to the decision errors", async () => {
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === "POST" ? Promise.reject(new FakeApiError(409, "Discover is full (100 companies).")) : Promise.resolve(testHistory()),
    );
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Save to Discover" }));

    expect(await screen.findByText("Discover is full (100 companies).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save to Discover" })).not.toHaveAttribute("aria-disabled");
  });

  it("shows why a decision was refused, as with the other detail pages", async () => {
    apiFetch.mockImplementation((path: string, init?: RequestInit) =>
      init?.method === "POST" ? Promise.reject(new FakeApiError(409, "A newer analysis replaced this.")) : Promise.resolve(testHistory()),
    );
    show();

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(await screen.findByText("A newer analysis replaced this.")).toBeInTheDocument();
  });

  it("links Ask AI to Chat with the question typed in", async () => {
    show();

    const link = await screen.findByRole("link", { name: "Ask AI" });
    expect(decodeURIComponent(link.getAttribute("href")!)).toBe("/chat?ask=Walk me through the research on Halden Systems (HLDN).");
  });
});

describe("Workbench tabs", () => {
  it("opens on Overview with the thesis, the chart and both cases at equal weight", async () => {
    show();

    expect(await screen.findByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Investment thesis" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Share price" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bull case" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bear case" })).toBeInTheDocument();
  });

  it("shows the whole bear case, the bear claims and each negative development with its status in words", async () => {
    show();

    const bear = (await screen.findByRole("heading", { name: "Bear case" })).closest("section")!;
    expect(bear).toHaveTextContent("The final sentence of the risk.");
    const text = within(bear).getByText(/The final sentence of the risk./);
    expect(text).not.toHaveStyle({ overflow: "hidden" }); // shown in full, not clamped to a few lines
    expect(bear).toHaveTextContent("Customer concentration is high.");
    expect(bear).toHaveTextContent("Disputed");
    expect(bear).toHaveTextContent("2026-09-12");
    expect(bear).toHaveTextContent("Effect on the thesis: Revenue growth could slow.");
  });

  it("keeps both cases' content in the dashed AI box, and says whether the thesis stands after each development", async () => {
    show();

    const bear = (await screen.findByRole("heading", { name: "Bear case" })).closest("section")!;
    expect(within(bear).getByText("The final sentence of the risk.", { exact: false }).closest("div")).toHaveStyle({ borderStyle: "dashed" });
    expect(bear).toHaveTextContent("Thesis still stands");
  });

  it("shows bull claims with their kind and tier in words, and the catalysts as why now", async () => {
    show();

    const bull = (await screen.findByRole("heading", { name: "Bull case" })).closest("section")!;
    expect(bull).toHaveTextContent("Revenue grew 12% in the quarter.");
    expect(bull).toHaveTextContent("Fact");
    expect(bull).toHaveTextContent("Official");
    expect(bull).toHaveTextContent("Q3 results on 6 Nov.");
  });

  it("expands the thesis on request, with the outlook", async () => {
    show(testRec({ thesis: "Long thesis. ".repeat(40) }));

    const toggle = await screen.findByRole("button", { name: /read the full thesis/i });
    expect(screen.queryByText("Margins should keep widening.")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("Margins should keep widening.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show less/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("switches to Sources: every source with tier and date, safe links only, limits, unresolved items and the community view", async () => {
    show();

    fireEvent.click(await screen.findByRole("tab", { name: "Sources" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByRole("heading", { name: "Sources and research transparency" })).toBeInTheDocument();
    expect(within(panel).getByText(/3 sources · 1 unresolved/)).toBeInTheDocument();
    const link = within(panel).getByRole("link", { name: /example\.com/ });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(within(panel).getAllByRole("link")).toHaveLength(2); // the javascript: address is plain text
    expect(within(panel).getByText("Odd link.")).toBeInTheDocument();
    expect(within(panel).getByText(/price date uncertain/i)).toBeInTheDocument();
    expect(within(panel).getByText(/Scan quote ·/)).toBeInTheDocument();
    expect(within(panel).getByText(/A key customer paused renewals\. \(disputed\)/)).toBeInTheDocument();
    expect(within(panel).getByText("Forum posts are positive.")).toBeInTheDocument();
    expect(within(panel).getByText(/not checked, and not used in any score/i)).toBeInTheDocument();
  });

  it("follows the tab pattern: one tab stop, and the arrow keys move between tabs", async () => {
    show();

    const overview = await screen.findByRole("tab", { name: "Overview" });
    const sources = screen.getByRole("tab", { name: "Sources" });
    expect(overview).toHaveAttribute("tabindex", "0");
    expect(sources).toHaveAttribute("tabindex", "-1");
    const numbers = screen.getByRole("tab", { name: "Numbers" });
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(numbers).toHaveAttribute("aria-selected", "true");
    expect(numbers).toHaveFocus();
    expect(numbers).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(numbers, { key: "End" });
    expect(sources).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(sources, { key: "ArrowRight" }); // wraps round
    expect(overview).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Overview", "Numbers", "Risk and fit", "Sources"]);
  });

  it("shows the written portfolio-fit explanation on the Risk and fit tab, not on Overview", async () => {
    show();

    await screen.findByRole("tab", { name: "Overview" });
    expect(screen.queryByText("It would add software exposure you do not have.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Risk and fit" }));
    expect(screen.getByText("It would add software exposure you do not have.")).toBeInTheDocument();
  });

  it("opens Sources from the rail's See sources link", async () => {
    show();

    fireEvent.click(await screen.findByRole("button", { name: "See sources" }));
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
  });

  it("says so when no sources, nothing unresolved and no community note were saved", async () => {
    show(testRec({ sources: [], negative_developments: [], community_note: null, data_notes: [] }));

    fireEvent.click(await screen.findByRole("tab", { name: "Sources" }));
    expect(screen.getByText("No sources were saved with this idea.")).toBeInTheDocument();
    expect(screen.getByText("Nothing disputed or unverified was found.")).toBeInTheDocument();
    expect(screen.queryByText(/community opinion/i)).not.toBeInTheDocument();
  });
});

describe("Workbench price chart", () => {
  it("draws the history with its change over the range and the numbers beside it as text", async () => {
    show();

    expect(await screen.findByRole("img", { name: /price chart, 30 daily closes/i })).toBeInTheDocument();
    expect(screen.getByText("USD 179.00")).toBeInTheDocument(); // the last close
    expect(screen.getByText(/over this range/)).toBeInTheDocument();
    expect(screen.getByText(/One year shown, 30 days/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^(1W|1M|6M|1Y|5Y)$/ }).map((b) => b.textContent)).toEqual(["1W", "1M", "6M", "1Y", "5Y"]);
  });

  it("keeps the range control on screen while a new range loads", async () => {
    apiFetch.mockImplementation((path: string) =>
      path.endsWith("range=1m") ? new Promise(() => {}) : Promise.resolve(testHistory()),
    );
    show();

    fireEvent.click(await screen.findByRole("button", { name: "1M" }));
    expect(screen.getByRole("button", { name: "1M" })).toBeInTheDocument(); // not swapped for a placeholder
    expect(screen.getByRole("img", { name: /price chart/i })).toBeInTheDocument(); // the last chart stays until the new one arrives
  });

  it("asks for the range that was picked", async () => {
    show();

    fireEvent.click(await screen.findByRole("button", { name: "1M" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/discovery/ideas/1/history?range=1m"));
    expect(screen.getByRole("button", { name: "1M" })).toHaveAttribute("aria-pressed", "true");
  });

  it("reads one close at a time from the keyboard", async () => {
    show();

    const chart = await screen.findByRole("img", { name: /price chart/i });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByText(/USD 178\.00$/)).toBeInTheDocument();
    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByText(/USD 150\.00$/)).toBeInTheDocument();
  });

  it("says the history is not available when the endpoint fails, and the page still works", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(404, "Not found"));
    show();

    expect(await screen.findByText(/price history is not available for this company right now/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bear case" })).toBeInTheDocument();
  });

  it("says there is not enough history for a range with fewer than two closes", async () => {
    apiFetch.mockResolvedValue(testHistory(1));
    show();

    expect(await screen.findByText(/not enough price history for this range/i)).toBeInTheDocument();
  });

  it("treats a malformed answer as unavailable rather than crashing", async () => {
    apiFetch.mockResolvedValue({ unexpected: true });
    show();

    expect(await screen.findByText(/price history is not available/i)).toBeInTheDocument();
  });
});

describe("Workbench on a phone", () => {
  beforeEach(() => {
    desktop = false;
  });

  it("puts the summary above the tabs and the actions in a bar, with icon buttons named for screen readers", async () => {
    show();

    expect(screen.queryByRole("complementary", { name: "Decision" })).not.toBeInTheDocument();
    expect(await screen.findByText("USD 184.20")).toBeInTheDocument();
    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(screen.getByText("Portfolio fit")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See sources" }));
    expect(screen.getByRole("tab", { name: "Sources" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save to Discover" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask AI" })).toBeInTheDocument();
  });
});

describe("Workbench with a legacy idea", () => {
  it("renders without a snapshot, headline or price", async () => {
    show({ ...testRec({ snapshot: null, headline: null }), price_change_pct: null });

    expect(await screen.findByRole("heading", { level: 1, name: "Halden Systems" })).toBeInTheDocument();
    expect(screen.getByText("HLDN")).toBeInTheDocument();
    expect(testIdea().snapshot).not.toBeNull(); // the fixture itself is unchanged
  });
});
