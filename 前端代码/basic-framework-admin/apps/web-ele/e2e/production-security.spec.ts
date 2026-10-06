/**
 * 生产构建安全回归用例：锁定打包产物的登录页不得预填开发账号与密码。
 * 只断言登录页首次渲染的输入框取值，不覆盖鉴权接口与其它页面的权限行为。
 */
import { expect, test } from '@playwright/test';

test('production 登录页不预填开发账号密码', async ({ page }) => {
  const response = await page.goto('./');

  expect(response?.ok()).toBe(true);
  await expect(page).toHaveTitle(/管理平台/u);

  const passwordInput = page.locator('input[type="password"]').first();
  await expect(passwordInput).toBeVisible();
  await expect(passwordInput).toHaveValue('');
});
