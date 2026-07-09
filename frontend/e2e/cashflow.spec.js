import { expect, test } from "@playwright/test";
import { goToExpensesTab, login } from "./fixtures";

// Expected net = all-time income minus all-time expenses (both users, since
// expenses/income are shared household data) from scripts/seed_e2e_data.py:
// income  = 2500.00 + 42.75 + 30.00                                = 2572.75
// expense = 1850.00 + 142.37 + 38.50 + 9.50 + 54.20 + 210.00 + 120.00
//         + 310.00 + 89.99 + 12.50 + 22.00 + 15.99 + 60.00 (e2e_test)
//         + 9.99 (e2e_housemate's Cloud Storage)                   = 2945.04
// net = 2572.75 - 2945.04 = -372.29
const EXPECTED_NET = "-$372.29";

test.beforeEach(async ({ page }) => {
  await login(page);
  await goToExpensesTab(page);
});

test("shows the net cash flow figure, unaffected by the Expenses/Income toggle", async ({ page }) => {
  await expect(page.getByText(`Net: ${EXPECTED_NET}`, { exact: false }).filter({ visible: true })).toBeVisible();

  await page.getByRole("tab", { name: "Income" }).click();
  await expect(page.getByText(`Net: ${EXPECTED_NET}`, { exact: false }).filter({ visible: true })).toBeVisible();

  await page.getByRole("tab", { name: "Expenses" }).click();
  await expect(page.getByText(`Net: ${EXPECTED_NET}`, { exact: false }).filter({ visible: true })).toBeVisible();
});
