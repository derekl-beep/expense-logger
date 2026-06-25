import { expect, test } from "@playwright/test";
import { E2E_USERNAME, login } from "./fixtures";

test("logs in with valid credentials", async ({ page }) => {
  await login(page);
  await expect(page.getByText(/Log an expense/)).toBeVisible();
});

test("shows an error for invalid credentials", async ({ page }) => {
  await page.goto("/");
  await page.fill("#username", E2E_USERNAME);
  await page.fill("#password", "wrong-password");
  await page.click('button[type="submit"]');
  await expect(page.getByText("Invalid username or password")).toBeVisible();
});

test("disables submit until both fields are filled", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('button[type="submit"]')).toBeDisabled();
  await page.fill("#username", E2E_USERNAME);
  await expect(page.locator('button[type="submit"]')).toBeDisabled();
});
