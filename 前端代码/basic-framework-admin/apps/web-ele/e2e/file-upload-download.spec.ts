/**
 * 文件关键路径：管理员通过文件管理页上传图片，列表登记成功后从同一记录下载，
 * 并校验下载内容与上传字节一致。
 *
 * 使用项目现有 /infra/file 上传与文件列表，不新增后端接口；对象存储与后端由
 * e2e/README.md 描述的本地环境提供。
 */
import { readFileSync } from 'node:fs';

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

test('上传图片后可从文件列表下载相同内容', async ({ context, page }) => {
  // 覆盖文件上传到下载的完整路径：上传成功、记录可见、下载字节与上传一致。
  const buffer = readFileSync(fixturePath('upload-sample.png'));
  const fileName = `e2e-upload-${Date.now()}.png`;

  await loginAs(page, adminAccount);
  await page.goto('./#/infra/file');
  await expect(page.getByText('文件列表')).toBeVisible();

  await page.getByRole('button', { name: '上传文件' }).click();
  const dialog = page
    .locator('[role="dialog"]')
    .filter({ hasText: '上传图片' })
    .last();
  await dialog
    .locator('input[type="file"]')
    .setInputFiles({ buffer, mimeType: 'image/png', name: fileName });
  await dialog.getByRole('button', { name: '确认' }).click();
  await expect(page.locator('.el-message').last()).toContainText('操作成功');

  const row = page.locator('.vxe-body--row').filter({ hasText: fileName });
  await expect(row).toBeVisible();
  await expect(row).toContainText('image/png');

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    row.getByRole('button', { name: '下载' }).click(),
  ]);
  expect(new URL(popup.url()).pathname).toContain('e2e-upload-');

  const response = await context.request.get(popup.url());
  expect(response.status()).toBe(200);
  expect(Buffer.compare(await response.body(), buffer)).toBe(0);
});
