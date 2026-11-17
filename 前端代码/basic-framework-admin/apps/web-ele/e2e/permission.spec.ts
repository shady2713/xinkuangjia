/**
 * 权限关键路径：受限账号看不到管理菜单、直达路由被兜底页拒绝且后端接口拒绝，
 * 管理员可以进入用户管理并使用导入入口。
 *
 * 受限账号在 e2e/fixtures/seed-e2e.sql 中只关联空菜单角色，命令见 e2e/README.md。
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  adminAccount,
  backendUrl,
  limitedAccount,
  loginAs,
  prepareBrowserContext,
} from './support/flows';

test.beforeEach(
  // 每个用例先关闭构建产物中的验证码并转发真实后端接口。
  async ({ context }) => {
    await prepareBrowserContext(context);
  },
);

/** 覆盖无权限路径：菜单不可见、直达路由落到未找到页、后端接口返回 403。 */
async function rejectLimitedAccountWithoutMenuPermission({
  context,
  page,
}: {
  context: BrowserContext;
  page: Page;
}) {
  const accessToken = await loginAs(page, limitedAccount);
  await expect(page.getByText('系统管理', { exact: true })).toHaveCount(0);
  await expect(page.getByText('用户管理', { exact: true })).toHaveCount(0);

  await page.goto('./#/system/user');
  await expect(page.getByText('哎呀！未找到页面')).toBeVisible();

  const response = await context.request.get(
    `${backendUrl}/admin-api/system/user/page?pageNo=1&pageSize=10`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.code).toBe(403);
}

test(
  '受限账号无菜单权限时入口不可用且接口被拒绝',
  rejectLimitedAccountWithoutMenuPermission,
);

/** 覆盖有权限路径：用户管理页可进入且带权限的导入按钮可见。 */
async function allowAdminToOpenUserImport({ page }: { page: Page }) {
  await loginAs(page, adminAccount);
  await page.goto('./#/system/user');

  await expect(page.getByText('用户列表')).toBeVisible();
  await expect(page.getByRole('button', { name: '导入' })).toBeVisible();
}

test('管理员有权限时进入用户管理并使用导入入口', allowAdminToOpenUserImport);
