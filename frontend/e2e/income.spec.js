import { expect, test } from "@playwright/test";
import { goToExpensesTab, login } from "./fixtures";

// The mobile card and desktop table both exist in the DOM at all times (CSS
// media queries just hide whichever doesn't match the viewport), so text
// matches twice — this helper scopes to the one actually visible at the
// current viewport. Same pattern as expenses.spec.js's expenseRow helper.
const visibleText = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true });

test.beforeEach(async ({ page }) => {
  await login(page);
  await goToExpensesTab(page);
});

test("toggles to the Income view and lists seeded income, with the expense-only total", async ({ page }) => {
  // Defaults to the Expenses view.
  await expect(visibleText(page, "Dinner at Pasta House")).toBeVisible();

  await page.getByRole("tab", { name: "Income" }).click();

  await expect(visibleText(page, "Payroll Deposit")).toBeVisible();
  await expect(visibleText(page, "Cashback Reward")).toBeVisible();
  await expect(page.getByText("Total: $2572.75")).toBeVisible();

  // Expense-only filter controls are hidden in the income view.
  await expect(page.getByPlaceholder("Search…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Flagged only" })).toHaveCount(0);

  // Switching back restores the expense list and its own total.
  await page.getByRole("tab", { name: "Expenses" }).click();
  await expect(visibleText(page, "Dinner at Pasta House")).toBeVisible();
  await expect(visibleText(page, "Payroll Deposit")).toHaveCount(0);
});

test("opens the edit dialog pre-filled with the income entry's existing details", async ({ page }) => {
  await page.getByRole("tab", { name: "Income" }).click();
  await visibleText(page, "Cashback Reward").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Edit Income")).toBeVisible();
  await expect(dialog.locator("input").nth(0)).toHaveValue("Cashback Reward");
  await expect(dialog.locator('input[type="number"]')).toHaveValue("42.75");
  await expect(dialog.getByRole("combobox")).toContainText("Rebate");
});

test("editing an income entry persists after reload", async ({ page }) => {
  await page.getByRole("tab", { name: "Income" }).click();
  await visibleText(page, "Cashback Reward").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input").nth(0).fill("Cashback Reward (edited)");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Income updated")).toBeVisible();

  await page.reload();
  await goToExpensesTab(page);
  await page.getByRole("tab", { name: "Income" }).click();
  await expect(visibleText(page, "Cashback Reward (edited)")).toBeVisible();

  // Restore original state so this test doesn't leak into other tests/projects
  // sharing the same backend (mobile/desktop both hit the same seeded DB).
  await visibleText(page, "Cashback Reward (edited)").click();
  await dialog.locator("input").nth(0).fill("Cashback Reward");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Income updated")).toBeVisible();
});

test("deleting an income entry shows an undo toast that restores it", async ({ page }) => {
  await page.getByRole("tab", { name: "Income" }).click();
  await visibleText(page, "Cashback Reward").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(visibleText(page, "Cashback Reward")).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(visibleText(page, "Cashback Reward")).toBeVisible();
});
