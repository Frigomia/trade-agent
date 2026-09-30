import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";

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
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: FakeApiError,
}));

import PreferencesPage from "./page";

function renderFresh() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <PreferencesPage />
    </SWRConfig>,
  );
}

const LOADED = { risk_tolerance: "moderate", sector_avoid_list: ["Energy"], notes: "long term" };

describe("PreferencesPage", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === "POST" ? JSON.parse(String(init.body)) : LOADED,
    );
  });

  it("loads the saved values and says preferences never change the score", async () => {
    renderFresh();
    expect(await screen.findByDisplayValue("long term")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /moderate/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Energy")).toBeInTheDocument();
    expect(screen.getByText(/never change the score or the call/i)).toBeInTheDocument();
  });

  it("adds a sector once even with different case and stray spaces", async () => {
    renderFresh();
    await screen.findByText("Energy");
    const input = screen.getByLabelText(/add a sector/i);
    fireEvent.change(input, { target: { value: "  energy " } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getAllByText(/^energy$/i)).toHaveLength(1);
    fireEvent.change(input, { target: { value: "Tobacco" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByText("Tobacco")).toBeInTheDocument();
  });

  it("limits a sector name to 50 characters", async () => {
    renderFresh();
    const input = await screen.findByLabelText(/add a sector/i);
    expect(input).toHaveAttribute("maxlength", "50");
  });

  it("disables Add and says why once 20 sectors are listed", async () => {
    const twenty = Array.from({ length: 20 }, (_, n) => `Sector ${n}`);
    apiFetch.mockImplementation(async () => ({ ...LOADED, sector_avoid_list: twenty }));
    renderFresh();
    await screen.findByText("Sector 0");
    expect(screen.getByRole("button", { name: /^add$/i })).toBeDisabled();
    expect(screen.getByText(/at most 20 sectors/i)).toBeInTheDocument();
  });

  it("removes a sector chip", async () => {
    renderFresh();
    fireEvent.click(await screen.findByRole("button", { name: /remove energy/i }));
    expect(screen.queryByText("Energy")).not.toBeInTheDocument();
  });

  it("caps the notes at 2000 characters and shows a counter", async () => {
    renderFresh();
    const notes = await screen.findByLabelText(/notes/i);
    fireEvent.change(notes, { target: { value: "x".repeat(2500) } });
    expect((notes as HTMLTextAreaElement).value).toHaveLength(2000);
    expect(screen.getByText("2000 / 2000")).toBeInTheDocument();
  });

  it("saves the full object even when only notes changed", async () => {
    renderFresh();
    const notes = await screen.findByLabelText(/notes/i);
    fireEvent.change(notes, { target: { value: "changed" } });
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith("/preferences", {
        method: "POST",
        body: JSON.stringify({ risk_tolerance: "moderate", sector_avoid_list: ["Energy"], notes: "changed" }),
      }),
    );
    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });

  it("shows the API detail when saving fails", async () => {
    renderFresh();
    const notes = await screen.findByLabelText(/notes/i);
    apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new FakeApiError(422, "Notes too long");
      return LOADED;
    });
    fireEvent.change(notes, { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));
    expect(await screen.findByText("Notes too long")).toBeInTheDocument();
  });

  it("shows an error when preferences cannot load", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(500, "boom"));
    renderFresh();
    expect(await screen.findByText(/could not load your preferences/i)).toBeInTheDocument();
  });
});
