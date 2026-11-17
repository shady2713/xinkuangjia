/**
 * 登录关键路径：正确凭据进入概览页，错误凭据停留在登录页并显示失败提示。
 *
 * 依赖 e2e/fixtures/seed-e2e.sql 准备的测试账号和后端本地实例，命令见 e2e/README.md。
 */
import { expect, test } from '@playwright/test';

import {
  adminAccount,
  prepareBrowserContext,
  submitLogin,
} from './support/flows';

test.beforeEach(
  // 每个用例先关闭构建产物中的验证码并转发真实后端接口。
  async ({ context }) => {
    await prepareBrowserContext(context);
  },
);

test(
  '管理员使用正确账号密码登录后进入概览页',
  // 覆盖登录成功路径：接口返回成功、页面进入概览且管理菜单可见。
  async ({ page }) => {
    const response = await submitLogin(page, adminAccount);
    const payload = await response.json();
    expect(payload.code).toBe(0);
    await page.waitForURL(/#\/dashboard/);

    await expect(page.getByText('系统管理', { exact: true })).toBeVisible();
    await expect(page.locator('body')).toContainText('管理员');
  },
);

test(
  '错误密码停留在登录页并提示登录失败',
  // 覆盖凭据失败路径：接口返回错误码、页面不跳转并显示统一失败提示。
  async ({ page }) => {
    const response = await submitLogin(page, {
      password: 'WrongPass@123',
      username: 'e2enotexist',
    });
    const payload = await response.json();
    expect(payload.code).not.toBe(0);

    await expect(page).toHaveURL(/#\/auth\/login/);
    await expect(page.locator('.el-message')).toContainText(
      '登录失败，账号密码不正确',
    );
  },
);
