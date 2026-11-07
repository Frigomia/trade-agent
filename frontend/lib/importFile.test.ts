import { describe, it, expect } from "vitest";
import { MAX_IMPORT_BYTES, describeCounts, readImportFile } from "./importFile";

const file = (text: string) => new File([text], "export.json", { type: "application/json" });

describe("readImportFile", () => {
  it("rejects_a_body_over_5mb_once_the_ai_output_is_removed", async () => {
    const holdings = [{ ticker: "AAPL", name: "a".repeat(MAX_IMPORT_BYTES) }];
    await expect(readImportFile(file(JSON.stringify({ holdings })))).rejects.toThrow(
      "That file is too large to import.",
    );
  });

  it("rejects_a_file_over_the_loose_raw_cap_without_reading_it", async () => {
    const huge = file("{}");
    Object.defineProperty(huge, "size", { value: 101 * 1024 * 1024 });
    await expect(readImportFile(huge)).rejects.toThrow("That file is too large to import.");
  });

  it("rejects_text_that_is_not_json", async () => {
    await expect(readImportFile(file("not json"))).rejects.toThrow("That is not a trade-agent export file.");
  });

  it("rejects_a_json_array", async () => {
    await expect(readImportFile(file("[1, 2]"))).rejects.toThrow("That is not a trade-agent export file.");
  });

  it("rejects_json_null", async () => {
    await expect(readImportFile(file("null"))).rejects.toThrow("That is not a trade-agent export file.");
  });

  it("returns_the_valid_object_as_compact_json", async () => {
    await expect(readImportFile(file('{ "holdings": [] }'))).resolves.toBe('{"holdings":[]}');
  });

  it("sends_only_the_restorable_part", async () => {
    const chat = Array.from({ length: 50 }, (_, i) => ({ id: i, content: "x".repeat(100) }));
    const text = JSON.stringify({
      format_version: 1,
      profile: { email: "a@b.c" },
      telegram: { linked: true },
      chat_messages: chat,
      recommendations: [{ id: 1 }],
      holdings: [{ ticker: "AAPL" }],
      investment_preferences: { notes: "n" },
    });
    const body = JSON.parse(await readImportFile(file(text)));
    expect(Object.keys(body).sort()).toEqual(["format_version", "holdings", "investment_preferences"]);
    expect(body.holdings).toEqual([{ ticker: "AAPL" }]);
  });

  it("accepts_a_file_over_5mb_only_because_of_ai_output", async () => {
    const text = JSON.stringify({
      format_version: 1,
      holdings: [{ ticker: "AAPL" }],
      chat_messages: [{ content: "x".repeat(MAX_IMPORT_BYTES + 1) }],
    });
    expect(text.length).toBeGreaterThan(MAX_IMPORT_BYTES);
    await expect(readImportFile(file(text))).resolves.toBe('{"format_version":1,"holdings":[{"ticker":"AAPL"}]}');
  });
});

describe("describeCounts", () => {
  it("labels_the_counts_and_hides_zeros", () => {
    expect(describeCounts({ holdings: 3, watchlist_items: 1, trades: 0, portfolio_snapshots: 12 })).toEqual([
      "3 holdings",
      "1 watchlist companies",
      "12 saved daily values",
    ]);
  });

  it("uses_the_human_label_for_every_key", () => {
    const all = {
      holdings: 1,
      watchlist_items: 1,
      trades: 1,
      portfolio_snapshots: 1,
      investment_preferences: 1,
      contribution_plans: 1,
      recurring_investments: 1,
      recurring_occurrences: 1,
    };
    expect(describeCounts(all)).toEqual([
      "1 holdings",
      "1 watchlist companies",
      "1 trades",
      "1 saved daily values",
      "1 preferences",
      "1 saved plans",
      "1 recurring plans",
      "1 recurring entries",
    ]);
  });

  it("returns_nothing_for_an_empty_result", () => {
    expect(describeCounts({})).toEqual([]);
  });
});
