import { expect, test } from "@playwright/test";
import { goToExpensesTab, login } from "./fixtures";

// Seed data (scripts/seed_e2e_data.py) plants one goal: Vacation Fund,
// target $3000, $750 contributed so far -> 25% complete.

test.beforeEach(async ({ page }) => {
  await login(page);
  await goToExpensesTab(page);
});

test("shows a savings goal's name, progress, and target date", async ({ page }) => {
  await expect(page.getByText("Savings Goals")).toBeVisible();
  await expect(page.getByText("Vacation Fund")).toBeVisible();
  await expect(page.getByText("$750.00 / $3000.00")).toBeVisible();
  await expect(page.getByText("Target:", { exact: false })).toBeVisible();
});

test("the savings goals section persists across an Expenses/Income tab switch", async ({ page }) => {
  await expect(page.getByText("Vacation Fund")).toBeVisible();

  await page.getByRole("tab", { name: "Income" }).click();
  await expect(page.getByText("Vacation Fund")).toHaveCount(0);

  await page.getByRole("tab", { name: "Expenses" }).click();
  await expect(page.getByText("Vacation Fund")).toBeVisible();
});
