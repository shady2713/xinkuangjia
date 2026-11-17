/**
 * 用户导入关键路径：管理员在用户管理页通过现有导入弹窗上传 Excel，
 * 导入结果提示成功且刷新后的用户列表能查到导入账号。
 *
 * 夹具 e2e/fixtures/user-import.xlsx 与 seed-e2e.sql 的初始密码配置配合使用；
 * 用例勾选“是否覆盖”，重复执行时走更新分支，避免账号已存在造成偶发失败。
 */
import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';

import {
  adminAccount,
  fixturePath,
  loginAs,
  prepareBrowserContext,
} from './support/flows';

test.beforeEach(
  // 每个用例先关闭构建产物中的验证码并转发真实后端接口。
  async ({ context }) => {
    await prepareBrowserContext(context);
  },
);

/** 覆盖用户导入路径：上传 Excel、提示新增或更新成功、列表可检索到账号。 */
async function importExcelAndFindUserByAccount({ page }: { page: Page }) {
  await loginAs(page, adminAccount);
  await page.goto('./#/system/user');
  await expect(page.getByText('用户列表')).toBeVisible();

  await page.getByRole('button', { name: '导入' }).click();
  const dialog = page
    .locator('[role="dialog"]')
    .filter({ hasText: '导入用户' })
    .last();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles(fixturePath('user-import.xlsx'));
  const updateSupport = dialog.locator('.el-switch').first();
  await updateSupport.click();
  await expect(updateSupport).toHaveClass(/is-checked/);
  await dialog.getByRole('button', { name: '确认' }).click();

  await expect(page.locator('.el-message').last()).toContainText(
    /新增 \d+ 个，更新 \d+ 个/,
  );
  await expect(page.locator('.el-message-box')).toHaveCount(0);

  await page.getByPlaceholder('请输入用户名称').fill('e2eimportuser');
  await page.getByRole('button', { name: '搜索' }).first().click();
  const row = page
    .locator('.vxe-body--row')
    .filter({ hasText: 'e2eimportuser' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('E2E导入用户');
}

test(
  '导入 Excel 后列表可按账号查询到导入用户',
  importExcelAndFindUserByAccount,
);
