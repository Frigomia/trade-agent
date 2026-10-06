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

  describe("automatic analysis switch", () => {
    const LABEL = "Analyze my portfolio automatically each weekday";
    const posts = () => apiFetch.mock.calls.filter((c) => c[1]?.method === "POST");

    it("is off by default and always shows the explanation", async () => {
      renderFresh();
      const sw = await screen.findByRole("switch", { name: LABEL });
      expect(sw).not.toBeChecked();
      expect(
        screen.getByText("Runs once each weekday morning and counts as one run of your monthly limit."),
      ).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("sends only auto_analysis, leaves the saved fields as they are, and keeps the draft", async () => {
      let server: Record<string, unknown> = { ...LOADED, auto_analysis: false, auto_analysis_paused: null };
      apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => {
        if (init?.method === "POST") server = { ...server, ...JSON.parse(String(init.body)) };
        return server;
      });
      renderFresh();
      const notes = await screen.findByLabelText(/notes/i);
      fireEvent.change(notes, { target: { value: "unsaved draft" } });
      fireEvent.click(screen.getByRole("button", { name: /remove energy/i }));
      fireEvent.click(screen.getByRole("switch", { name: LABEL }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect(JSON.parse(posts()[0][1].body)).toEqual({ auto_analysis: true });
      // the server keeps what it had saved (it applies only the fields sent)
      expect(server).toMatchObject({ risk_tolerance: "moderate", sector_avoid_list: ["Energy"], notes: "long term" });
      await waitFor(() => expect(screen.getByRole("switch", { name: LABEL })).toBeChecked());
      expect(screen.getByLabelText(/notes/i)).toHaveValue("unsaved draft");
      expect(screen.queryByText("Energy")).not.toBeInTheDocument();
    });

    it("disables the switch while the save is in flight", async () => {
      let finish: (v: unknown) => void = () => {};
      apiFetch.mockImplementation((_p: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Promise.resolve({ ...LOADED, auto_analysis: false, auto_analysis_paused: null }),
      );
      renderFresh();
      fireEvent.click(await screen.findByRole("switch", { name: LABEL }));
      await waitFor(() => expect(screen.getByRole("switch", { name: LABEL })).toBeDisabled());
      fireEvent.click(screen.getByRole("switch", { name: LABEL }));
      expect(posts()).toHaveLength(1);
      finish({});
      await waitFor(() => expect(screen.getByRole("switch", { name: LABEL })).toBeEnabled());
    });

    it("says the limit is 0 instead of 'all 0 runs'", async () => {
      const paused = { reason: "limit", limit: 0, resumes_on: "2026-11-01" };
      apiFetch.mockImplementation(async () => ({ ...LOADED, auto_analysis: true, auto_analysis_paused: paused }));
      renderFresh();
      const line = await screen.findByRole("status");
      expect(line).toHaveTextContent("Paused: your monthly limit is 0 runs.");
      expect(line).not.toHaveTextContent(/used all/);
      expect(line).not.toHaveTextContent(/resumes on/);
    });

    it("Save preferences leaves the switch alone", async () => {
      apiFetch.mockImplementation(async (_p: string, init?: RequestInit) =>
        init?.method === "POST" ? JSON.parse(String(init.body)) : { ...LOADED, auto_analysis: true, auto_analysis_paused: null },
      );
      renderFresh();
      fireEvent.change(await screen.findByLabelText(/notes/i), { target: { value: "n" } });
      fireEvent.click(screen.getByRole("button", { name: /save preferences/i }));
      await waitFor(() => expect(posts()).toHaveLength(1));
      expect("auto_analysis" in JSON.parse(posts()[0][1].body)).toBe(false);
    });

    it("restores the switch and shows the error when the save fails", async () => {
      renderFresh();
      const sw = await screen.findByRole("switch", { name: LABEL });
      apiFetch.mockImplementation(async (_p: string, init?: RequestInit) => {
        if (init?.method === "POST") throw new FakeApiError(500, "Could not save");
        return LOADED;
      });
      fireEvent.click(sw);
      expect(await screen.findByText("Could not save")).toBeInTheDocument();
      expect(screen.getByRole("switch", { name: LABEL })).not.toBeChecked();
    });

    it("shows the limit pause with a long local date, only while on", async () => {
      const paused = { reason: "limit", limit: 100, resumes_on: "2026-11-01" };
      apiFetch.mockImplementation(async () => ({ ...LOADED, auto_analysis: true, auto_analysis_paused: paused }));
      renderFresh();
      const line = await screen.findByRole("status");
      const date = new Date(2026, 10, 1).toLocaleDateString(undefined, {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
      expect(line).toHaveTextContent(`Paused: you have used all 100 runs this month. It resumes on ${date}.`);
    });

    it("hides the pause line when the switch is off", async () => {
      const paused = { reason: "limit", limit: 100, resumes_on: "2026-11-01" };
      apiFetch.mockImplementation(async () => ({ ...LOADED, auto_analysis: false, auto_analysis_paused: paused }));
      renderFresh();
      await screen.findByRole("switch", { name: LABEL });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("links to the Claude key page when paused for no key", async () => {
      apiFetch.mockImplementation(async () => ({
        ...LOADED,
        auto_analysis: true,
        auto_analysis_paused: { reason: "no_key", limit: null, resumes_on: null },
      }));
      renderFresh();
      const line = await screen.findByRole("status");
      expect(line).toHaveTextContent("Paused: connect your Claude key to turn this on.");
      expect(screen.getByRole("link", { name: "connect your Claude key" })).toHaveAttribute(
        "href",
        "/more/connect-claude",
      );
    });
  });

  it("shows an error when preferences cannot load", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(500, "boom"));
    renderFresh();
    expect(await screen.findByText(/could not load your preferences/i)).toBeInTheDocument();
  });
});
