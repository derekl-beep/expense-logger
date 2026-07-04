import { expect, test } from "@playwright/test";
import { login, goToExpensesTab } from "./fixtures";

const LAST_SEEN_KEY = "expenses_last_seen_id_e2e_test";

test("shows no 'new activity' banner on a first-ever visit (no stored baseline)", async ({ page }) => {
  await login(page);
  await goToExpensesTab(page);
  await expect(page.getByText("since you were last here", { exact: false })).toHaveCount(0);
});

test("shows and dismisses a 'new activity' banner for a teammate's expense logged since the stored baseline", async ({ page }) => {
  // Simulate "I was last here before the housemate's seeded expense existed"
  // by planting an old baseline, then reloading once so the app picks it up
  // on mount. Using a one-off page.evaluate() (not addInitScript, which
  // would re-run and stomp the dismissed value on every later reload too).
  await page.goto("/");
  await page.evaluate((key) => localStorage.setItem(key, "1"), LAST_SEEN_KEY);
  await page.reload();

  await login(page);
  await goToExpensesTab(page);

  const banner = page.getByText("new expense", { exact: false });
  await expect(banner).toBeVisible();
  await expect(page.getByText("e2e_housemate", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Dismiss new activity notice" }).click();
  await expect(banner).toHaveCount(0);

  // Dismissal persists — reloading shouldn't resurrect it for the same activity.
  await page.reload();
  await goToExpensesTab(page);
  await expect(page.getByText("since you were last here", { exact: false })).toHaveCount(0);
});
