import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AckCheckbox } from "./AckCheckbox";

describe("AckCheckbox", () => {
  it("is a named checkbox that reports the new value", () => {
    const onChange = vi.fn();
    render(<AckCheckbox checked={false} onChange={onChange} label="I understand." />);

    const box = screen.getByRole("checkbox", { name: "I understand." });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("reports false when a checked box is clicked", () => {
    const onChange = vi.fn();
    render(<AckCheckbox checked onChange={onChange} label="I understand." />);

    fireEvent.click(screen.getByRole("checkbox", { name: "I understand." }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("shows the checked state", () => {
    render(<AckCheckbox checked onChange={() => {}} label="I understand." />);
    expect(screen.getByRole("checkbox", { name: "I understand." })).toBeChecked();
  });
});
