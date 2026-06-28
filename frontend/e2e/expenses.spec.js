import { expect, test } from "@playwright/test";
import { goToExpensesTab, login } from "./fixtures";

// The mobile card and desktop table both exist in the DOM at all times (CSS
// media queries just hide whichever doesn't match the viewport), so
// description text matches twice — this helper scopes to the one actually
// visible at the current viewport.
const expenseRow = (page, description) =>
  page.getByText(description, { exact: true }).filter({ visible: true });

test.beforeEach(async ({ page }) => {
  await login(page);
  await goToExpensesTab(page);
});

test("opens the edit dialog pre-filled with the expense's existing details", async ({ page }) => {
  await expenseRow(page, "Dinner at Pasta House").click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Edit Expense")).toBeVisible();
  await expect(dialog.locator("input").nth(0)).toHaveValue("Dinner at Pasta House");
  await expect(dialog.locator('input[type="number"]')).toHaveValue("38.5");
  await expect(dialog.getByRole("combobox")).toContainText("Dining");
});

test("editing the description persists after reload", async ({ page }) => {
  await expenseRow(page, "Dinner at Pasta House").click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("input").nth(0).fill("Dinner at Pasta House (edited)");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense updated")).toBeVisible();

  await page.reload();
  await goToExpensesTab(page);
  await expect(expenseRow(page, "Dinner at Pasta House (edited)")).toBeVisible();

  // Restore original state so this test doesn't leak into other tests/projects
  // sharing the same backend (mobile/desktop both hit the same seeded DB).
  await expenseRow(page, "Dinner at Pasta House (edited)").click();
  await dialog.locator("input").nth(0).fill("Dinner at Pasta House");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense updated")).toBeVisible();
});

test("toggling the flag persists after reload", async ({ page }) => {
  await expenseRow(page, "Lunch at Food Court").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Flag for follow-up" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense updated")).toBeVisible();

  await page.reload();
  await goToExpensesTab(page);
  await expenseRow(page, "Lunch at Food Court").click();
  await expect(dialog.getByRole("button", { name: "Flagged for follow-up" })).toBeVisible();

  // Restore original (unflagged) state.
  await dialog.getByRole("button", { name: "Flagged for follow-up" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Expense updated")).toBeVisible();
});

test("deleting an expense shows an undo toast that restores it", async ({ page }) => {
  await expenseRow(page, "Coffee at Local Cafe").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(expenseRow(page, "Coffee at Local Cafe")).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(expenseRow(page, "Coffee at Local Cafe")).toBeVisible();
});

test("search filters the expense list by description", async ({ page }) => {
  await page.getByPlaceholder("Search…").fill("Costco");
  await expect(expenseRow(page, "Groceries at Costco")).toBeVisible();
  await expect(expenseRow(page, "Monthly Rent")).toHaveCount(0);

  await page.getByPlaceholder("Search…").fill("");
  await expect(expenseRow(page, "Monthly Rent")).toBeVisible();
});

test("exporting CSV downloads a file containing seeded expense data", async ({ page }) => {
  const controlsRow = page.locator("div.flex.items-center.gap-2").filter({ has: page.getByPlaceholder("Search…") });
  await controlsRow.locator('[aria-haspopup="menu"]').click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByText("Export CSV").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("expenses.csv");
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString("utf-8")).toContain("Monthly Rent");
});
