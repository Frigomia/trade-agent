import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Action } from "@/lib/api/recommendation-types";
import { ActionChip } from "./RecommendationCard";

const ACTIONS: Action[] = ["BUY", "ADD", "HOLD", "TRIM", "SELL", "WATCH"];

describe("ActionChip", () => {
  it.each(ACTIONS)("shows %s as the word with an icon", (action) => {
    const { container } = render(<ActionChip action={action} />);

    expect(screen.getByText(action)).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it.each(ACTIONS)("keeps %s neutral: no green, red or amber fill", (action) => {
    render(<ActionChip action={action} />);

    const chip = screen.getByText(action);
    expect(chip).toHaveStyle({ color: "var(--text)", backgroundColor: "var(--track)" });
  });
});
