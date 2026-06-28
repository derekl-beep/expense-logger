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

test("clicking New chat resets the conversation to the initial welcome message", async ({ page }) => {
  await page.getByPlaceholder("e.g. $5 coffee today").fill("hello there");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Something went wrong. Please try again.")).toBeVisible();

  await page.getByRole("button", { name: "New chat" }).click();

  await expect(page.getByText("hello there", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Hi! Log an expense or ask about your spending.")).toBeVisible();
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
