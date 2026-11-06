import { test, expect, type Page } from "@playwright/test";
import { copyFile, mkdir, unlink, access, rm } from "node:fs/promises";
import path from "node:path";

const preview = path.resolve("app/recurring-test-preview/page.tsx");
let createdPreview = false;
test.beforeAll(async () => {
  // Never overwrite a user-created route.
  await expect(access(preview)).rejects.toThrow();
  await mkdir(path.dirname(preview), { recursive: true });
  await copyFile(path.resolve("e2e/fixtures/recurring-page.tsx"), preview);
  createdPreview = true;
});
test.afterAll(async () => {
  if (createdPreview) {
    await unlink(preview);
    // Next keeps a generated import for a removed development route.
    await rm(path.resolve(".next/dev/types/app/recurring-test-preview/page.ts"), { force: true });
  }
});

async function prepare(page: Page) {
  await page.clock.setFixedTime(new Date("2026-11-06T12:00:00+01:00"));
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const plans: Record<string, unknown>[] = [{
    id: 1, name: "SAP SE", ticker: "SAP.DE", asset_type: "STOCK", amount: "400.00", currency: "EUR",
    frequency: "monthly", interval_count: 1, interval_unit: "months", start_date: "2026-01-15",
    next_date: "2027-01-15", status: "active", tracking_enabled: true, upcoming_dates: ["2027-01-15"],
  }];
  const occurrences: Record<string, unknown>[] = [{
    id: 7, plan_id: 1, scheduled_date: "2026-10-15", ticker: "SAP.DE", asset_type: "STOCK",
    amount: "400.00", currency: "EUR", status: "posted", trade_id: 9, shares: "4.000000",
    price: "100.000000", quote_currency: "EUR", trade_date: "2026-10-15",
  }];
  await page.route("http://localhost:8000/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postData() ? req.postDataJSON() as Record<string, unknown> : {};
    calls.push({ path: url.pathname, method: req.method(), body });
    let result: unknown = {};
    if (url.pathname === "/portfolio/recurring") {
      if (req.method() === "POST") {
        const plan = { ...body, id: plans.length + 1, next_date: body.start_date, status: "active", tracking_enabled: true, upcoming_dates: [body.start_date] };
        plans.push(plan); result = plan;
      } else result = { plans, occurrences };
    } else if (url.pathname.endsWith("/preview")) {
      const past = String(body.start_date) < "2026-11-06";
      result = { upcoming_dates: ["2027-01-15"], catch_up_count: past ? 2 : 0,
        first_date: past ? "2026-01-15" : null, last_date: past ? "2026-02-15" : null,
        conflict: past && body.ticker === "SAP.DE" ? "Existing holdings or trades overlap. Start after today." : null };
    } else if (/recurring\/\d+\/status$/.test(url.pathname)) {
      const plan = plans.find((p) => p.id === Number(url.pathname.split("/").at(-2)));
      if (plan) Object.assign(plan, body); result = plan;
    } else if (url.pathname.endsWith("/estimate")) {
      Object.assign(occurrences[0], req.method() === "DELETE" ? { status: "voided" } : { ...body, status: "reconciled" });
      result = occurrences[0];
    } else if (url.pathname === "/market/search") {
      result = String(url.searchParams.get("q")).toUpperCase().includes("SAP")
        ? [{ symbol: "SAP.DE", name: "SAP SE", type: "STOCK", exchange: "GER" }]
        : [{ symbol: "CNDX.L", name: "iShares NASDAQ-100 UCITS ETF USD Accumulating Long Instrument Name", type: "ETF", exchange: "LSE" }];
    } else if (url.pathname === "/plans/orders/open") result = { open_lines: 0, plans: [] };
    else if (url.pathname === "/portfolio/summary") result = {};
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result),
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" } });
  });
  await page.goto("/recurring-test-preview");
  await expect(page.getByRole("heading", { name: "Portfolio browser fixture" })).toBeVisible();
  return calls;
}

async function startPlan(page: Page, ticker = "SAP.DE") {
  await page.getByRole("button", { name: "Add holding", exact: true }).click();
  await page.getByRole("button", { name: "Recurring", exact: true }).click();
  await page.getByLabel("Stock / ETF").fill(ticker);
  await page.getByRole("option").filter({ hasText: ticker }).click();
  await page.getByLabel("Contribution amount").fill(ticker === "SAP.DE" ? "400.00" : "300.00");
  await page.getByLabel("Start / anchor date").fill("2027-01-15");
}

async function noOverflow(page: Page) {
  const result = await page.getByRole("dialog").evaluate((element) => ({
    inner: element.scrollWidth, outer: element.clientWidth, right: element.getBoundingClientRect().right, viewport: window.innerWidth,
  }));
  expect(result.inner).toBeLessThanOrEqual(result.outer + 1);
  expect(result.right).toBeLessThanOrEqual(result.viewport + 1);
}

for (const width of [320, 390, 430, 1280]) {
  for (const theme of ["light", "dark"]) {
    test("recurring form fits " + width + "px in " + theme, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript((choice) => localStorage.setItem("theme-choice", choice), theme);
      const calls = await prepare(page);
      await startPlan(page, "CNDX.L");
      await page.evaluate((choice) => document.documentElement.setAttribute("data-theme", choice), theme);
      await expect(page.getByLabel(/Broker|Source|Employer/)).toHaveCount(0);
      await expect(page.getByText(/Purchases are estimated from market prices/)).toBeVisible();
      await noOverflow(page);
      await page.screenshot({ path: test.info().outputPath("recurring.png"), fullPage: true });
      await page.getByLabel("Frequency").selectOption("custom");
      await page.getByLabel(/^Every/).fill("2");
      await page.getByLabel("Interval", { exact: true }).selectOption("weeks");
      await page.getByRole("button", { name: "Preview schedule" }).click();
      await page.getByRole("button", { name: "Save recurring plan" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Saved locally in test" })).toBeVisible();
      expect(calls.some((c) => c.path === "/portfolio/holdings" && c.method === "POST")).toBe(false);
      expect(calls.find((c) => c.path === "/portfolio/recurring" && c.method === "POST")?.body)
        .toMatchObject({ ticker: "CNDX.L", asset_type: "ETF", amount: "300.00", currency: "EUR", frequency: "custom", interval_count: 2, interval_unit: "weeks", backfill: false });
    });
  }
}

test("SAP monthly plan, manual trade branch, and unheld plan management", async ({ page }) => {
  const calls = await prepare(page);
  await startPlan(page);
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await page.getByRole("button", { name: "Save recurring plan" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls.find((c) => c.path === "/portfolio/recurring" && c.method === "POST")?.body).toMatchObject({ ticker: "SAP.DE", amount: "400.00", frequency: "monthly" });
  await page.getByRole("button", { name: "Log a trade", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bought", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Recurring", exact: true }).click();
  await expect(page.getByLabel("Stock / ETF")).toHaveValue("SAP.DE");
  await page.getByRole("button", { name: "One-time", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sold", exact: true })).toBeVisible();
  await page.getByLabel("Shares", { exact: true }).fill("2");
  await page.getByLabel("Price", { exact: true }).fill("100");
  await page.getByLabel("Date", { exact: true }).fill("2026-11-05");
  await page.getByRole("button", { name: "Save to log" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls.find((c) => c.path === "/portfolio/trades" && c.method === "POST")?.body)
    .toMatchObject({ ticker: "SAP.DE", action: "BUY", shares: 2, price: 100, date: "2026-11-05" });
  await page.getByRole("button", { name: "Manage recurring plans" }).click();
  await expect(page.getByRole("dialog")).toContainText("SAP SE");
  await expect(page.getByRole("link", { name: "Recurring", exact: true })).toHaveCount(0);
});

test("backfill preview requires approval and refuses overlapping holdings", async ({ page }) => {
  const calls = await prepare(page);
  await startPlan(page, "CNDX.L");
  await page.getByLabel("Start / anchor date").fill("2026-01-15");
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(page.getByRole("alert")).toContainText("2 historical estimates");
  await page.getByRole("button", { name: "Save recurring plan" }).click();
  expect(calls.filter((c) => c.path === "/portfolio/recurring" && c.method === "POST")).toHaveLength(0);
  await page.getByLabel("Add these historical estimates to my portfolio").check();
  await page.getByRole("button", { name: "Save recurring plan" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls.find((c) => c.path === "/portfolio/recurring" && c.method === "POST")?.body.backfill).toBe(true);
  await startPlan(page);
  await page.getByLabel("Start / anchor date").fill("2026-01-15");
  await page.getByRole("button", { name: "Preview schedule" }).click();
  await expect(page.getByRole("alert")).toContainText("overlap");
  await expect(page.getByRole("button", { name: "Save recurring plan" })).toBeDisabled();
});

test("estimate correction, void and plan lifecycle retain audit history", async ({ page }) => {
  const calls = await prepare(page);
  await page.getByRole("button", { name: "Manage recurring plans" }).click();
  await expect(page.getByRole("dialog")).toContainText("Estimated purchase");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Correct estimate" }).click();
  await page.getByLabel("Shares").fill("3.9");
  await page.getByRole("button", { name: "Save actual details" }).click();
  await expect(page.getByRole("dialog")).toContainText("reconciled");
  await page.getByRole("button", { name: "Correct estimate" }).click();
  await page.getByRole("button", { name: "Void estimate", exact: true }).click();
  await page.getByRole("button", { name: "Confirm void estimate" }).click();
  await expect(page.getByRole("dialog")).toContainText("voided");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Confirm stop" }).click();
  await expect(page.getByRole("dialog")).toContainText("Stopped");
  expect(calls.filter((c) => c.path.endsWith("/estimate")).map((c) => c.method)).toEqual(["PUT", "DELETE"]);
});

test("one-time holding keeps the existing manual endpoint", async ({ page }) => {
  const calls = await prepare(page);
  await page.getByRole("button", { name: "Add holding", exact: true }).click();
  await page.getByLabel("Ticker", { exact: true }).fill("SAP.DE");
  await page.getByRole("option").filter({ hasText: "SAP.DE" }).click();
  await page.getByLabel("Shares", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save holding" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls.find((c) => c.path === "/portfolio/holdings" && c.method === "POST")?.body)
    .toMatchObject({ ticker: "SAP.DE", shares: 2, asset_type: "STOCK" });
  expect(calls.some((c) => c.path === "/portfolio/recurring" && c.method === "POST")).toBe(false);
});
