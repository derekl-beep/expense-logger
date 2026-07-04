import { expect, test } from "@playwright/test";
import { login } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await login(page);
});

// The e2e backend always runs with ANTHROPIC_API_KEY=dummy, so every chat
// call fails fast and the server returns its generic error payload — see
// chat_stream_endpoint's `except Exception` handler in api/server.py. That
// makes the error-display path the only deterministically testable outcome
// here; a real AI response can't be exercised in this environment.

test("sending a message shows the user bubble immediately, then an agent error", async ({ page }) => {
  await page.getByPlaceholder("e.g. $5 coffee today").fill("test message");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("test message", { exact: true })).toBeVisible();
  await expect(page.getByText("Something went wrong. Please try again.")).toBeVisible();
});

test("clicking a suggestion chip sends its prompt as a user message", async ({ page }) => {
  await page.getByRole("button", { name: "Summarize this month" }).click();

  await expect(page.getByText("Summarize this month", { exact: true })).toBeVisible();
  await expect(page.getByText("Something went wrong. Please try again.")).toBeVisible();
});

test("the first-run capability cards are shown, and clicking them acts without sending a message", async ({ page }) => {
  await expect(page.getByRole("button", { name: /Snap a receipt/ })).toBeVisible();
  await expect(page.getByText("Just type it naturally")).toBeVisible();

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: /Snap a receipt/ }).click(),
  ]);
  expect(fileChooser).toBeTruthy();

  await page.getByRole("button", { name: /Ask about your spending/ }).click();
  await expect(page.getByPlaceholder("e.g. $5 coffee today")).toHaveValue("/");
  await expect(page.getByRole("button", { name: "Summarize this month /summary" })).toBeVisible();
});

test("clicking New chat resets the conversation to the initial welcome message", async ({ page }) => {
  await page.getByPlaceholder("e.g. $5 coffee today").fill("hello there");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Something went wrong. Please try again.")).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).click();

  await expect(page.getByText("hello there", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Hi! Log an expense or ask about your spending.")).toBeVisible();
});

test("an error mid-stream keeps the partial answer instead of wiping it", async ({ page }) => {
  // Mock the SSE stream directly so we can deterministically simulate a
  // real backend (some text already streamed) hitting an error partway
  // through, independent of the dummy-API-key failure mode used elsewhere
  // in this file (which fails before any text streams).
  await page.route("**/chat/stream", async (route) => {
    const body = [
      `data: ${JSON.stringify({ text: "Your dining spend so far is $42. " })}`,
      `data: ${JSON.stringify({ error: "Something went wrong. Please try again." })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });

  await page.getByPlaceholder("e.g. $5 coffee today").fill("how much on dining?");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Your dining spend so far is $42.", { exact: false })).toBeVisible();
  await expect(page.getByText("Something went wrong. Please try again.")).toBeVisible();
});

test("a category breakdown tool result renders as a rich card, not a markdown table", async ({ page }) => {
  await page.route("**/chat/stream", async (route) => {
    const breakdown = {
      breakdown: [
        { category: "Dining", total: 120.5, count: 4, pct: 60.3 },
        { category: "Groceries", total: 79.25, count: 2, pct: 39.7 },
      ],
      grand_total: 199.75,
    };
    const body = [
      `data: ${JSON.stringify({ breakdown })}`,
      `data: ${JSON.stringify({ text: "Here's your breakdown." })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    await route.fulfill({ status: 200, contentType: "text/event-stream", body });
  });

  await page.getByPlaceholder("e.g. $5 coffee today").fill("summarize this month");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Here's your breakdown.")).toBeVisible();
  await expect(page.getByText("Dining", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Groceries", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("$121", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("$199.75", { exact: true })).toBeVisible();
});

test("typing / opens a command palette that filters as you type and sends on click", async ({ page }) => {
  const input = page.getByPlaceholder("e.g. $5 coffee today");

  await input.fill("/");
  await expect(page.getByText("/summary", { exact: true })).toBeVisible();
  await expect(page.getByText("/recurring", { exact: true })).toBeVisible();

  await input.fill("/budg");
  await expect(page.getByText("/budget", { exact: true })).toBeVisible();
  await expect(page.getByText("/summary", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Budget status /budget" }).click();

  await expect(input).toHaveValue("");
  await expect(page.getByText("Budget status", { exact: true })).toBeVisible();
});

test("arrow-key navigation re-clamps when the filtered list shrinks then grows back", async ({ page }) => {
  const input = page.getByPlaceholder("e.g. $5 coffee today");
  await input.fill("/");
  for (let i = 0; i < 5; i++) await input.press("ArrowDown");

  // Narrow to a single match, then press ArrowUp — a no-op on a one-item list.
  await input.fill("/yoy");
  await expect(page.getByRole("button", { name: "Year over year /yoy" })).toBeVisible();
  await input.press("ArrowUp");

  // Widen back to the full list: the highlighted row must be the first one
  // (index re-clamped by the ArrowUp fix), not wherever a stale raw index
  // from before narrowing would land.
  await input.fill("/");
  const firstRow = page.locator("button", { hasText: "/summary" });
  await expect(firstRow).toHaveClass(/bg-muted/);
});

test("Escape clears the input and closes the command palette", async ({ page }) => {
  const input = page.getByPlaceholder("e.g. $5 coffee today");
  await input.fill("/sum");
  await expect(page.getByText("/summary", { exact: true })).toBeVisible();

  await input.press("Escape");

  await expect(input).toHaveValue("");
  await expect(page.getByText("/summary", { exact: true })).toHaveCount(0);
});

test("attaching an image shows a preview thumbnail that can be removed", async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    ),
  });

  const previewWrapper = page.locator("div.relative.inline-block");
  await expect(previewWrapper.locator('img[alt="preview"]')).toBeVisible();

  await previewWrapper.locator("button").click();
  await expect(page.locator('img[alt="preview"]')).toHaveCount(0);
});
