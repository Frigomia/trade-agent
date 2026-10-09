import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import useSWR, { SWRConfig } from "swr";

const { FakeApiError, apiFetch } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      public status: number,
      public detail: string,
    ) {
      super(detail);
    }
  }
  return { FakeApiError, apiFetch: vi.fn() };
});
vi.mock("@/lib/api/client", () => ({ apiFetch, ApiError: FakeApiError }));

import { DecisionActions } from "./DecisionActions";

const listFetcher = vi.fn();

function Harness() {
  // Stands in for the Today list: a mounted reader of a recommendations key.
  useSWR("/analysis/recommendations?status=PENDING", listFetcher);
  return <DecisionActions id={7} onDecided={() => undefined} />;
}

function setup() {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <Harness />
    </SWRConfig>,
  );
}

describe("DecisionActions", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    listFetcher.mockReset().mockResolvedValue([]);
  });

  it("on 409 shows the detail and revalidates the recommendation data", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(409, "This recommendation was already decided or replaced."));
    setup();
    await waitFor(() => expect(listFetcher).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(await screen.findByText("This recommendation was already decided or replaced.")).toBeInTheDocument();
    await waitFor(() => expect(listFetcher).toHaveBeenCalledTimes(2));
  });

  it("on another error shows the message and does not revalidate", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(500, "Boom"));
    setup();
    await waitFor(() => expect(listFetcher).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(await screen.findByText("Boom")).toBeInTheDocument();
    expect(listFetcher).toHaveBeenCalledTimes(1);
  });
});
