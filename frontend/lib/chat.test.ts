import { describe, it, expect } from "vitest";
import { splitWebSection } from "./chat";

describe("splitWebSection", () => {
  it("returns the whole reply when there is no web section", () => {
    expect(splitWebSection("You hold 10 shares.")).toEqual({ body: "You hold 10 shares.", web: null });
  });

  it("splits at the From the web heading", () => {
    const reply = "You hold 10 shares.\n\n## From the web\n\nCoverage is positive.";
    expect(splitWebSection(reply)).toEqual({ body: "You hold 10 shares.", web: "Coverage is positive." });
  });

  it("shows no web box when the heading has nothing under it", () => {
    expect(splitWebSection("Answer.\n\n## From the web\n\n")).toEqual({ body: "Answer.", web: null });
  });

  it("keeps a reply that is only a web section", () => {
    expect(splitWebSection("## From the web\n\nNews.")).toEqual({ body: "", web: "News." });
  });

  it("tolerates a different case and a trailing colon in the heading", () => {
    expect(splitWebSection("Answer.\n\n## From the Web\n\nNews.")).toEqual({
      body: "Answer.",
      web: "News.",
    });
    expect(splitWebSection("Answer.\n\n## From the web:\n\nNews.")).toEqual({
      body: "Answer.",
      web: "News.",
    });
  });

  it("ignores a similar heading that is not exactly the web heading", () => {
    const reply = "## From the web page\n\ntext";
    expect(splitWebSection(reply)).toEqual({ body: reply, web: null });
  });
});
