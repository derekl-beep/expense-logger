import { expect, test } from "@playwright/test";
import { goToExpensesTab, login } from "./fixtures";

// The mobile card and desktop table both exist in the DOM at all times (CSS
// media queries just hide whichever doesn't match the viewport), so text
// matches twice — this helper scopes to the one actually visible at the
// current viewport. Same pattern as expenses.spec.js/income.spec.js.
const visibleText = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true });

test.beforeEach(async ({ page }) => {
  await login(page);
  await goToExpensesTab(page);
});

test("shows a Reimbursed badge on the linked expense", async ({ page }) => {
  await expect(visibleText(page, "Dinner at Luigi's")).toBeVisible();
  await expect(page.getByTitle("Reimbursed").filter({ visible: true })).toBeVisible();

  // An expense with no linked reimbursement shows no badge.
  await expect(visibleText(page, "Gas at Shell")).toBeVisible();
});

test("shows what it repays on the linked income row", async ({ page }) => {
  await page.getByRole("tab", { name: "Income" }).click();

  await expect(visibleText(page, "Reimbursement from Jake")).toBeVisible();
  await expect(page.getByText("repays Dinner at Luigi's", { exact: false }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText("$60.00", { exact: false }).filter({ visible: true })).toBeVisible();

  // Income with no link shows no "repays" note.
  await expect(visibleText(page, "Payroll Deposit")).toBeVisible();
  await expect(page.getByText("repays", { exact: false })).toHaveCount(2); // one per viewport (mobile + desktop), both for the same linked row
});
