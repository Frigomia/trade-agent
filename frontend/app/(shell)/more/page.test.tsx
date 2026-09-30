import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import MorePage from "./page";

describe("MorePage", () => {
  it("links to the four secondary sections and drops the placeholder text", () => {
    render(<MorePage />);
    const hrefs = {
      "Track record": "/more/track-record",
      Backtests: "/more/backtests",
      Preferences: "/more/preferences",
      Account: "/more/account",
    };
    for (const [name, href] of Object.entries(hrefs)) {
      expect(screen.getByRole("link", { name: new RegExp(name, "i") })).toHaveAttribute("href", href);
    }
    expect(screen.queryByText(/coming in sub-project/i)).not.toBeInTheDocument();
  });
});
