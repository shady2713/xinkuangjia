/**
 * 字典类型 CRUD 浏览器业务用例。
 *
 * 覆盖真实登录、通过菜单进入字典管理、新建、列表可见、编辑、删除，以及重名新建被拒的关键
 * 失败路径；环境由 scripts/e2e/run_business_e2e.py 准备，缺少后端、种子账号或浏览器时用例
 * 直接失败，不使用跳过。
 */
import type { Locator, Page } from '@playwright/test';

import process from 'node:process';

import { expect, test } from '@playwright/test';

/** 种子管理员账号，与隔离环境脚本 --admin-username 的默认值一致。 */
const ADMIN_USERNAME = 'e2eadmin';
/** 弹窗提交与删除二次确认按钮文案，取自管理前端当前中文语言包。 */
const CONFIRM_TEXT = '确认';

/**
 * 读取本次运行注入的种子账号口令，缺失时明确失败。
 * @returns 本次隔离环境的管理员明文口令。
 * @throws {Error} 缺少环境注入口令时抛出，避免用例在无凭据时静默通过。
 */
function adminPassword(): string {
  const value = process.env.BF_E2E_ADMIN_PASSWORD;
  if (!value) {
    throw new Error(
      '缺少 BF_E2E_ADMIN_PASSWORD：请通过 scripts/e2e/run_business_e2e.py 运行本用例',
    );
  }
  return value;
}

/**
 * 生成本次运行内唯一的字典标识，避免与库中既有数据重名。
 * @returns 由运行时刻派生的短标识。
 */
function runSuffix(): string {
  return Date.now().toString(36);
}

/**
 * 通过真实登录表单进入管理平台，并以概览页确认登录已生效。
 * @param page Playwright 页面对象，用于驱动真实浏览器交互。
 */
async function login(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByPlaceholder('请输入账号').fill(ADMIN_USERNAME);
  await page.getByPlaceholder('请输入密码').fill(adminPassword());
  await page.getByRole('button', { name: 'login' }).click();
  await expect(page).toHaveURL(/#\/dashboard/u);
}

/**
 * 通过左侧菜单进入字典管理页，验证菜单与按钮权限链路而不是直接改地址。
 * @param page Playwright 页面对象。
 */
async function openDictPage(page: Page): Promise<void> {
  const menu = page.locator('.vben-menu');
  await menu.getByText('系统管理', { exact: true }).click();
  await menu.getByRole('menuitem', { name: '字典管理' }).click();
  await expect(page).toHaveURL(/#\/system\/dict/u);
  // 新增按钮受 system:dict:create 权限控制，可见即证明种子角色的权限链路生效。
  await expect(
    page.getByRole('button', { name: '新增字典类型' }),
  ).toBeVisible();
}

/**
 * 打开新增字典类型弹窗并等待弹窗就绪。
 * @param page Playwright 页面对象。
 */
async function openCreateDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: '新增字典类型' }).click();
  await expect(
    page.getByRole('dialog').getByText('新增字典类型'),
  ).toBeVisible();
}

/**
 * 填写字典类型弹窗中的名称与备注；字典类型编码只在新建时填写。
 * @param page Playwright 页面对象。
 * @param values 本次要写入的名称、备注与可选编码；编辑时编码字段不可修改。
 * @param values.name 字典名称，必填。
 * @param values.remark 备注，可为空字符串。
 * @param values.type 字典类型编码；仅在新建时提供，编辑时保持原值。
 */
async function fillDictTypeForm(
  page: Page,
  values: { name: string; remark: string; type?: string },
): Promise<void> {
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('请输入字典名称').fill(values.name);
  if (values.type !== undefined) {
    await dialog.getByPlaceholder('请输入字典类型').fill(values.type);
  }
  await dialog.getByPlaceholder('请输入备注').fill(values.remark);
}

/**
 * 提交当前字典类型弹窗，不判断结果，由调用方断言成功或失败提示。
 * @param page Playwright 页面对象。
 */
async function submitDictTypeForm(page: Page): Promise<void> {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: CONFIRM_TEXT })
    .click();
}

/**
 * 在字典管理页新建一个字典类型并等待成功提示。
 * @param page Playwright 页面对象。
 * @param values 本次新建的名称、备注与编码。
 * @param values.name 字典名称，必须与既有记录不同。
 * @param values.remark 备注，可为空字符串。
 * @param values.type 字典类型编码，必须与既有记录不同。
 */
async function createDictType(
  page: Page,
  values: { name: string; remark: string; type: string },
): Promise<void> {
  await openCreateDialog(page);
  await fillDictTypeForm(page, values);
  await submitDictTypeForm(page);
  await expect(page.getByText('操作成功').first()).toBeVisible();
}

/**
 * 定位字典类型列表中包含指定编码的数据行。
 * @param page Playwright 页面对象。
 * @param type 本次运行的字典类型编码，用于在真实表格中筛选目标行。
 * @returns 该编码所在主表行的定位器；列表未刷新时可能为空。
 */
function dictTypeRow(page: Page, type: string): Locator {
  return page
    .locator('.vxe-table--main-wrapper .vxe-table--body tbody tr')
    .filter({ hasText: type });
}

/**
 * 定位指定数据行的操作按钮行；vxe-table 把固定列渲染到独立表格，需要按行标识关联。
 * @param page Playwright 页面对象。
 * @param type 本次运行的字典类型编码。
 * @returns 该行操作按钮所在的固定列行定位器。
 * @throws {Error} 列表中没有该编码的数据行时抛出，避免误点其他记录。
 */
async function dictTypeActionRow(page: Page, type: string): Promise<Locator> {
  const rowId = await dictTypeRow(page, type).first().getAttribute('rowid');
  if (!rowId) {
    throw new Error(`字典类型列表中未找到 ${type} 的数据行`);
  }
  return page.locator(`.vxe-table--fixed-right-wrapper tr[rowid="${rowId}"]`);
}

test('字典类型完整流程：新建、列表可见、编辑与删除', /** 用真实浏览器完成一次代表性 CRUD，并验证删除后记录不再出现在列表中。 */ async ({
  page,
}) => {
  const suffix = runSuffix();
  const type = `e2e_dict_${suffix}`;
  const name = `E2E 字典 ${suffix}`;
  const renamed = `${name} 已改`;

  await login(page);
  await openDictPage(page);

  await createDictType(page, { name, remark: '端到端新建', type });
  const created = dictTypeRow(page, type);
  await expect(created).toHaveCount(1);
  await expect(created).toContainText(name);

  const editRow = await dictTypeActionRow(page, type);
  await editRow.getByText('修改', { exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('修改字典类型'),
  ).toBeVisible();
  await fillDictTypeForm(page, { name: renamed, remark: '端到端修改' });
  await submitDictTypeForm(page);
  await expect(page.getByText('操作成功').first()).toBeVisible();
  await expect(dictTypeRow(page, type)).toContainText(renamed);

  const deleteRow = await dictTypeActionRow(page, type);
  await deleteRow.getByText('删除', { exact: true }).click();
  const confirmBox = page.locator('.el-message-box');
  await expect(confirmBox).toContainText(`确定删除 ${renamed} 吗？`);
  await confirmBox.getByRole('button', { name: CONFIRM_TEXT }).click();
  // 逻辑删除修复后的真实契约：删除成功后该记录不再出现在分页列表中。
  await expect(dictTypeRow(page, type)).toHaveCount(0);
});

test('字典类型失败路径：重名新建被拒并给出提示', /** 覆盖编码重复与名称重复两条真实拒绝路径，并确认列表没有产生新记录。 */ async ({
  page,
}) => {
  const suffix = runSuffix();
  const type = `e2e_dup_${suffix}`;
  const name = `E2E 重名 ${suffix}`;
  const otherType = `e2e_dup_other_${suffix}`;

  await login(page);
  await openDictPage(page);
  await createDictType(page, { name, remark: '失败路径基线', type });
  await expect(dictTypeRow(page, type)).toHaveCount(1);

  await openCreateDialog(page);
  await fillDictTypeForm(page, {
    name: `${name} 副本`,
    remark: '重复编码',
    type,
  });
  await submitDictTypeForm(page);
  await expect(
    page.getByText('已经存在该类型的字典类型').first(),
  ).toBeVisible();

  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  await openCreateDialog(page);
  await fillDictTypeForm(page, { name, remark: '重复名称', type: otherType });
  await submitDictTypeForm(page);
  await expect(
    page.getByText('已经存在该名字的字典类型').first(),
  ).toBeVisible();

  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  // 两次失败都不得产生新记录：原编码仍只有一行，未使用的编码没有落库。
  await expect(dictTypeRow(page, type)).toHaveCount(1);
  await expect(dictTypeRow(page, otherType)).toHaveCount(0);
});
