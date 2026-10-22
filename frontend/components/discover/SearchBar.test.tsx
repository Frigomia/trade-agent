import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { SymbolMatch } from "@/lib/tickerSearch";
import { SearchBar } from "./SearchBar";

const match = (symbol: string, name = `${symbol} Corp`): SymbolMatch => ({ symbol, name, type: "STOCK", exchange: "NASDAQ" });

function show(
  over: { query?: string; matches?: SymbolMatch[]; answered?: boolean; searching?: boolean; have?: string[]; problem?: string | null } = {},
) {
  const props = {
    onQuery: vi.fn(),
    onAdd: vi.fn(),
    inputRef: createRef<HTMLInputElement>(),
  };
  render(
    <SearchBar
      query={over.query ?? ""}
      matches={over.matches ?? []}
      answered={over.answered ?? false}
      searching={over.searching ?? false}
      have={new Set(over.have ?? [])}
      problem={over.problem ?? null}
      {...props}
    />,
  );
  return props;
}

const input = () => screen.getByRole("textbox", { name: "Search a company by name or ticker" });

describe("SearchBar", () => {
  it("says what is filled in and what is not needed, until something is typed", () => {
    show();

    expect(screen.getByText(/We fill in the name, exchange and currency. No shares or purchase price needed, unlike Add holding/)).toBeInTheDocument();
    expect(input()).toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("list", { name: "Search results" })).not.toBeInTheDocument();
  });

  it("lists matches with their name, ticker and exchange, each with Add", () => {
    const { onAdd } = show({ query: "hal", answered: true, matches: [match("HLDN", "Halden Systems"), match("HLST", "Halstead Marine")] });

    const results = screen.getByRole("list", { name: "Search results" });
    expect(within(results).getByText("Halden Systems")).toBeInTheDocument();
    expect(within(results).getByText("HLDN · NASDAQ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Halstead Marine to Discover" }));
    expect(onAdd).toHaveBeenCalledWith(match("HLST", "Halstead Marine"));
  });

  it("shows Already in Discover in place of Add for a company already in the list, whatever the case", () => {
    show({ query: "hal", answered: true, matches: [match("HLDN", "Halden Systems")], have: ["HLDN"] });

    expect(screen.getByText("Already in Discover")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add Halden Systems/ })).not.toBeInTheDocument();
  });

  it("says no company was found, and what to check", () => {
    show({ query: "zzzz", answered: true, matches: [] });

    expect(screen.getByText("No company found for “zzzz”")).toBeInTheDocument();
    expect(screen.getByText(/Check the spelling, or try the ticker/)).toBeInTheDocument();
  });

  it("says it is searching before the answer arrives, never no result yet", () => {
    show({ query: "hal", searching: true });

    expect(screen.getByText("Searching…")).toBeInTheDocument();
    expect(screen.queryByText(/No company found/)).not.toBeInTheDocument();
  });

  it("shows nothing for one character", () => {
    show({ query: "h" });

    expect(screen.queryByRole("list", { name: "Search results" })).not.toBeInTheDocument();
  });

  it("Enter adds the first result that is not already there", () => {
    const { onAdd } = show({ query: "hal", answered: true, matches: [match("HLDN"), match("HLST")], have: ["HLDN"] });

    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onAdd).toHaveBeenCalledWith(match("HLST"));
  });

  it("Enter adds nothing when every result is already in the list", () => {
    const { onAdd } = show({ query: "hal", answered: true, matches: [match("HLDN")], have: ["HLDN"] });

    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onAdd).not.toHaveBeenCalled();
  });

  it("Escape clears the search", () => {
    const { onQuery } = show({ query: "hal" });

    fireEvent.keyDown(input(), { key: "Escape" });

    expect(onQuery).toHaveBeenCalledWith("");
  });

  it("Add company adds the first new result, or focuses the search when nothing is typed", () => {
    const first = show({ query: "hal", answered: true, matches: [match("HLDN")] });
    fireEvent.click(screen.getByRole("button", { name: "Add company" }));
    expect(first.onAdd).toHaveBeenCalledWith(match("HLDN"));
  });

  it("Add company with nothing typed focuses the field and adds nothing", () => {
    const { onAdd } = show();

    fireEvent.click(screen.getByRole("button", { name: "Add company" }));

    expect(onAdd).not.toHaveBeenCalled();
    expect(input()).toHaveFocus();
  });

  it("shows why an add failed", () => {
    show({ problem: "You can have at most 100 companies." });

    expect(screen.getByRole("alert")).toHaveTextContent("You can have at most 100 companies.");
  });

  it("types into the search", () => {
    const { onQuery } = show();

    fireEvent.change(input(), { target: { value: "halden" } });

    expect(onQuery).toHaveBeenCalledWith("halden");
  });
});
