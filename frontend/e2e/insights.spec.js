import { expect, test } from "@playwright/test";
import { login } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await login(page);
});

// Seed data (scripts/seed_e2e_data.py) deliberately puts Dining and Driving
// over budget, Health right at the 80% "near" threshold, Groceries safely
// under, and Travel budgeted with zero spend — so the insights banner has a
// fixed, known shape to assert against.

test("shows a dismissible insight for each category at or over budget", async ({ page }) => {
  const banner = page.locator("div").filter({ hasText: "is at" }).first();

  await expect(page.getByText("Dining is at", { exact: false })).toBeVisible();
  await expect(page.getByText("Driving is at", { exact: false })).toBeVisible();
  await expect(page.getByText("Health is at 80% of budget", { exact: false })).toBeVisible();
  await expect(page.getByText("Rent is at", { exact: false })).toBeVisible();

  // Comfortably-under-budget and zero-spend-but-budgeted categories stay hidden.
  await expect(page.getByText("Groceries is at", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Travel is at", { exact: false })).toHaveCount(0);

  await banner.getByRole("button", { name: "Dismiss budget insights" }).click();
  await expect(page.getByText("Dining is at", { exact: false })).toHaveCount(0);
});

test("dismissal persists across a reload on the same day", async ({ page }) => {
  await expect(page.getByText("Dining is at", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Dismiss budget insights" }).click();
  await expect(page.getByText("Dining is at", { exact: false })).toHaveCount(0);

  await page.reload();
  await page.getByText(/Log an expense/).waitFor();

  await expect(page.getByText("Dining is at", { exact: false })).toHaveCount(0);
});
