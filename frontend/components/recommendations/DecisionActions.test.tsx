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
    fireEvent.click(screen.getByRole("button", { name: /skip reason and dismiss/i }));
    expect(await screen.findByText("Boom")).toBeInTheDocument();
    expect(listFetcher).toHaveBeenCalledTimes(1);
  });

  it("opens without deciding, submits a reason, and resets after cancel", async () => {
    const onDecided = vi.fn();
    apiFetch.mockResolvedValue({ id: 7, status: "REJECTED", dismissal_reason: "Too much tech" });
    render(<DecisionActions id={7} onDecided={onDecided} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "discard me" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("textbox", { name: /reason/i })).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "Too much tech" } });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss idea" }));
    await waitFor(() => expect(onDecided).toHaveBeenCalledWith(expect.objectContaining({ dismissal_reason: "Too much tech" })));
    expect(apiFetch).toHaveBeenCalledWith("/analysis/recommendations/7/reject", {
      method: "POST", body: JSON.stringify({ reason: "Too much tech" }),
    });
  });

  it("keeps the reason and error in the sheet after a failed save", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(422, "Invalid reason"));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    fireEvent.change(screen.getByRole("textbox", { name: /reason/i }), { target: { value: "Keep me" } });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss idea" }));
    expect(await screen.findByText("Invalid reason")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /reason/i })).toHaveValue("Keep me");
  });
});
