import { expect, test } from "@playwright/test";
import { goToExpensesTab, login } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await login(page);
  await goToExpensesTab(page);
  await expect(page.getByText("BREAKDOWN")).toBeVisible();
});

test("shows top categories by spend, highest first", async ({ page }) => {
  const rows = page.locator("button").filter({ has: page.locator("span.w-24, span.w-32") });
  await expect(rows.first()).toContainText("Rent");
});

test("hides a budgeted category with zero spend this month", async ({ page }) => {
  // Travel has a $500 budget seeded but no expenses, so it must not appear,
  // even after expanding to the full list.
  const viewMore = page.getByText(/View \d+ more/);
  if (await viewMore.count() > 0) {
    await viewMore.click();
  }
  await expect(page.getByText("Travel", { exact: true })).toHaveCount(0);
});

test("marks an over-budget category in red", async ({ page }) => {
  const rentRow = page.locator("button").filter({ hasText: "Rent" });
  await expect(rentRow.locator("span").filter({ hasText: "$" }).last()).toHaveClass(/text-red-600/);
});
