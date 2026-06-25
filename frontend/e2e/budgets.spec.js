import { expect, test } from "@playwright/test";
import { goToExpensesTab, login } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await login(page);
  await goToExpensesTab(page);
});

const panel = (page) => page.getByRole("dialog");
const row = (page, category) => panel(page).locator("div.flex.items-center.gap-2.py-1").filter({ hasText: category });

test("orders budgeted categories first, then unbudgeted, alphabetically within each group", async ({ page }) => {
  await page.getByTitle("Manage budgets").click();
  await expect(page.getByText("Manage Budgets")).toBeVisible();

  const names = panel(page).locator("span.text-sm.text-foreground.flex-1.truncate");
  await expect(names).toHaveCount(18);
  await expect(names.nth(0)).toHaveText("Dining");
  await expect(names.nth(1)).toHaveText("Driving");
  await expect(names.nth(2)).toHaveText("Groceries");
  await expect(names.nth(3)).toHaveText("Health");
  await expect(names.nth(4)).toHaveText("Rent");
  await expect(names.nth(5)).toHaveText("Travel");
  await expect(names.nth(6)).toHaveText("Beauty");
});

test("saving a new budget persists after reload and re-sorts the category into the budgeted group", async ({ page }) => {
  await page.getByTitle("Manage budgets").click();
  await row(page, "Furniture").locator("input").fill("100");
  await row(page, "Furniture").locator("input").blur();
  await expect(page.getByText("Failed to save budget")).toHaveCount(0);

  await page.reload();
  await goToExpensesTab(page);
  await page.getByTitle("Manage budgets").click();
  await expect(row(page, "Furniture").locator("input")).toHaveValue("100");

  // Budgeted group is now Dining, Driving, Furniture, Groceries, Health, Rent, Travel.
  const names = panel(page).locator("span.text-sm.text-foreground.flex-1.truncate");
  await expect(names.nth(2)).toHaveText("Furniture");

  // Restore original state so this test doesn't leak into other tests/projects
  // sharing the same backend (mobile/desktop both hit the same seeded DB).
  await row(page, "Furniture").locator("input").fill("");
  await row(page, "Furniture").locator("input").blur();
  await expect(page.getByText("Failed to save budget")).toHaveCount(0);
});

test("clearing a budget removes it and moves the category back to the unbudgeted group", async ({ page }) => {
  await page.getByTitle("Manage budgets").click();
  await row(page, "Health").locator("input").fill("");
  await row(page, "Health").locator("input").blur();

  await page.reload();
  await goToExpensesTab(page);
  await page.getByTitle("Manage budgets").click();
  await expect(row(page, "Health").locator("input")).toHaveValue("");

  // Budgeted group shrinks to Dining, Driving, Groceries, Rent, Travel.
  const names = panel(page).locator("span.text-sm.text-foreground.flex-1.truncate");
  await expect(names.nth(3)).toHaveText("Rent");
  await expect(names.nth(5)).toHaveText("Beauty");

  // Restore original state so this test doesn't leak into other tests/projects
  // sharing the same backend (mobile/desktop both hit the same seeded DB).
  await row(page, "Health").locator("input").fill("150");
  await row(page, "Health").locator("input").blur();
  await expect(page.getByText("Failed to save budget")).toHaveCount(0);
});
