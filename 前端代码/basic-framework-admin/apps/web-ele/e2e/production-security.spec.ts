import { expect, test } from '@playwright/test';

test('production 登录页不预填开发账号密码', async ({ page }) => {
  const response = await page.goto('./');

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/管理平台/u);

  const passwordInput = page.locator('input[type="password"]').first();
  await expect(passwordInput).toBeVisible();
  await expect(passwordInput).toHaveValue('');
});
