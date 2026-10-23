import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SWRConfig, type Cache } from "swr";
import type { DiscoverItem, DiscoverList } from "@/lib/api/discover-types";

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

import DiscoverPage from "./page";
import { UNDO_MS } from "@/lib/useDiscoverList";

const item = (ticker: string, over: Partial<DiscoverItem> = {}): DiscoverItem => ({
  ticker,
  asset_type: "STOCK",
  name: `${ticker} Corp`,
  exchange: "NASDAQ",
  currency: "USD",
  source: "manual",
  added_at: "2026-10-20T08:00:00",
  note: null,
  target_weight: null,
  target_price_low: null,
  target_price_high: null,
  price: 100,
  change_pct: 1,
  price_as_of: "2026-10-21",
  stale: false,
  status: "none",
  insight: null,
  report_id: null,
  owned: false,
  ...over,
});

const LIST: DiscoverList = {
  items: [
    item("HLDN", { name: "Halden Systems", status: "analyzed", insight: "Recurring revenue.", report_id: 7, added_at: "2026-10-21T08:00:00", change_pct: 2.1 }),
    item("NVKC", { name: "Norvik Cloud", added_at: "2026-10-18T08:00:00", change_pct: -0.5 }),
    item("PLMN", { name: "Pellman Stores", added_at: "2026-10-19T08:00:00", change_pct: 0.4 }),
  ],
  missing: [],
};

let handlers: Record<string, () => unknown>;
const count = (key: string) => apiFetch.mock.calls.filter((c) => `${(c[1] as RequestInit | undefined)?.method ?? "GET"} ${c[0]}` === key).length;
const post = () => JSON.parse((apiFetch.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST" && c[0] === "/discover")![1] as RequestInit).body as string);

// `cache` lets two renders share one list, as the app's pages do when you leave Discover and come back.
function renderPage(cache: Cache = new Map(), config: { revalidateIfStale?: boolean } = {}) {
  return render(
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, ...config }}>
      <DiscoverPage />
    </SWRConfig>,
  );
}

const names = () => within(screen.getByRole("list", { name: "Companies" })).getAllByRole("listitem").map((li) => li.querySelector("span, a")!.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  handlers = { "GET /discover": () => LIST };
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const handler = handlers[`${init?.method ?? "GET"} ${path}`];
    if (!handler) return Promise.reject(new Error("unexpected " + path));
    try {
      return Promise.resolve(handler());
    } catch (err) {
      return Promise.reject(err);
    }
  });
});

afterEach(() => vi.useRealTimers());

describe("DiscoverPage", () => {
  it("shows the title, the one-line subtitle and the companies, newest first", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { level: 1, name: "Discover" })).toBeInTheDocument();
    expect(screen.getByText("Companies you are monitoring. You do not need to own them.")).toBeInTheDocument();
    await screen.findByText("Halden Systems");
    expect(names()).toEqual(["Halden Systems", "Pellman Stores", "Norvik Cloud"]);
  });

  it("ends with the advisory note: delayed prices, not advice, nothing sent to a broker", async () => {
    renderPage();
    await screen.findByText("Halden Systems");

    expect(screen.getByText(/Prices can be delayed.*not investment advice.*Nothing here is sent to a broker/)).toBeInTheDocument();
  });

  it("counts each filter and filters, then says when none match", async () => {
    renderPage();
    await screen.findByText("Halden Systems");
    const group = screen.getByRole("group", { name: "Show" });
    expect(within(group).getByRole("button", { name: /^All\s*3/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: /AI analyzed\s*1/ })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: /Not analyzed\s*2/ })).toBeInTheDocument();

    fireEvent.click(within(group).getByRole("button", { name: /AI analyzed/ }));
    expect(names()).toEqual(["Halden Systems"]);
    fireEvent.click(within(group).getByRole("button", { name: /Not analyzed/ }));
    expect(names()).toEqual(["Pellman Stores", "Norvik Cloud"]);
  });

  it("draws the filters as the approved pill track: the chosen one raised in plain text, every count a round chip, the chosen chip tinted", async () => {
    renderPage();
    await screen.findByText("Halden Systems");
    const group = screen.getByRole("group", { name: "Show" });
    const all = within(group).getByRole("button", { name: /^All\s*3/ });
    const analyzed = within(group).getByRole("button", { name: /AI analyzed\s*1/ });

    expect(all).toHaveStyle({ color: "var(--text)", backgroundColor: "var(--panel)", fontWeight: "650" });
    expect(analyzed).toHaveStyle({ color: "var(--text2)", fontWeight: "500" }); // quiet, never the link blue
    expect(within(all).getByText("3")).toHaveStyle({ backgroundColor: "var(--accent-wash)", color: "var(--accent)" });
    expect(within(analyzed).getByText("1")).toHaveStyle({ backgroundColor: "var(--track)", color: "var(--text2)" });
  });

  it("explains an empty filter and offers to show all", async () => {
    handlers["GET /discover"] = () => ({ items: [item("NVKC", { name: "Norvik Cloud" })], missing: [] });
    renderPage();
    await screen.findByText("Norvik Cloud");

    fireEvent.click(screen.getByRole("button", { name: /AI analyzed/ }));

    expect(screen.getByText("No analyzed companies yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("Norvik Cloud")).toBeInTheDocument();
  });

  it("sorts by name and by daily change", async () => {
    renderPage();
    await screen.findByText("Halden Systems");

    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "name" } });
    expect(names()).toEqual(["Halden Systems", "Norvik Cloud", "Pellman Stores"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort by" }), { target: { value: "change" } });
    expect(names()).toEqual(["Halden Systems", "Pellman Stores", "Norvik Cloud"]);
  });

  it("says what Discover is for when the list is empty, and the button focuses the search", async () => {
    handlers["GET /discover"] = () => ({ items: [], missing: [] });
    renderPage();

    expect(await screen.findByText("Nothing to watch yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search for a company" }));
    expect(screen.getByRole("textbox", { name: "Search a company by name or ticker" })).toHaveFocus();
  });

  it("says it could not load, and tries again on request", async () => {
    handlers["GET /discover"] = () => {
      throw new FakeApiError(500, "boom");
    };
    renderPage();

    expect(await screen.findByText("Could not load Discover.")).toBeInTheDocument();
    expect(count("GET /discover")).toBe(1); // not retried in a loop
    handlers["GET /discover"] = () => LIST;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Halden Systems")).toBeInTheDocument();
  });

  it("says that some prices could not be loaded", async () => {
    handlers["GET /discover"] = () => ({ items: [item("NVKC", { price: null, change_pct: null })], missing: ["prices"] });
    renderPage();

    expect(await screen.findByText(/Some prices could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText("Price unavailable")).toBeInTheDocument();
  });

  it("refreshes the prices on request", async () => {
    renderPage();
    await screen.findByText("Halden Systems");

    fireEvent.click(screen.getByRole("button", { name: "Refresh prices" }));

    await waitFor(() => expect(count("GET /discover")).toBe(2));
  });

  describe("adding", () => {
    const search = (q: string) => `GET /market/search?q=${encodeURIComponent(q)}`;

    it("searches, adds a result without asking for shares or a cost, and says what was filled in", async () => {
      handlers[search("kes")] = () => [{ symbol: "KSTR", name: "Kestrel Systems", type: "STOCK", exchange: "NYSE" }];
      handlers["POST /discover"] = () => ({ id: 1 });
      renderPage();
      await screen.findByText("Halden Systems");

      fireEvent.change(screen.getByRole("textbox", { name: "Search a company by name or ticker" }), { target: { value: "kes" } });
      fireEvent.click(await screen.findByRole("button", { name: "Add Kestrel Systems to Discover" }));

      await waitFor(() => expect(count("POST /discover")).toBe(1));
      expect(post()).toEqual({ ticker: "KSTR", asset_type: "STOCK", source: "manual" });
      expect(await screen.findByText("Added Kestrel Systems. Name, exchange and currency were filled in.")).toBeInTheDocument();
      await waitFor(() => expect(count("GET /discover")).toBe(2)); // the list is read again
      expect(screen.getByRole("textbox", { name: "Search a company by name or ticker" })).toHaveValue("");
    });

    it("still counts an add as done when reading the list again fails afterwards", async () => {
      handlers["GET /market/search?q=kes"] = () => [{ symbol: "KSTR", name: "Kestrel Systems", type: "STOCK", exchange: "NYSE" }];
      handlers["POST /discover"] = () => ({ id: 1 });
      renderPage();
      await screen.findByText("Halden Systems");
      handlers["GET /discover"] = () => {
        throw new FakeApiError(500, "boom");
      };

      fireEvent.change(screen.getByRole("textbox", { name: "Search a company by name or ticker" }), { target: { value: "kes" } });
      fireEvent.click(await screen.findByRole("button", { name: "Add Kestrel Systems to Discover" }));

      expect(await screen.findByText(/Added Kestrel Systems/)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole("textbox", { name: "Search a company by name or ticker" })).toHaveValue(""));
    });

    it("shows Already in Discover for a company that is in the list", async () => {
      handlers[search("hal")] = () => [{ symbol: "HLDN", name: "Halden Systems", type: "STOCK", exchange: "NASDAQ" }];
      renderPage();
      await screen.findByText("Halden Systems");

      fireEvent.change(screen.getByRole("textbox", { name: "Search a company by name or ticker" }), { target: { value: "hal" } });

      const results = await screen.findByRole("list", { name: "Search results" });
      expect(await within(results).findByText("Already in Discover")).toBeInTheDocument();
      expect(within(results).queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
    });

    it("says why an add failed", async () => {
      handlers[search("kes")] = () => [{ symbol: "KSTR", name: "Kestrel Systems", type: "STOCK", exchange: "NYSE" }];
      handlers["POST /discover"] = () => {
        throw new FakeApiError(409, "You can have at most 100 companies.");
      };
      renderPage();
      await screen.findByText("Halden Systems");

      fireEvent.change(screen.getByRole("textbox", { name: "Search a company by name or ticker" }), { target: { value: "kes" } });
      fireEvent.click(await screen.findByRole("button", { name: "Add Kestrel Systems to Discover" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("You can have at most 100 companies.");
      expect(screen.getByRole("textbox", { name: "Search a company by name or ticker" })).toHaveValue("kes"); // kept to try again
    });
  });

  describe("removing", () => {
    const removeHalden = () => fireEvent.click(screen.getByRole("button", { name: "Remove Halden Systems from Discover" }));

    it("hides the company at once and offers Undo, without sending anything yet", async () => {
      renderPage();
      await screen.findByText("Halden Systems");

      removeHalden();

      expect(screen.queryByText("Halden Systems")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Removed Halden Systems from Discover. It only leaves this list.");
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(0);
    });

    it("Undo brings it back and the removal is never sent", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      renderPage();
      await screen.findByText("Halden Systems");
      removeHalden();

      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 1000);
      });

      expect(screen.getByText("Halden Systems")).toBeInTheDocument();
      expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(0);
    });

    it("sends the removal once Undo has run out, then reads the list again", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      handlers["DELETE /portfolio/watchlist/HLDN"] = () => undefined;
      renderPage();
      await screen.findByText("Halden Systems");
      removeHalden();
      expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(0);

      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 100);
      });

      await waitFor(() => expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(1));
      await waitFor(() => expect(count("GET /discover")).toBe(2));
    });

    it("sends a pending removal when the page is left, so it does not come back later", async () => {
      handlers["DELETE /portfolio/watchlist/HLDN"] = () => undefined;
      const view = renderPage();
      await screen.findByText("Halden Systems");
      removeHalden();

      view.unmount();

      await waitFor(() => expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(1));
    });

    it("brings the company back and says why when the removal fails", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      handlers["DELETE /portfolio/watchlist/HLDN"] = () => {
        throw new FakeApiError(500, "Server error");
      };
      renderPage();
      await screen.findByText("Halden Systems");
      removeHalden();

      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 100);
      });

      expect(await screen.findByText("Halden Systems")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Could not remove Halden Systems: Server error.");
    });

    it("keeps each removal separate, Undo restores the latest first, and the notice follows what is left to undo", async () => {
      renderPage();
      await screen.findByText("Halden Systems");

      removeHalden();
      fireEvent.click(screen.getByRole("button", { name: "Remove Norvik Cloud from Discover" }));
      expect(names()).toEqual(["Pellman Stores"]);
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));

      expect(names()).toEqual(["Pellman Stores", "Norvik Cloud"]);
      // The notice now describes the removal that can still be undone, not a dead "Restored".
      expect(screen.getByRole("status")).toHaveTextContent("Removed Halden Systems from Discover.");
      expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
      expect(screen.getByRole("status")).toHaveTextContent("Restored Halden Systems.");
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });

    it("drops the Removed notice and its Undo once the removal has been sent", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      handlers["DELETE /portfolio/watchlist/HLDN"] = () => undefined;
      renderPage();
      await screen.findByText("Halden Systems");
      removeHalden();

      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 100);
      });

      await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
      expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    });

    it("counts a removal that finds the company already gone as done, with no error", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      handlers["DELETE /portfolio/watchlist/HLDN"] = () => {
        throw new FakeApiError(404, "Not on your watchlist");
      };
      renderPage();
      await screen.findByText("Halden Systems");
      removeHalden();

      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 100);
      });

      await waitFor(() => expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(1));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("does not send a second removal on leaving the page when one is already on its way", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let finish: () => void = () => {};
      handlers["DELETE /portfolio/watchlist/HLDN"] = () => new Promise<void>((resolve) => (finish = resolve));
      const view = renderPage();
      await screen.findByText("Halden Systems");
      removeHalden();
      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 100);
      });
      await waitFor(() => expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(1));

      view.unmount();
      await act(async () => {
        finish(); // completes after the page is gone: it must not touch it, nor leak into the next test
      });

      expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(1);
    });

    it("keeps a removed company out of the list even when reading the list again fails", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      handlers["GET /market/search?q=hal"] = () => [{ symbol: "HLDN", name: "Halden Systems", type: "STOCK", exchange: "NASDAQ" }];
      handlers["DELETE /portfolio/watchlist/HLDN"] = () => {
        handlers["GET /discover"] = () => {
          throw new FakeApiError(500, "boom"); // the list cannot be read after the removal
        };
        return undefined;
      };
      renderPage();
      await screen.findByText("Halden Systems");
      removeHalden();

      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 100);
      });

      await waitFor(() => expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(1));
      await waitFor(() => expect(count("GET /discover")).toBeGreaterThanOrEqual(2)); // the read that failed
      expect(screen.queryByText("Halden Systems")).not.toBeInTheDocument();
      expect(names()).toEqual(["Pellman Stores", "Norvik Cloud"]);
      // And it can be added again: it is not "Already in Discover".
      fireEvent.change(screen.getByRole("textbox", { name: "Search a company by name or ticker" }), { target: { value: "hal" } });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      expect(await screen.findByRole("button", { name: "Add Halden Systems to Discover" })).toBeInTheDocument();
    });

    it("takes a company out of the list shown after returning to the page while its removal was still on its way", async () => {
      const cache: Cache = new Map();
      let finish: () => void = () => {};
      handlers["DELETE /portfolio/watchlist/HLDN"] = () =>
        new Promise<void>((resolve) => {
          finish = () => {
            // Once the removal is done the server no longer lists the company.
            handlers["GET /discover"] = () => ({ items: LIST.items.filter((i) => i.ticker !== "HLDN"), missing: [] });
            resolve();
          };
        });
      const first = renderPage(cache);
      await screen.findByText("Halden Systems");
      removeHalden();
      first.unmount(); // leaving sends the removal, which is still on its way
      await waitFor(() => expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(1));

      // Back on Discover: the cached list (read before the removal finished) is shown, and not read
      // again by itself, so only the finishing removal can correct it.
      renderPage(cache, { revalidateIfStale: false });
      expect(await screen.findByText("Halden Systems")).toBeInTheDocument();
      await act(async () => {
        finish();
      });

      await waitFor(() => expect(screen.queryByText("Halden Systems")).not.toBeInTheDocument());
      expect(names()).toEqual(["Pellman Stores", "Norvik Cloud"]);
    });

    it("keeps the company, with a message, when the removal truly fails, and does not drop it from the list", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      handlers["DELETE /portfolio/watchlist/HLDN"] = () => {
        throw new FakeApiError(500, "Server error");
      };
      renderPage();
      await screen.findByText("Halden Systems");
      removeHalden();

      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 100);
      });

      expect(await screen.findByText("Halden Systems")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Could not remove Halden Systems: Server error.");
      expect(names()).toContain("Halden Systems");
    });

    it("will not add a company whose removal is on its way, and says so", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      handlers["GET /market/search?q=hal"] = () => [{ symbol: "HLDN", name: "Halden Systems", type: "STOCK", exchange: "NASDAQ" }];
      handlers["DELETE /portfolio/watchlist/HLDN"] = () => new Promise<void>(() => {});
      renderPage();
      await screen.findByText("Halden Systems");
      removeHalden();
      await act(async () => {
        vi.advanceTimersByTime(UNDO_MS + 100);
      });
      await waitFor(() => expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(1));

      fireEvent.change(screen.getByRole("textbox", { name: "Search a company by name or ticker" }), { target: { value: "hal" } });
      await act(async () => {
        vi.advanceTimersByTime(400);
      });
      fireEvent.click(await screen.findByRole("button", { name: "Add Halden Systems to Discover" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("still being removed");
      expect(count("POST /discover")).toBe(0);
    });

    it("adding a company that is waiting to be removed brings it back instead of adding it twice", async () => {
      handlers["GET /market/search?q=hal"] = () => [{ symbol: "HLDN", name: "Halden Systems", type: "STOCK", exchange: "NASDAQ" }];
      renderPage();
      await screen.findByText("Halden Systems");
      removeHalden();

      fireEvent.change(screen.getByRole("textbox", { name: "Search a company by name or ticker" }), { target: { value: "hal" } });
      fireEvent.click(await screen.findByRole("button", { name: "Add Halden Systems to Discover" }));

      expect(await screen.findByText("Halden Systems", { selector: "a" })).toBeInTheDocument();
      expect(count("POST /discover")).toBe(0);
      expect(count("DELETE /portfolio/watchlist/HLDN")).toBe(0);
    });
  });
});

describe("DiscoverPage editing targets", () => {
  const edit = async () => {
    await screen.findByText("Halden Systems");
    fireEvent.click(screen.getByRole("button", { name: "Edit target for Halden Systems" }));
    return screen.findByRole("dialog");
  };

  it("opens the editor for that company, saves the range with a PATCH and shows it on the card without reading the whole list again", async () => {
    handlers["PATCH /discover/HLDN"] = () => ({ ...LIST.items.find((i) => i.ticker === "HLDN")!, target_price_low: 90, target_price_high: 110, price: null, change_pct: null, stale: true });
    renderPage();
    const dialog = await edit();
    fireEvent.change(within(dialog).getByLabelText("Lowest price"), { target: { value: "90" } });
    fireEvent.change(within(dialog).getByLabelText("Highest price"), { target: { value: "110" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save target" }));

    await waitFor(() => expect(count("PATCH /discover/HLDN")).toBe(1));
    expect(await screen.findByText(/Range USD 90\.00 to 110\.00/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(count("GET /discover")).toBe(1); // the answer has no quote: the card keeps its price
  });

  it("reads the list again when the company turns out to be gone, and keeps the editor open with the reason until it is closed", async () => {
    handlers["PATCH /discover/HLDN"] = () => {
      throw new FakeApiError(404, "Not in your Discover list");
    };
    renderPage();
    const dialog = await edit();
    fireEvent.change(within(dialog).getByLabelText("Target weight (%)"), { target: { value: "3" } });
    handlers["GET /discover"] = () => ({ ...LIST, items: LIST.items.filter((i) => i.ticker !== "HLDN") });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save target" }));

    // The company has left the list behind the dialog, but the reason stays on screen until it is closed.
    await waitFor(() => expect(count("GET /discover")).toBe(2));
    await waitFor(() => expect(screen.queryByText("Halden Systems")).not.toBeInTheDocument()); // the card is gone
    expect(within(dialog).getByText("Target for Halden Systems")).toBeInTheDocument(); // the dialog still names it
    await new Promise((resolve) => setTimeout(resolve, 400)); // longer than the dialog's exit transition
    expect(within(dialog).getByText("Not in your Discover list")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save target" })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes without a request when nothing was changed", async () => {
    renderPage();
    const dialog = await edit();

    fireEvent.click(within(dialog).getByRole("button", { name: "Save target" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(count("PATCH /discover/HLDN")).toBe(0);
  });
});
