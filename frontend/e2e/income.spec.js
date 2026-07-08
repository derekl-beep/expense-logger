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
  await expect(page.getByText("Total: $2542.75")).toBeVisible();

  // Expense-only filter controls are hidden in the income view.
  await expect(page.getByPlaceholder("Search…")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Flagged only" })).toHaveCount(0);

  // Switching back restores the expense list and its own total.
  await page.getByRole("tab", { name: "Expenses" }).click();
  await expect(visibleText(page, "Dinner at Pasta House")).toBeVisible();
  await expect(visibleText(page, "Payroll Deposit")).toHaveCount(0);
});
