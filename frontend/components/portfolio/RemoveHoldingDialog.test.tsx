import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HoldingSummary } from "@/lib/api/portfolio-types";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  ApiError: class extends Error {},
}));

import { RemoveHoldingDialog } from "./RemoveHoldingDialog";

const HOLDING = { ticker: "BRK.B", name: "Berkshire Hathaway" } as HoldingSummary;

function show(holding: HoldingSummary | null = HOLDING, open = true) {
  const onClose = vi.fn();
  const onRemoved = vi.fn();
  const view = render(<RemoveHoldingDialog holding={holding} open={open} onClose={onClose} onRemoved={onRemoved} />);
  return { onClose, onRemoved, view };
}

describe("RemoveHoldingDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiFetch.mockResolvedValue(undefined);
  });

  it("says what removing does and that it sells nothing", () => {
    show();

    expect(screen.getByRole("dialog")).toHaveTextContent("Remove BRK.B?");
    expect(screen.getByText(/removes Berkshire Hathaway from your portfolio, with its shares and purchase details/i)).toBeInTheDocument();
    expect(screen.getByText(/does not sell anything/i)).toBeInTheDocument();
  });

  it("says a sold-out holding is removed from the closed positions, with no shares to remove", () => {
    show({ ...HOLDING, shares: 0 });

    expect(screen.getByText(/removes Berkshire Hathaway from your closed positions, with its purchase details/i)).toBeInTheDocument();
    expect(screen.queryByText(/its shares/i)).not.toBeInTheDocument();
  });

  it("is closed for no holding, and while open is false", () => {
    show(null);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps its text while it fades out after open turns false", async () => {
    const { view, onClose, onRemoved } = show();
    view.rerender(<RemoveHoldingDialog holding={HOLDING} open={false} onClose={onClose} onRemoved={onRemoved} />);

    // MUI keeps the content mounted through the exit transition: it must not have blanked.
    expect(screen.queryByText("Remove BRK.B?")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("cannot be dismissed, by Keep it or Escape, while the removal is running", async () => {
    let finish: () => void = () => {};
    apiFetch.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const { onClose, onRemoved } = show();

    fireEvent.click(screen.getByRole("button", { name: "Remove holding" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Keep it" })).toBeDisabled());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it("Keep it closes without a request", () => {
    const { onClose, onRemoved } = show();

    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));

    expect(onClose).toHaveBeenCalled();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("removes the holding by its encoded ticker, then refreshes and closes", async () => {
    const { onClose, onRemoved } = show();

    fireEvent.click(screen.getByRole("button", { name: "Remove holding" }));

    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(apiFetch).toHaveBeenCalledWith("/portfolio/holdings/BRK.B", { method: "DELETE" });
    expect(onClose).toHaveBeenCalled();
  });

  it("encodes a ticker with a caret or a slash", async () => {
    show({ ticker: "^GSPC", name: "S&P 500" } as HoldingSummary);

    fireEvent.click(screen.getByRole("button", { name: "Remove holding" }));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith("/portfolio/holdings/%5EGSPC", { method: "DELETE" }));
  });

  it("stays open and says why when the removal fails", async () => {
    apiFetch.mockRejectedValue(new Error("boom"));
    const { onClose, onRemoved } = show();

    fireEvent.click(screen.getByRole("button", { name: "Remove holding" }));

    expect(await screen.findByText("Something went wrong.")).toBeInTheDocument();
    expect(onRemoved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove holding" })).toBeEnabled();
  });
});
