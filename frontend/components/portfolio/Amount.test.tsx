import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Amount } from "./Amount";

describe("Amount", () => {
  it("sizes the whole part in rem and the dimmed decimals at 68% of it", () => {
    const { container } = render(<Amount value={48250.32} size={32} />);
    const whole = container.firstElementChild as HTMLElement;
    const decimals = whole.firstElementChild as HTMLElement;

    expect(whole.style.fontSize).toBe("2rem");
    expect(decimals.style.fontSize).toBe("1.375rem"); // round(32 * 0.68) = 22px
    expect(whole.textContent).toBe("48,250.32");
  });

  it("leaves the size alone when none is given", () => {
    const { container } = render(<Amount value={12.5} />);

    expect((container.firstElementChild as HTMLElement).style.fontSize).toBe("");
  });
});
