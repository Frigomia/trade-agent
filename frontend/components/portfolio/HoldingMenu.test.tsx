import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HoldingMenu } from "./HoldingMenu";

function show() {
  const calls = { edit: vi.fn(), trade: vi.fn(), remove: vi.fn() };
  render(<HoldingMenu ticker="HLDN" onEdit={calls.edit} onLogTrade={calls.trade} onRemove={calls.remove} />);
  return calls;
}

describe("HoldingMenu", () => {
  it("is one button named for the holding, closed until it is pressed", () => {
    show();

    const button = screen.getByRole("button", { name: "Actions for HLDN" });
    expect(button).toHaveAttribute("aria-haspopup", "menu");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("offers edit, log a trade and remove", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Actions for HLDN" }));

    // The open menu hides the rest of the page from assistive tech, so find the button by its label.
    expect(screen.getByLabelText("Actions for HLDN")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Edit holding", "Log a trade", "Remove holding"]);
  });

  it.each([
    ["Edit holding", "edit"],
    ["Log a trade", "trade"],
    ["Remove holding", "remove"],
  ] as const)("%s runs its action once and closes the menu", async (name, key) => {
    const calls = show();
    fireEvent.click(screen.getByRole("button", { name: "Actions for HLDN" }));

    fireEvent.click(screen.getByRole("menuitem", { name }));

    expect(calls[key]).toHaveBeenCalledTimes(1);
    for (const other of Object.keys(calls).filter((k) => k !== key)) expect(calls[other as keyof typeof calls]).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("closes on Escape without doing anything", async () => {
    const calls = show();
    fireEvent.click(screen.getByRole("button", { name: "Actions for HLDN" }));

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    expect(calls.edit).not.toHaveBeenCalled();
    expect(calls.remove).not.toHaveBeenCalled();
  });
});
