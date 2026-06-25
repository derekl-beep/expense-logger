export const E2E_USERNAME = "e2e_test";
export const E2E_PASSWORD = "e2e_test_pass123";

export async function login(page) {
  await page.goto("/");
  await page.fill("#username", E2E_USERNAME);
  await page.fill("#password", E2E_PASSWORD);
  await page.click('button[type="submit"]');
  await page.getByText(/Log an expense/).waitFor();
}

// On mobile the Expenses panel is hidden behind a tab bar; on desktop it's
// always visible, so this is a no-op there.
export async function goToExpensesTab(page) {
  const tab = page.getByRole("button", { name: "Expenses" });
  if (await tab.isVisible()) {
    await tab.click();
  }
}
