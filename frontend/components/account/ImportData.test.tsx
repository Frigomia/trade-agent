import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
const mutate = vi.fn();
vi.mock("swr", () => ({ mutate: (...a: unknown[]) => mutate(...a) }));

import { ImportData } from "./ImportData";

const TEXT = '{"holdings":[{"ticker":"AAPL"}]}';
const preview = {
  dry_run: true,
  restored: { holdings: 2, watchlist_items: 3, trades: 0 },
  skipped: [],
  next_steps: [],
};
const done = {
  dry_run: false,
  restored: { holdings: 2, watchlist_items: 3, trades: 0 },
  skipped: ["Preferences were kept because this account already has some."],
  next_steps: ["Connect Telegram again.", "Connect your Claude key again."],
};

function choose(text: string) {
  const input = screen.getByTestId("import-file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([text], "export.json", { type: "application/json" })] } });
}

describe("ImportData", () => {
  beforeEach(() => {
    apiFetch.mockReset();
    mutate.mockReset();
  });

  it("choosing_a_file_runs_a_dry_run_and_shows_the_counts", async () => {
    apiFetch.mockResolvedValue(preview);
    render(<ImportData />);
    choose(TEXT);
    expect(await screen.findByText("2 holdings")).toBeInTheDocument();
    expect(screen.getByText("3 watchlist companies")).toBeInTheDocument();
    expect(screen.queryByText(/trades/)).not.toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/me/import?dry_run=true", { method: "POST", body: TEXT });
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("confirming_sends_the_same_file_without_dry_run", async () => {
    apiFetch.mockResolvedValueOnce(preview).mockResolvedValueOnce(done);
    render(<ImportData />);
    choose(TEXT);
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    await screen.findByText("Restored:");
    expect(apiFetch).toHaveBeenLastCalledWith("/me/import", { method: "POST", body: TEXT });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][1]).toBeUndefined();
    expect(mutate.mock.calls[0][2]).toEqual({ revalidate: true });
  });

  it("a_refusal_shows_the_server_message_and_no_restore_button", async () => {
    apiFetch.mockRejectedValue(new FakeApiError(409, "This account already has data, so it cannot be restored into."));
    render(<ImportData />);
    choose(TEXT);
    expect(await screen.findByRole("alert")).toHaveTextContent("This account already has data");
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("a_bad_file_never_calls_the_server", async () => {
    render(<ImportData />);
    choose("not json");
    expect(await screen.findByRole("alert")).toHaveTextContent("That is not a trade-agent export file.");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("cancel_returns_to_idle", async () => {
    apiFetch.mockResolvedValue(preview);
    render(<ImportData />);
    choose(TEXT);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.queryByText("2 holdings")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import my data" })).toBeEnabled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("the_result_lists_skipped_and_next_steps", async () => {
    apiFetch.mockResolvedValueOnce(preview).mockResolvedValueOnce(done);
    render(<ImportData />);
    choose(TEXT);
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Restored:")).toBeInTheDocument();
    expect(screen.getByText("2 holdings")).toBeInTheDocument();
    expect(screen.getByText(/Preferences were kept/)).toBeInTheDocument();
    expect(screen.getByText("Connect Telegram again.")).toBeInTheDocument();
    expect(screen.getByText("Connect your Claude key again.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("the_preview_shows_what_will_be_skipped_before_restore", async () => {
    apiFetch.mockResolvedValue({
      ...preview,
      skipped: ["Your current preferences were kept.", "Automatic analysis and automatic discovery were left off."],
    });
    render(<ImportData />);
    choose(TEXT);
    expect(await screen.findByText("Your current preferences were kept.")).toBeInTheDocument();
    expect(screen.getByText(/Automatic analysis and automatic discovery were left off/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("a_failed_restore_after_a_good_preview_shows_the_error_and_stays_usable", async () => {
    apiFetch
      .mockResolvedValueOnce(preview)
      .mockRejectedValueOnce(new FakeApiError(422, "This file could not be restored. Nothing was changed."))
      .mockResolvedValueOnce(preview);
    render(<ImportData />);
    choose(TEXT);
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was changed.");
    expect(screen.queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import my data" })).toBeEnabled();
    expect(mutate).not.toHaveBeenCalled();

    choose(TEXT); // the app still works: another file can be chosen
    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
  });

  it("the_button_is_disabled_while_a_request_runs", async () => {
    let finish: (v: unknown) => void = () => {};
    apiFetch.mockReturnValue(new Promise((r) => (finish = r)));
    render(<ImportData />);
    choose(TEXT);
    await waitFor(() => expect(screen.getByRole("button", { name: "Import my data" })).toBeDisabled());
    finish(preview);
    await screen.findByRole("button", { name: "Restore" });
    expect(screen.getByRole("button", { name: "Import my data" })).toBeEnabled();
  });
});
